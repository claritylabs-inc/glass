import { v } from "convex/values";
import dayjs from "dayjs";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { readCarrierIdentity } from "./lib/carrierIdentity";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./lib/carrierIdentityEnrichment";
import {
  carrierIdentityBackfillPolicyFingerprint,
  carrierIdentityBackfillSkipReason,
  type CarrierIdentityBackfillResult,
} from "./lib/carrierIdentityBackfill";

const REPORT_PAGE_SIZE = 25;
const SOURCE_EVIDENCE_PAGE_SIZE = 10;

const backfillOutcomeValidator = v.union(
  v.literal("pending"),
  v.literal("rebuilt"),
  v.literal("unchanged"),
  v.literal("skipped"),
  v.literal("failed"),
);

type CarrierIdentityBackfillCounts = {
  pending: number;
  rebuilt: number;
  unchanged: number;
  enriched: number;
  skipped: number;
  failed: number;
  pendingEnrichment: number;
  enrichmentFailed: number;
};

type CarrierIdentityBackfillReportPage = {
  total: number;
  counts: CarrierIdentityBackfillCounts;
  reasons: Record<string, number>;
  latestUpdatedAt: number;
  isDone: boolean;
  continueCursor: string;
};

function emptyCounts(): CarrierIdentityBackfillCounts {
  return {
    pending: 0,
    rebuilt: 0,
    unchanged: 0,
    enriched: 0,
    skipped: 0,
    failed: 0,
    pendingEnrichment: 0,
    enrichmentFailed: 0,
  };
}

export async function recordCarrierIdentityBackfillResult(
  ctx: Pick<GenericMutationCtx<DataModel>, "db">,
  policyId: Id<"policies">,
  result: CarrierIdentityBackfillResult,
  updatedAt: number,
) {
  const existing = await ctx.db
    .query("carrierIdentityBackfillResults")
    .withIndex("by_policyId", (query) => query.eq("policyId", policyId))
    .first();
  const value = {
    policyId,
    outcome: result.outcome,
    reason: result.reason,
    shouldEnrich: result.shouldEnrich,
    updatedAt,
  };
  if (existing) {
    await ctx.db.patch(existing._id, value);
    return existing._id;
  }
  return await ctx.db.insert("carrierIdentityBackfillResults", value);
}

export const getPolicySnapshotInternal = internalQuery({
  args: {
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    return policy
      ? {
          policy,
          fingerprint: carrierIdentityBackfillPolicyFingerprint(
            policy as unknown as Record<string, unknown>,
          ),
        }
      : null;
  },
});

export const listSourceSpansPageInternal = internalQuery({
  args: {
    policyId: v.id("policies"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("sourceSpans")
      .withIndex("by_policyId", (query) =>
        query.eq("policyId", args.policyId)
      )
      .paginate({
        cursor: args.cursor,
        numItems: SOURCE_EVIDENCE_PAGE_SIZE,
      }),
});

export const listSourceNodesPageInternal = internalQuery({
  args: {
    policyId: v.id("policies"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (query) =>
        query.eq("policyId", args.policyId)
      )
      .paginate({
        cursor: args.cursor,
        numItems: SOURCE_EVIDENCE_PAGE_SIZE,
      });
    return {
      ...page,
      page: page.page.map(({ embedding: _embedding, ...node }) => node),
    };
  },
});

export const applyRebuildInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    expectedFingerprint: v.string(),
    result: v.object({
      outcome: backfillOutcomeValidator,
      reason: v.optional(v.string()),
      shouldEnrich: v.boolean(),
      set: v.record(v.string(), v.any()),
      unset: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const policy = await ctx.db.get(args.policyId);
    if (!policy) {
      await recordCarrierIdentityBackfillResult(
        ctx,
        args.policyId,
        {
          outcome: "failed",
          reason: "policy_missing_during_backfill",
          shouldEnrich: false,
        },
        now,
      );
      return;
    }
    const skipReason = carrierIdentityBackfillSkipReason(policy);
    if (skipReason) {
      await recordCarrierIdentityBackfillResult(
        ctx,
        args.policyId,
        {
          outcome: "skipped",
          reason: skipReason,
          shouldEnrich: false,
        },
        now,
      );
      return;
    }
    if (
      carrierIdentityBackfillPolicyFingerprint(
        policy as unknown as Record<string, unknown>,
      ) !== args.expectedFingerprint
    ) {
      await recordCarrierIdentityBackfillResult(
        ctx,
        args.policyId,
        {
          outcome: "failed",
          reason: "policy_changed_during_backfill",
          shouldEnrich: false,
        },
        now,
      );
      return;
    }

    const patch: Record<string, unknown> = { ...args.result.set };
    for (const key of args.result.unset) patch[key] = undefined;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.policyId, patch);
    }
    await recordCarrierIdentityBackfillResult(
      ctx,
      args.policyId,
      {
        outcome: args.result.outcome,
        reason: args.result.reason,
        shouldEnrich: args.result.shouldEnrich,
      },
      now,
    );
    if (args.result.shouldEnrich) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.enrichCarrierIdentity.ensureInternal,
        { policyId: args.policyId },
      );
    }
  },
});

export const reportPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<CarrierIdentityBackfillReportPage> => {
    const results = await ctx.db
      .query("carrierIdentityBackfillResults")
      .paginate({
        cursor: args.cursor,
        numItems: REPORT_PAGE_SIZE,
      });
    const counts = emptyCounts();
    const reasons: Record<string, number> = {};
    let latestUpdatedAt = 0;
    for (const result of results.page) {
      counts[result.outcome] += 1;
      latestUpdatedAt = Math.max(latestUpdatedAt, result.updatedAt);
      if (result.reason) {
        reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
      }
      if (
        result.outcome === "pending" ||
        result.outcome === "skipped" ||
        result.outcome === "failed"
      ) {
        continue;
      }
      const policy = await ctx.db.get(result.policyId);
      const identity = readCarrierIdentity(policy?.carrierIdentity);
      if (
        identity?.branding?.enrichmentVersion ===
        CARRIER_IDENTITY_ENRICHMENT_VERSION
      ) {
        counts.enriched += 1;
      } else if (result.shouldEnrich) {
        if (policy?.carrierIdentityEnrichmentStatus === "failed") {
          counts.enrichmentFailed += 1;
        } else {
          counts.pendingEnrichment += 1;
        }
      }
    }
    return {
      total: results.page.length,
      counts,
      reasons,
      latestUpdatedAt,
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

export const reportInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const counts = emptyCounts();
    const reasons: Record<string, number> = {};
    let total = 0;
    let latestUpdatedAt = 0;
    let cursor: string | null = null;

    while (true) {
      const page: CarrierIdentityBackfillReportPage = await ctx.runQuery(
        internal.carrierIdentityBackfill.reportPageInternal,
        { cursor },
      );
      total += page.total;
      latestUpdatedAt = Math.max(latestUpdatedAt, page.latestUpdatedAt);
      for (const key of Object.keys(counts) as Array<
        keyof CarrierIdentityBackfillCounts
      >) {
        counts[key] += page.counts[key];
      }
      for (const [reason, count] of Object.entries(page.reasons)) {
        reasons[reason] = (reasons[reason] ?? 0) + count;
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    return {
      total,
      ...counts,
      reasons,
      enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
      latestUpdatedAt,
    };
  },
});
