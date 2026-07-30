"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  emptyAcordTaxonomyBackfillReport,
  type AcordTaxonomyBackfillReport,
} from "../acordTaxonomyBackfillBatches";

type AcordTaxonomyBackfillBatchResult =
  AcordTaxonomyBackfillReport & {
    nextCursor: string | null;
    isDone: boolean;
  };

function mergeReports(
  left: AcordTaxonomyBackfillReport,
  right: AcordTaxonomyBackfillReport,
): AcordTaxonomyBackfillReport {
  const skippedReasons = { ...left.skippedReasons };
  for (const [reason, count] of Object.entries(right.skippedReasons)) {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + count;
  }
  return {
    dryRun: left.dryRun,
    scannedCount: left.scannedCount + right.scannedCount,
    changedCount: left.changedCount + right.changedCount,
    lineChangedCount:
      left.lineChangedCount + right.lineChangedCount,
    coverageCodesAdded:
      left.coverageCodesAdded + right.coverageCodesAdded,
    productIdentitiesAdded:
      left.productIdentitiesAdded + right.productIdentitiesAdded,
    skippedReasons,
    samples: [...left.samples, ...right.samples].slice(0, 25),
    continuationScheduled:
      left.continuationScheduled || right.continuationScheduled,
  };
}

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AcordTaxonomyBackfillReport> => {
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    let report = emptyAcordTaxonomyBackfillReport(dryRun);
    let cursor: string | null = null;

    do {
      const batch: AcordTaxonomyBackfillBatchResult =
        await ctx.runMutation(
        internal.acordTaxonomyBackfillBatches
          .backfillPoliciesBatchInternal,
        {
          orgId: args.orgId,
          dryRun,
          limit,
          cursor,
        },
      );
      report = mergeReports(report, batch);
      cursor =
        dryRun && !batch.isDone ? batch.nextCursor : null;
    } while (dryRun && cursor);

    return report;
  },
});
