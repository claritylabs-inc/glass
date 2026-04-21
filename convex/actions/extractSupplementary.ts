"use node";

/**
 * Run the supplementary extractor on existing policies that were extracted
 * before cl-sdk 0.13. Extracts auxiliary facts for better querying without
 * re-running the full extraction pipeline.
 *
 * Single policy: npx convex run actions/extractSupplementary:extractOne --args '{"policyId": "..."}'
 * All in org:    npx convex run actions/extractSupplementary:extractAll --args '{"orgId": "..."}'
 */

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import {
  getExtractor,
  toStrictSchema,
  withRetry,
  getPdfPageCount,
  chunkDocument,
} from "@claritylabs/cl-sdk";
import { policyToInsuranceDoc } from "../lib/documentMapping";
import { makeGenerateObject, makeEmbedText } from "../lib/sdkCallbacks";
import { Id } from "../_generated/dataModel";

/**
 * Build a summary of data already captured by structured extractors.
 * Passed to the supplementary prompt so the LLM skips duplicates.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAlreadyExtractedSummary(policy: any): string {
  const lines: string[] = [];

  // Core identity
  if (policy.carrier) lines.push(`carrier: ${policy.carrier}`);
  if (policy.security) lines.push(`security: ${policy.security}`);
  if (policy.insuredName) lines.push(`insured_name: ${policy.insuredName}`);
  if (policy.policyNumber) lines.push(`policy_number: ${policy.policyNumber}`);
  if (policy.effectiveDate) lines.push(`effective_date: ${policy.effectiveDate}`);
  if (policy.expirationDate) lines.push(`expiration_date: ${policy.expirationDate}`);
  if (policy.premium) lines.push(`premium: ${policy.premium}`);

  // Insured details
  if (policy.insuredDba) lines.push(`insured_dba: ${policy.insuredDba}`);
  if (policy.insuredFein) lines.push(`insured_fein: ${policy.insuredFein}`);
  if (policy.insuredAddress) {
    const a = policy.insuredAddress;
    lines.push(`insured_address: ${[a.street1, a.city, a.state, a.zip].filter(Boolean).join(", ")}`);
  }

  // Broker / MGA
  if (policy.brokerAgency || policy.broker) lines.push(`broker: ${policy.brokerAgency || policy.broker}`);
  if (policy.mga) lines.push(`mga: ${policy.mga}`);
  if (policy.underwriter) lines.push(`underwriter: ${policy.underwriter}`);

  // Coverages — limits and deductibles
  if (policy.coverages?.length) {
    for (const cov of policy.coverages) {
      const parts = [cov.name];
      if (cov.limit) parts.push(`limit: ${cov.limit}`);
      if (cov.deductible) parts.push(`deductible: ${cov.deductible}`);
      lines.push(`coverage: ${parts.join(", ")}`);
    }
  }

  // Locations
  if (policy.locations?.length) {
    for (const loc of policy.locations) {
      const addr = loc.address;
      if (addr) {
        lines.push(`location: #${loc.number} ${[addr.street1, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}`);
      }
    }
  }

  if (lines.length === 0) return "";

  return [
    "The following information has ALREADY been extracted by other extractors.",
    "Do NOT include any of these facts in your output — only extract NEW information not listed here:",
    "",
    ...lines,
  ].join("\n");
}

/**
 * Run supplementary extraction on a single policy.
 * Requires the policy to have a stored PDF file.
 */
export const extractOne = internalAction({
  args: {
    policyId: v.id("policies"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ skipped?: boolean; reason?: string; policyId?: string; facts: number; chunks?: number }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    }) as any;
    if (!policy) throw new Error("Policy not found");
    if (!policy.fileId) throw new Error("Policy has no stored PDF");
    if (policy.supplementaryFacts?.length && !args.force) {
      return { skipped: true, reason: "already_has_facts", facts: 0 };
    }

    const blob = await ctx.storage.get(policy.fileId as Id<"_storage">);
    if (!blob) throw new Error("PDF file not found in storage");

    const arrayBuffer = await blob.arrayBuffer();
    const pdfBase64: string = Buffer.from(arrayBuffer).toString("base64");

    const supplementary = getExtractor("supplementary");
    if (!supplementary) throw new Error("Supplementary extractor not found in SDK");

    const generateObject = makeGenerateObject("extraction");
    const pageCount = await getPdfPageCount(pdfBase64);

    // Build dedup context so the LLM skips already-extracted data
    const alreadyExtracted = buildAlreadyExtractedSummary(policy);
    // buildPrompt accepts optional alreadyExtractedSummary in 0.13.1+ (types lag behind)
    const buildPrompt = supplementary.buildPrompt as (summary?: string) => string;
    const prompt = `${buildPrompt(alreadyExtracted || undefined)}\n\n[Document pages 1-${pageCount} are provided as a PDF file.]`;
    const strictSchema = toStrictSchema(supplementary.schema);

    const result: { object: unknown; usage?: unknown } = await withRetry(() =>
      generateObject({
        prompt,
        schema: strictSchema,
        maxTokens: supplementary.maxTokens ?? 2048,
        providerOptions: { pdfBase64 },
      }),
    );

    const facts: unknown[] = (result.object as Record<string, unknown>)?.auxiliaryFacts as unknown[] ?? [];
    if (facts.length === 0) {
      return { policyId: args.policyId, facts: 0 };
    }

    // Store supplementary facts on the policy
    await ctx.runMutation(internal.policies.updateExtractionInternal, {
      id: args.policyId,
      fields: { supplementaryFacts: facts },
    });

    // Re-chunk to include supplementary chunks in vector search
    if (policy.orgId) {
      // Delete existing supplementary chunks (if any from a prior run)
      const existingChunks = await ctx.runQuery(
        internal.documentChunks.listByPolicy,
        { policyId: args.policyId },
      );
      const supplementaryChunkIds = existingChunks
        .filter((c: { chunkType?: string }) => c.chunkType === "supplementary")
        .map((c: { _id: Id<"documentChunks"> }) => c._id);
      for (const id of supplementaryChunkIds) {
        await ctx.runMutation(internal.documentChunks.deleteOne, { id });
      }

      // Generate and embed new supplementary chunks
      const doc = policyToInsuranceDoc({
        ...policy,
        supplementaryFacts: facts,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const allChunks = chunkDocument(doc);
      const newChunks = allChunks.filter((c) => c.type === "supplementary");

      if (newChunks.length > 0) {
        const embed = makeEmbedText();
        for (const chunk of newChunks) {
          const embedding = await embed(chunk.text);
          await ctx.runMutation(internal.documentChunks.insert, {
            orgId: policy.orgId as Id<"organizations">,
            policyId: args.policyId,
            chunkId: chunk.id,
            chunkType: chunk.type,
            text: chunk.text,
            metadata: chunk.metadata,
            embedding,
            createdAt: Date.now(),
          });
        }
      }

      return { policyId: args.policyId, facts: facts.length, chunks: newChunks.length };
    }

    return { policyId: args.policyId, facts: facts.length, chunks: 0 };
  },
});

/**
 * Backfill supplementary extraction for all policies in an organization.
 * Skips policies that already have supplementary facts or have no stored PDF.
 */
export const extractAll = internalAction({
  args: {
    orgId: v.id("organizations"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;

    const policies = await ctx.runQuery(internal.policies.listAllInternal, {
      orgId: args.orgId,
    });
    const quotes = await ctx.runQuery(internal.policies.listAllQuotesInternal, {
      orgId: args.orgId,
    });
    const allDocs = [...policies, ...quotes].filter(
      (p) => p.fileId && !p.supplementaryFacts?.length && p.extractionStatus === "complete",
    );

    console.log(`Supplementary backfill: ${allDocs.length} policies to process for org ${args.orgId}`);

    let processed = 0;
    let totalFacts = 0;
    let skipped = 0;

    for (const policy of allDocs) {
      try {
        const result = await ctx.runAction(internal.actions.extractSupplementary.extractOne, {
          policyId: policy._id,
        });
        const r = result as { skipped?: boolean; facts?: number };
        if (r.skipped) {
          skipped++;
        } else {
          processed++;
          totalFacts += r.facts ?? 0;
          console.log(
            `Supplementary: ${processed}/${allDocs.length} — ${policy.carrier} #${policy.policyNumber} → ${r.facts} facts`,
          );
        }
      } catch (err: unknown) {
        console.error(`Supplementary: failed for ${policy._id}: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
      }

      if (processed > 0 && processed % batchSize === 0) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(`Supplementary backfill complete: ${processed} processed, ${totalFacts} facts, ${skipped} skipped`);
    return { processed, totalFacts, skipped };
  },
});

/**
 * Public action — run supplementary extraction on a single policy (auth-gated).
 */
export const runSupplementary = action({
  args: {
    policyId: v.id("policies"),
    force: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const viewer = await ctx.runQuery(api.users.viewer) as { _id: string } | null;
    if (!viewer) return { error: "Not authenticated" };
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {}) as { membership: { orgId: string } } | null;
    if (!orgData) return { error: "No organization" };

    const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });
    if (!policy || policy.orgId !== orgData.membership.orgId) {
      return { error: "Not found" };
    }

    return await ctx.runAction(internal.actions.extractSupplementary.extractOne, {
      policyId: args.policyId,
      force: args.force,
    });
  },
});
