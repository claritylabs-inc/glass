import { internalQuery } from "./_generated/server";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { readCarrierIdentity } from "./lib/carrierIdentity";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./lib/carrierIdentityEnrichment";
import type { CarrierIdentityBackfillResult } from "./lib/carrierIdentityBackfill";

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

export const reportInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const results = await ctx.db
      .query("carrierIdentityBackfillResults")
      .collect();
    const counts = {
      rebuilt: 0,
      unchanged: 0,
      enriched: 0,
      skipped: 0,
      failed: 0,
      pendingEnrichment: 0,
      enrichmentFailed: 0,
    };
    const reasons: Record<string, number> = {};
    for (const result of results) {
      counts[result.outcome] += 1;
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
      total: results.length,
      ...counts,
      reasons,
      enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
      latestUpdatedAt: Math.max(
        0,
        ...results.map((result) => result.updatedAt),
      ),
    };
  },
});
