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
  rebuildAcordTaxonomyFromStoredSources,
  type AcordTaxonomyBackfillDecision,
} from "../lib/acordTaxonomyBackfill";
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

type EvidencePage = {
  page: Array<Record<string, unknown>>;
  continueCursor: string;
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

type BackfillAggregateReport = AcordTaxonomyBackfillReport & {
  runId: string;
  pageCount: number;
  status: "running" | "completed" | "failed";
  resumeCursor?: string;
  orgId?: Id<"organizations">;
  limit?: number;
  retryCount?: number;
  lastError?: string;
};

type WritePageExecutionReport = AcordTaxonomyBackfillReport & {
  runId: string;
  status: "running" | "completed" | "failed";
  resumeCursor?: string;
  retryCount: number;
  lastError?: string;
};

type StoredWriteRun = {
  runId: string;
  orgId?: Id<"organizations">;
  limit: number;
  status: "running" | "completed" | "failed";
  nextCursor?: string;
  retryCount: number;
  lastError?: string;
};

type StoredWriteReportPageResult = {
  page: Array<{
    report: AcordTaxonomyBackfillReport;
  }>;
  isDone: boolean;
  continueCursor: string;
};

async function readAllSourceSpans(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  const sourceSpans: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  while (true) {
    const result: EvidencePage = await ctx.runQuery(
      internal.acordTaxonomyBackfillBatches.listSourceSpansPageInternal,
      { policyId, cursor },
    );
    sourceSpans.push(...result.page);
    if (result.isDone) return sourceSpans;
    cursor = result.continueCursor;
  }
}

async function readAllSourceNodes(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  const sourceNodes: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  while (true) {
    const result: EvidencePage = await ctx.runQuery(
      internal.acordTaxonomyBackfillBatches.listSourceNodesPageInternal,
      { policyId, cursor },
    );
    sourceNodes.push(...result.page);
    if (result.isDone) return sourceNodes;
    cursor = result.continueCursor;
  }
}

function noOpDecision(reason: string): AcordTaxonomyBackfillDecision {
  return {
    lineChanged: false,
    coverageCodesAdded: 0,
    productIdentityAdded: false,
    reason,
    beforeLines: [],
    afterLines: [],
  };
}

async function runPolicy(
  ctx: ActionCtx,
  policyId: Id<"policies">,
  dryRun: boolean,
) {
  const snapshot = await ctx.runQuery(
    internal.acordTaxonomyBackfillBatches.getPolicySnapshotInternal,
    { policyId },
  );
  let decision: AcordTaxonomyBackfillDecision;
  if (!snapshot || snapshot.skipReason) {
    decision = noOpDecision(snapshot?.skipReason ?? "missing_policy");
  } else {
    const [sourceSpans, sourceNodes] = await Promise.all([
      readAllSourceSpans(ctx, policyId),
      readAllSourceNodes(ctx, policyId),
    ]);
    decision = rebuildAcordTaxonomyFromStoredSources({
      policy: snapshot.policy,
      sourceSpans,
      sourceNodes,
    });
  }
  return await ctx.runMutation(
    internal.acordTaxonomyBackfillBatches.applyPolicyDecisionInternal,
    {
      policyId,
      dryRun,
      expectedFingerprint: snapshot?.fingerprint ?? "",
      decision,
    },
  );
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
    const policyReport: AcordTaxonomyBackfillReport = await runPolicy(
      ctx,
      policyId,
      args.dryRun,
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
    runId: string;
    orgId?: Id<"organizations">;
    limit: number;
    cursor: string | null;
    retryCount: number;
  },
): Promise<WritePageExecutionReport> {
  try {
    const { page, report } = await runPage(ctx, {
      orgId: args.orgId,
      limit: args.limit,
      cursor: args.cursor,
      dryRun: false,
    });
    const recorded: {
      status: "running" | "completed" | "failed";
      continuationScheduled: boolean;
      isDone: boolean;
    } = await ctx.runMutation(
      internal.acordTaxonomyBackfillBatches.recordWritePageInternal,
      {
        runId: args.runId,
        cursor: args.cursor,
        cursorKey: args.cursor === null
          ? "initial"
          : `cursor:${args.cursor}`,
        report,
        nextCursor: page.isDone ? undefined : page.nextCursor ?? undefined,
        isDone: page.isDone,
        createdAt: dayjs().valueOf(),
      },
    );
    return {
      ...report,
      runId: args.runId,
      status: recorded.status,
      continuationScheduled: recorded.continuationScheduled,
      resumeCursor: page.isDone ? undefined : page.nextCursor ?? undefined,
      retryCount: 0,
    };
  } catch (error) {
    const lastError = error instanceof Error
      ? error.message.slice(0, 500)
      : "Unknown ACORD taxonomy write-page failure";
    const retry: {
      status: string;
      continuationScheduled: boolean;
      retryCount?: number;
    } = await ctx.runMutation(
      internal.acordTaxonomyBackfillBatches.recordWriteFailureInternal,
      {
        runId: args.runId,
        cursor: args.cursor,
        expectedRetryCount: args.retryCount,
        error: lastError,
        updatedAt: dayjs().valueOf(),
      },
    );
    return {
      ...emptyAcordTaxonomyBackfillReport(false),
      runId: args.runId,
      status: retry.status === "completed"
        ? "completed"
        : retry.status === "failed" || retry.status === "missing"
          ? "failed"
          : "running",
      continuationScheduled: retry.continuationScheduled,
      resumeCursor: args.cursor ?? undefined,
      retryCount: retry.retryCount ?? args.retryCount,
      lastError,
    };
  }
}

export const continueBackfill = internalAction({
  args: {
    runId: v.string(),
    cursor: v.union(v.string(), v.null()),
    retryCount: v.number(),
  },
  handler: async (ctx, args): Promise<WritePageExecutionReport> => {
    const run: StoredWriteRun | null = await ctx.runQuery(
      internal.acordTaxonomyBackfillBatches.getWriteRunInternal,
      { runId: args.runId },
    );
    if (!run || run.status === "completed") {
      return {
        ...emptyAcordTaxonomyBackfillReport(false),
        runId: args.runId,
        status: run?.status ?? "failed",
        continuationScheduled: false,
        retryCount: run?.retryCount ?? args.retryCount,
      };
    }
    if (
      run.retryCount !== args.retryCount ||
      run.nextCursor !== (args.cursor ?? undefined)
    ) {
      return {
        ...emptyAcordTaxonomyBackfillReport(false),
        runId: args.runId,
        status: run.status,
        continuationScheduled: false,
        resumeCursor: run.nextCursor,
        retryCount: run.retryCount,
        lastError: run.lastError,
      };
    }
    return await runWritePage(ctx, {
      runId: args.runId,
      orgId: run.orgId,
      limit: run.limit,
      cursor: args.cursor,
      retryCount: args.retryCount,
    });
  },
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
  handler: async (ctx, args): Promise<BackfillAggregateReport> => {
    const writeRun: StoredWriteRun | null = await ctx.runQuery(
      internal.acordTaxonomyBackfillBatches.getWriteRunInternal,
      { runId: args.runId },
    );
    if (writeRun) {
      let aggregate = emptyAcordTaxonomyBackfillReport(false);
      let cursor: string | null = null;
      let pageCount = 0;
      do {
        const page: StoredWriteReportPageResult = await ctx.runQuery(
          internal.acordTaxonomyBackfillBatches
            .listWriteReportPagesInternal,
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
        }
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
      return {
        ...aggregate,
        runId: args.runId,
        pageCount,
        status: writeRun.status,
        continuationScheduled: writeRun.status === "running",
        resumeCursor:
          writeRun.status === "completed" ? undefined : writeRun.nextCursor,
        orgId: writeRun.orgId,
        limit: writeRun.limit,
        retryCount: writeRun.retryCount,
        lastError: writeRun.lastError,
      };
    }

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

export const resume = internalAction({
  args: {
    runId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    dryRun: boolean;
    status: "running" | "completed";
    continuationScheduled: boolean;
    resumeCursor?: string;
  }> => {
    const writeRun: StoredWriteRun | null = await ctx.runQuery(
      internal.acordTaxonomyBackfillBatches.getWriteRunInternal,
      { runId: args.runId },
    );
    if (writeRun) {
      return await ctx.runMutation(
        internal.acordTaxonomyBackfillBatches.resumeWriteRunInternal,
        {
          runId: args.runId,
          updatedAt: dayjs().valueOf(),
        },
      );
    }
    return await ctx.runMutation(
      internal.acordTaxonomyBackfillBatches.resumeDryRunInternal,
      { runId: args.runId },
    );
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
  ): Promise<WritePageExecutionReport | DryRunPageExecutionReport> => {
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (!dryRun) {
      const runId = crypto.randomUUID();
      await ctx.runMutation(
        internal.acordTaxonomyBackfillBatches.startWriteRunInternal,
        {
          runId,
          orgId: args.orgId,
          limit,
          createdAt: dayjs().valueOf(),
        },
      );
      return await runWritePage(ctx, {
        runId,
        orgId: args.orgId,
        limit,
        cursor: null,
        retryCount: 0,
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
