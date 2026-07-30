"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalAction,
  type ActionCtx,
} from "../_generated/server";
import {
  emptyAcordTaxonomyBackfillReport,
  type AcordTaxonomyBackfillReport,
} from "../acordTaxonomyBackfillBatches";

type BackfillPage = {
  policyIds: Id<"policies">[];
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

async function runPage(
  ctx: ActionCtx,
  args: {
    orgId?: Id<"organizations">;
    dryRun: boolean;
    limit: number;
    cursor: string | null;
  },
) {
  const page: BackfillPage = await ctx.runQuery(
    internal.acordTaxonomyBackfillBatches.listPolicyIdsPageInternal,
    {
      orgId: args.orgId,
      limit: args.limit,
      cursor: args.cursor,
    },
  );
  let report = emptyAcordTaxonomyBackfillReport(args.dryRun);
  for (const policyId of page.policyIds) {
    const policyReport: AcordTaxonomyBackfillReport =
      await ctx.runMutation(
        internal.acordTaxonomyBackfillBatches.backfillPolicyInternal,
        {
          policyId,
          dryRun: args.dryRun,
        },
      );
    report = mergeReports(report, policyReport);
  }
  return { page, report };
}

async function runWritePage(
  ctx: ActionCtx,
  args: {
    orgId?: Id<"organizations">;
    limit: number;
    cursor: string | null;
  },
) {
  const { page, report } = await runPage(ctx, {
    ...args,
    dryRun: false,
  });
  if (!page.isDone) {
    if (!page.nextCursor) {
      throw new Error("ACORD taxonomy backfill page omitted its continuation");
    }
    await ctx.scheduler.runAfter(
      0,
      internal.actions.backfillAcordTaxonomy.continueBackfill,
      {
        orgId: args.orgId,
        limit: args.limit,
        cursor: page.nextCursor,
      },
    );
    report.continuationScheduled = true;
  }
  return report;
}

export const continueBackfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    limit: v.number(),
    cursor: v.string(),
  },
  handler: async (ctx, args): Promise<AcordTaxonomyBackfillReport> =>
    await runWritePage(ctx, args),
});

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AcordTaxonomyBackfillReport> => {
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (!dryRun) {
      return await runWritePage(ctx, {
        orgId: args.orgId,
        limit,
        cursor: null,
      });
    }

    let report = emptyAcordTaxonomyBackfillReport(true);
    let cursor: string | null = null;
    do {
      const result = await runPage(ctx, {
        orgId: args.orgId,
        dryRun: true,
        limit,
        cursor,
      });
      report = mergeReports(report, result.report);
      if (!result.page.isDone && !result.page.nextCursor) {
        throw new Error(
          "ACORD taxonomy dry-run page omitted its continuation",
        );
      }
      cursor = result.page.isDone ? null : result.page.nextCursor;
    } while (cursor);
    return report;
  },
});
