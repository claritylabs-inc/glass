import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalQuery,
} from "./_generated/server";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { readCarrierIdentity } from "./lib/carrierIdentity";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./lib/carrierIdentityEnrichment";
import type { CarrierIdentityBackfillResult } from "./lib/carrierIdentityBackfill";

const REPORT_PAGE_SIZE = 25;

type CarrierIdentityBackfillCounts = {
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
      if (result.outcome === "skipped" || result.outcome === "failed") {
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
