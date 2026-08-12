"use node";

import { v } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { readCarrierIdentity } from "../lib/carrierIdentity";
import {
  buildPromotionEvidenceLedger,
  type ExtractionCompletionManifest,
  type PromotionEvidenceLedger,
} from "../lib/extractionPromotion";
import {
  classifyExtractionIntegrity,
  type ExtractionIntegrityClassification,
} from "../lib/extractionIntegrityAudit";
import {
  normalizeSourceTree,
  sourceNodeFromStoredSource,
  sourceSpanLikeFromStoredSource,
  type SourceSpanLike,
} from "../lib/sourceTree";

type EvidencePage = {
  page: Array<Record<string, unknown>>;
  continueCursor: string;
  isDone: boolean;
};

type EvidencePageQuery = FunctionReference<
  "query",
  "internal",
  { policyId: Id<"policies">; cursor: string | null },
  EvidencePage
>;

type AuditPolicyPage = {
  page: Array<{
    policy: Doc<"policies">;
    run: Doc<"policyExtractionRuns"> | null;
  }>;
  continueCursor: string;
  isDone: boolean;
};

type AuditResult = {
  policyId: string;
  carrier: string | undefined;
  policyNumber: string | undefined;
  isZurich: boolean;
  sourceFingerprint?: string;
  classification: ExtractionIntegrityClassification;
  reasons: string[];
  shouldReextract: boolean;
};

type AuditResponse = {
  results: AuditResult[];
  counts: {
    verified: number;
    legacyUnverified: number;
    postCutoverViolations: number;
    shouldReextract: number;
  };
  nextCursor: string;
  isDone: boolean;
};

async function readAllEvidence(
  ctx: ActionCtx,
  functionRef: EvidencePageQuery,
  policyId: Id<"policies">,
): Promise<Array<Record<string, unknown>>> {
  const values: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  while (true) {
    const result: EvidencePage = await ctx.runQuery(functionRef, {
      policyId,
      cursor,
    });
    values.push(...result.page);
    if (result.isDone) return values;
    cursor = result.continueCursor;
  }
}

function hasSourceBackedCarrierIdentity(value: unknown) {
  const identity = readCarrierIdentity(value);
  return Boolean(identity && (
    identity.sourceNodeIds.length > 0 ||
    identity.sourceSpanIds.length > 0 ||
    identity.legalEntities.some((entity) =>
      entity.sourceNodeIds.length > 0 || entity.sourceSpanIds.length > 0)
  ));
}

function isZurichPolicy(policy: { carrier?: unknown; carrierIdentity?: unknown }) {
  const identity = readCarrierIdentity(policy.carrierIdentity);
  return [
    policy.carrier,
    identity?.displayName,
    identity?.sourceName,
    identity?.operatingName,
    ...(identity?.legalEntities.map((entity) => entity.name) ?? []),
  ].some((value) => /\bzurich\b/i.test(String(value ?? "")));
}

export const audit = internalAction({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AuditResponse> => {
    const page: AuditPolicyPage = await ctx.runQuery(
      internal.extractionIntegrityAudit.listPoliciesPageInternal,
      { cursor: args.cursor ?? null, limit: args.limit },
    );
    const results: AuditResult[] = [];
    for (const { policy, run } of page.page) {
      const policyId = policy._id;
      const [spanDocs, nodeDocs]: [
        Array<Record<string, unknown>>,
        Array<Record<string, unknown>>,
      ] = await Promise.all([
        readAllEvidence(
          ctx,
          internal.extractionIntegrityAudit.listSourceSpansPageInternal,
          policyId,
        ),
        readAllEvidence(
          ctx,
          internal.extractionIntegrityAudit.listSourceNodesPageInternal,
          policyId,
        ),
      ]);
      const sourceSpans: SourceSpanLike[] = spanDocs.map((span) =>
        sourceSpanLikeFromStoredSource(span, String(policyId)));
      const storedNodes = nodeDocs
        .map((node) => sourceNodeFromStoredSource(node, String(policyId)))
        .filter((node): node is NonNullable<typeof node> => Boolean(node));
      const sourceTree = normalizeSourceTree(storedNodes, sourceSpans, String(policyId));
      const ledger: PromotionEvidenceLedger | undefined = sourceSpans.length > 0
        ? buildPromotionEvidenceLedger({ sourceSpans, sourceTree })
        : undefined;
      const postCutover = Boolean(policy.extractionPromotion);
      const manifest: ExtractionCompletionManifest | undefined =
        run?.completionManifest;
      const integrity = classifyExtractionIntegrity({
        postCutover,
        ledger,
        manifest,
        operationalProfile: policy.operationalProfile,
        hasValidCarrierIdentity: hasSourceBackedCarrierIdentity(policy.carrierIdentity),
      });
      const isZurich = isZurichPolicy(policy);
      results.push({
        policyId: String(policyId),
        carrier: policy.carrier,
        policyNumber: policy.policyNumber,
        isZurich,
        sourceFingerprint: ledger?.sourceFingerprint,
        ...integrity,
        shouldReextract: integrity.shouldReextract || isZurich,
        reasons: isZurich && !integrity.shouldReextract
          ? [...integrity.reasons, "targeted Zurich integrity revalidation"]
          : integrity.reasons,
      });
    }
    return {
      results,
      counts: {
        verified: results.filter((result) => result.classification === "verified").length,
        legacyUnverified: results.filter((result) => result.classification === "legacy_unverified").length,
        postCutoverViolations: results.filter((result) =>
          result.classification === "post_cutover_violation").length,
        shouldReextract: results.filter((result) => result.shouldReextract).length,
      },
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const queueAffected = internalAction({
  args: { policyIds: v.array(v.id("policies")) },
  handler: async (ctx, args): Promise<{
    queued: string[];
    skipped: Array<{ policyId: string; reason: string }>;
  }> => {
    const queued: string[] = [];
    const skipped: Array<{ policyId: string; reason: string }> = [];
    for (const policyId of [...new Set(args.policyIds)].slice(0, 25)) {
      const candidate = await ctx.runQuery(
        internal.extractionIntegrityAudit.getQueueCandidateInternal,
        { policyId },
      );
      if (!candidate) {
        skipped.push({ policyId: String(policyId), reason: "not_an_extractable_final_policy" });
        continue;
      }
      if (candidate.pipelineStatus === "running") {
        skipped.push({ policyId: String(policyId), reason: "already_running" });
        continue;
      }
      await ctx.scheduler.runAfter(
        0,
        internal.actions.policyExtraction.retryPolicyExtraction,
        { policyId, mode: "full" },
      );
      queued.push(String(policyId));
    }
    return { queued, skipped };
  },
});
