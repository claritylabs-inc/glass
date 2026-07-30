import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { effectiveExtractionDataStage } from "./backfillDeclarationFacts";
import {
  rebuildAcordTaxonomyFromStoredSources,
  type AcordTaxonomyBackfillDecision,
} from "./lib/acordTaxonomyBackfill";

export type AcordTaxonomyBackfillReport = {
  dryRun: boolean;
  scannedCount: number;
  changedCount: number;
  lineChangedCount: number;
  coverageCodesAdded: number;
  productIdentitiesAdded: number;
  skippedReasons: Record<string, number>;
  samples: Array<{
    policyId: Id<"policies">;
    beforeLines: string[];
    afterLines: string[];
    coverageCodesAdded: number;
    productIdentityAdded: boolean;
  }>;
  continuationScheduled: boolean;
};

export function emptyAcordTaxonomyBackfillReport(
  dryRun: boolean,
): AcordTaxonomyBackfillReport {
  return {
    dryRun,
    scannedCount: 0,
    changedCount: 0,
    lineChangedCount: 0,
    coverageCodesAdded: 0,
    productIdentitiesAdded: 0,
    skippedReasons: {},
    samples: [],
    continuationScheduled: false,
  };
}

function recordSkip(report: AcordTaxonomyBackfillReport, reason: string) {
  report.skippedReasons[reason] =
    (report.skippedReasons[reason] ?? 0) + 1;
}

function skipReason(policy: {
  deletedAt?: number;
  pipelineStatus?: string;
  extractionDataStage?: "placeholder" | "preview" | "final";
}) {
  if (policy.deletedAt !== undefined) return "archived_policy";
  if (policy.pipelineStatus === "error") return "failed_extraction";
  if (effectiveExtractionDataStage(policy) !== "final") {
    return "not_final_policy";
  }
  return undefined;
}

function recordDecision(
  report: AcordTaxonomyBackfillReport,
  policyId: Id<"policies">,
  decision: AcordTaxonomyBackfillDecision,
) {
  if (!decision.patch) {
    recordSkip(report, decision.reason ?? "unchanged");
    return;
  }
  report.changedCount += 1;
  if (decision.lineChanged) report.lineChangedCount += 1;
  report.coverageCodesAdded += decision.coverageCodesAdded;
  if (decision.productIdentityAdded) {
    report.productIdentitiesAdded += 1;
  }
  report.samples.push({
    policyId,
    beforeLines: decision.beforeLines,
    afterLines: decision.afterLines,
    coverageCodesAdded: decision.coverageCodesAdded,
    productIdentityAdded: decision.productIdentityAdded,
  });
}

export const listPolicyIdsPageInternal = internalQuery({
  args: {
    orgId: v.optional(v.id("organizations")),
    limit: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const page = args.orgId
      ? await ctx.db
          .query("policies")
          .withIndex("by_orgId", (query) =>
            query.eq("orgId", args.orgId!)
          )
          .paginate({
            numItems: args.limit,
            cursor: args.cursor ?? null,
          })
      : await ctx.db.query("policies").paginate({
          numItems: args.limit,
          cursor: args.cursor ?? null,
        });
    return {
      policyIds: page.page.map((policy) => policy._id),
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const backfillPolicyInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    dryRun: v.boolean(),
  },
  handler: async (ctx, args): Promise<AcordTaxonomyBackfillReport> => {
    const report = emptyAcordTaxonomyBackfillReport(args.dryRun);
    const policy = await ctx.db.get(args.policyId);
    if (!policy) {
      recordSkip(report, "missing_policy");
      return report;
    }
    report.scannedCount = 1;
    const reason = skipReason(policy);
    if (reason) {
      recordSkip(report, reason);
      return report;
    }

    const [sourceSpans, sourceNodes] = await Promise.all([
      ctx.db
        .query("sourceSpans")
        .withIndex("by_policyId", (query) =>
          query.eq("policyId", policy._id)
        )
        .collect(),
      ctx.db
        .query("sourceNodes")
        .withIndex("by_policyId", (query) =>
          query.eq("policyId", policy._id)
        )
        .collect(),
    ]);
    const decision = rebuildAcordTaxonomyFromStoredSources({
      policy,
      sourceSpans,
      sourceNodes,
    });
    recordDecision(report, policy._id, decision);
    if (!args.dryRun && decision.patch) {
      await ctx.db.patch(policy._id, decision.patch);
    }
    return report;
  },
});
