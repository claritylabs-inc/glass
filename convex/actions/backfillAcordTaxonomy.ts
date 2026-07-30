"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalAction,
  type ActionCtx,
} from "../_generated/server";
import {
  emptyAcordTaxonomyBackfillReport,
  mergeAcordTaxonomyBackfillReports,
  type AcordTaxonomyBackfillReport,
} from "../lib/acordTaxonomyBackfillReport";

type BackfillPage = {
  policyIds: Id<"policies">[];
  nextCursor: string | null;
  isDone: boolean;
};

type DryRunPageExecutionReport = AcordTaxonomyBackfillReport & {
  runId: string;
  status: "running" | "completed";
};

type StoredDryRunReportPage = {
  report: AcordTaxonomyBackfillReport;
  orgId?: Id<"organizations">;
  limit: number;
  nextCursor?: string;
  isDone: boolean;
};

type StoredDryRunReportPageResult = {
  page: StoredDryRunReportPage[];
  isDone: boolean;
  continueCursor: string;
};

type DryRunAggregateReport = AcordTaxonomyBackfillReport & {
  runId: string;
  pageCount: number;
  status: "running" | "completed";
  resumeCursor?: string;
  orgId?: Id<"organizations">;
  limit?: number;
};

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
    report = mergeAcordTaxonomyBackfillReports(report, policyReport);
  }
  return { page, report };
}

async function runDryRunPage(
  ctx: ActionCtx,
  args: {
    runId: string;
    orgId?: Id<"organizations">;
    limit: number;
    cursor: string | null;
  },
): Promise<DryRunPageExecutionReport> {
  const { page, report } = await runPage(ctx, {
    orgId: args.orgId,
    dryRun: true,
    limit: args.limit,
    cursor: args.cursor,
  });
  const recorded: {
    continuationScheduled: boolean;
    isDone: boolean;
  } = await ctx.runMutation(
    internal.acordTaxonomyBackfillBatches.recordDryRunPageInternal,
    {
      runId: args.runId,
      cursorKey: args.cursor === null
        ? "initial"
        : `cursor:${args.cursor}`,
      orgId: args.orgId,
      limit: args.limit,
      report,
      nextCursor: page.isDone ? undefined : page.nextCursor ?? undefined,
      isDone: page.isDone,
      createdAt: dayjs().valueOf(),
    },
  );
  return {
    ...report,
    runId: args.runId,
    status: recorded.isDone ? "completed" as const : "running" as const,
    continuationScheduled: recorded.continuationScheduled,
  };
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

export const continueDryRun = internalAction({
  args: {
    runId: v.string(),
    orgId: v.optional(v.id("organizations")),
    limit: v.number(),
    cursor: v.string(),
  },
  handler: async (ctx, args): Promise<DryRunPageExecutionReport> =>
    await runDryRunPage(ctx, args),
});

const DRY_RUN_REPORT_PAGE_SIZE = 25;

export const report = internalAction({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args): Promise<DryRunAggregateReport> => {
    let aggregate = emptyAcordTaxonomyBackfillReport(true);
    let cursor: string | null = null;
    let pageCount = 0;
    let completed = false;
    let resumeCursor: string | undefined;
    let orgId: Id<"organizations"> | undefined;
    let limit: number | undefined;
    do {
      const page: StoredDryRunReportPageResult = await ctx.runQuery(
        internal.acordTaxonomyBackfillBatches
          .listDryRunReportPagesInternal,
        {
          runId: args.runId,
          cursor,
          limit: DRY_RUN_REPORT_PAGE_SIZE,
        },
      );
      for (const result of page.page) {
        aggregate = mergeAcordTaxonomyBackfillReports(
          aggregate,
          result.report,
        );
        pageCount += 1;
        completed ||= result.isDone;
        orgId ??= result.orgId;
        limit ??= result.limit;
        if (!result.isDone) resumeCursor = result.nextCursor;
      }
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
    if (pageCount === 0) {
      throw new Error(`ACORD taxonomy dry-run ${args.runId} was not found`);
    }
    return {
      ...aggregate,
      runId: args.runId,
      pageCount,
      status: completed ? "completed" as const : "running" as const,
      continuationScheduled: !completed && pageCount > 0,
      resumeCursor: completed ? undefined : resumeCursor,
      orgId,
      limit,
    };
  },
});

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<AcordTaxonomyBackfillReport | DryRunPageExecutionReport> => {
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (!dryRun) {
      return await runWritePage(ctx, {
        orgId: args.orgId,
        limit,
        cursor: null,
      });
    }

    return await runDryRunPage(ctx, {
      runId: crypto.randomUUID(),
      orgId: args.orgId,
      limit,
      cursor: null,
    });
  },
});
