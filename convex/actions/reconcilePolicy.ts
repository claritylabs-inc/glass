"use node";

/**
 * reconcilePolicy — merge extracted data from multiple policy files into a
 * single unified policy record, then re-chunk for vector search.
 *
 * Called after all policyFiles for a policy reach pipelineStatus "complete".
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getModelForOrg } from "../lib/models";
import { insuranceDocToPolicy } from "../lib/documentMapping";
import { makeEmbedText } from "../lib/sdkCallbacks";

export const reconcilePolicy = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, {
        id: args.policyId,
        message,
      });
    };

    const appendReconciliationLog = async (message: string) => {
      await ctx.runMutation(internal.policies.appendReconciliationLog, {
        id: args.policyId,
        message,
      });
    };

    try {
      // 1. Load all complete policyFiles for this policy
      const allFiles = await ctx.runQuery(
        (internal as any).policyFiles.listByPolicyInternal,
        { policyId: args.policyId },
      ) as any[];

      const completeFiles = allFiles.filter(
        (f: any) => f.pipelineStatus === "complete" && f.extractedData,
      );

      await log(`Reconciliation: ${completeFiles.length} complete file(s) found.`);

      // 2. Single file — skip LLM merge, just mark reconciled
      if (completeFiles.length <= 1) {
        if (completeFiles.length === 1) {
          const fields = insuranceDocToPolicy(completeFiles[0].extractedData);
          await ctx.runMutation(internal.policies.updateReconciliation, {
            id: args.policyId,
            reconciliationStatus: "reconciled",
            fields,
          });
          await appendReconciliationLog("Single file — reconciliation skipped, data applied directly.");
          await log("Reconciliation: single file, applied directly.");
        } else {
          await ctx.runMutation(internal.policies.updateReconciliation, {
            id: args.policyId,
            reconciliationStatus: "reconciled",
          });
          await appendReconciliationLog("No complete files — marked reconciled without data update.");
          await log("Reconciliation: no complete files, marked reconciled.");
        }
        return;
      }

      // 3. Multiple files — merge via reasoning model (kimi-k2.5, 256K context)
      const n = completeFiles.length;
      const docsJson = completeFiles
        .map((f: any, i: number) =>
          `--- Document ${i + 1} (${f.fileType ?? "unknown type"}: ${f.fileName}) ---\n${JSON.stringify(f.extractedData, null, 2)}`,
        )
        .join("\n\n");

      const prompt = `You have ${n} extracted insurance documents that are parts of the same policy package.

${docsJson}

Merge them into a single unified InsuranceDocument JSON object.

Merge rules:
- For conflicts: prefer declaration pages for dates, policy numbers, premium, and named insured; prefer policy wording for coverage details and conditions; prefer endorsements for modifications and overrides.
- Include ALL coverages from all files — do not drop any coverage.
- Include ALL endorsements, conditions, and exclusions from all files — merge arrays, deduplicate by name/number.
- For policy metadata (policyNumber, carrier, effectiveDate, expirationDate, premium, insuredName): prefer the value from the declaration page file if available, otherwise use the most complete value.
- The output must be valid JSON matching the InsuranceDocument structure (same schema as the input documents).
- Do not include commentary, only output the JSON object.

Output: a single JSON object representing the merged InsuranceDocument.`;

      await log(`Reconciliation: sending ${n} documents to reasoning model for merge.`);

      const result = await generateText({
        model: await getModelForOrg(ctx, args.orgId, "analysis"),
        prompt,
      });

      // 4. Parse reconciled result
      let reconciledDoc: any;
      try {
        const raw = result.text.trim();
        const jsonText = raw.startsWith("```")
          ? raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
          : raw;
        reconciledDoc = JSON.parse(jsonText);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse reconciled JSON: ${parseErr.message}`);
      }

      await log(`Reconciliation: merge complete. Mapping to policy fields.`);

      // 5. Map to policy fields and update
      const fields = insuranceDocToPolicy(reconciledDoc);
      await ctx.runMutation(internal.policies.updateReconciliation, {
        id: args.policyId,
        fields,
      });

      // 6. Delete existing document chunks for this policy
      await ctx.runMutation(internal.documentChunks.deleteByPolicy, {
        policyId: args.policyId,
      });

      // 7. Re-chunk from the reconciled extraction
      // Use cl-sdk chunkDocument if available, otherwise create a simple chunk
      const chunks: Array<{ id: string; type: string; text: string; metadata?: any }> = [];
      try {
        const { chunkDocument } = await import("@claritylabs/cl-sdk");
        chunks.push(...chunkDocument(reconciledDoc));
      } catch {
        // Fallback: create a single chunk from the full document
        chunks.push({
          id: `${args.policyId}:full:0`,
          type: "full_document",
          text: JSON.stringify(reconciledDoc),
        });
      }

      if (chunks.length > 0) {
        const embed = makeEmbedText(ctx, args.orgId);
        for (const chunk of chunks) {
          try {
            const embedding = await embed(chunk.text);
            await ctx.runMutation(internal.documentChunks.insert, {
              orgId: args.orgId,
              policyId: args.policyId,
              chunkId: chunk.id,
              chunkType: chunk.type,
              text: chunk.text,
              metadata: chunk.metadata,
              embedding,
              createdAt: Date.now(),
            });
          } catch (embedErr: any) {
            await log(`Warning: failed to embed chunk ${chunk.id}: ${embedErr.message}`);
          }
        }
        await log(`Reconciliation: stored ${chunks.length} chunks for vector search.`);
      }

      // 8. Set reconciliationStatus to "reconciled"
      await ctx.runMutation(internal.policies.updateReconciliation, {
        id: args.policyId,
        reconciliationStatus: "reconciled",
      });

      await appendReconciliationLog(
        `Reconciled ${n} files. ${chunks.length} chunks generated. Tokens: ${result.usage?.inputTokens ?? 0}in/${result.usage?.outputTokens ?? 0}out`,
      );

      await log(`Reconciliation: complete. Policy updated from ${n} files.`);
    } catch (error: any) {
      const message = error.message || "Reconciliation failed";
      await ctx.runMutation(internal.policies.updateReconciliation, {
        id: args.policyId,
        reconciliationStatus: "error",
      });
      await appendReconciliationLog(`Error: ${message}`);
      console.error("Reconciliation failed:", message);
      throw error;
    }
  },
});
