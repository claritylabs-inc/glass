import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { effectiveExtractionDataStage } from "./backfillDeclarationFacts";
import {
  acordTaxonomyBackfillPolicyFingerprint,
  type AcordTaxonomyBackfillDecision,
} from "./lib/acordTaxonomyBackfill";
import {
  acordTaxonomyBackfillReportValidator,
  emptyAcordTaxonomyBackfillReport,
  type AcordTaxonomyBackfillReport,
} from "./lib/acordTaxonomyBackfillReport";

const SOURCE_EVIDENCE_PAGE_SIZE = 10;
const MAX_WRITE_PAGE_RETRIES = 3;

const backfillDecisionValidator = v.object({
  patch: v.optional(v.record(v.string(), v.any())),
  lineChanged: v.boolean(),
  coverageCodesAdded: v.number(),
  productIdentityAdded: v.boolean(),
  reason: v.optional(v.string()),
  beforeLines: v.array(v.string()),
  afterLines: v.array(v.string()),
});

export const recordDryRunPageInternal = internalMutation({
  args: {
    runId: v.string(),
    cursorKey: v.string(),
    orgId: v.optional(v.id("organizations")),
    limit: v.number(),
    report: acordTaxonomyBackfillReportValidator,
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("acordTaxonomyDryRunPages")
      .withIndex("by_runId_cursorKey", (query) =>
        query.eq("runId", args.runId).eq("cursorKey", args.cursorKey)
      )
      .unique();
    if (existing) {
      return {
        continuationScheduled: !existing.isDone,
        isDone: existing.isDone,
      };
    }
    await ctx.db.insert("acordTaxonomyDryRunPages", {
      runId: args.runId,
      cursorKey: args.cursorKey,
      orgId: args.orgId,
      limit: args.limit,
      report: args.report,
      nextCursor: args.nextCursor,
      isDone: args.isDone,
      createdAt: args.createdAt,
    });
    if (!args.isDone) {
      if (!args.nextCursor) {
        throw new Error(
          "ACORD taxonomy dry-run page omitted its continuation",
        );
      }
      await ctx.scheduler.runAfter(
        0,
        internal.actions.backfillAcordTaxonomy.continueDryRun,
        {
          runId: args.runId,
          orgId: args.orgId,
          limit: args.limit,
          cursor: args.nextCursor,
        },
      );
    }
    return {
      continuationScheduled: !args.isDone,
      isDone: args.isDone,
    };
  },
});

export const resumeDryRunInternal = internalMutation({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("acordTaxonomyDryRunPages")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .order("desc")
      .first();
    if (!latest) {
      throw new Error(`ACORD taxonomy dry-run ${args.runId} was not found`);
    }
    if (latest.isDone) {
      return {
        dryRun: true as const,
        status: "completed" as const,
        continuationScheduled: false,
      };
    }
    if (!latest.nextCursor) {
      throw new Error(
        "ACORD taxonomy dry-run page omitted its resume cursor",
      );
    }
    await ctx.scheduler.runAfter(
      0,
      internal.actions.backfillAcordTaxonomy.continueDryRun,
      {
        runId: args.runId,
        orgId: latest.orgId,
        limit: latest.limit,
        cursor: latest.nextCursor,
      },
    );
    return {
      dryRun: true as const,
      status: "running" as const,
      continuationScheduled: true,
      resumeCursor: latest.nextCursor,
    };
  },
});

export const startWriteRunInternal = internalMutation({
  args: {
    runId: v.string(),
    orgId: v.optional(v.id("organizations")),
    limit: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("acordTaxonomyWriteRuns")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .unique();
    if (existing) return existing;
    const id = await ctx.db.insert("acordTaxonomyWriteRuns", {
      runId: args.runId,
      orgId: args.orgId,
      limit: args.limit,
      status: "running",
      retryCount: 0,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
    return await ctx.db.get(id);
  },
});

export const getWriteRunInternal = internalQuery({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("acordTaxonomyWriteRuns")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .unique(),
});

export const listWriteReportPagesInternal = internalQuery({
  args: {
    runId: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("acordTaxonomyWritePages")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .paginate({
        cursor: args.cursor,
        numItems: args.limit,
      }),
});

export const recordWritePageInternal = internalMutation({
  args: {
    runId: v.string(),
    cursor: v.union(v.string(), v.null()),
    cursorKey: v.string(),
    report: acordTaxonomyBackfillReportValidator,
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("acordTaxonomyWriteRuns")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .unique();
    if (!run) {
      throw new Error(`ACORD taxonomy write run ${args.runId} was not found`);
    }
    const existing = await ctx.db
      .query("acordTaxonomyWritePages")
      .withIndex("by_runId_cursorKey", (query) =>
        query.eq("runId", args.runId).eq("cursorKey", args.cursorKey)
      )
      .unique();
    const currentCursor = args.cursor ?? undefined;
    if (run.status === "completed") {
      return {
        dryRun: false as const,
        status: "completed" as const,
        continuationScheduled: false,
        isDone: true,
        stale: Boolean(existing),
      };
    }
    if (
      !existing &&
      run.nextCursor !== currentCursor
    ) {
      return {
        status: run.status,
        continuationScheduled: false,
        isDone: false,
        stale: true,
      };
    }
    if (!existing) {
      await ctx.db.insert("acordTaxonomyWritePages", {
        runId: args.runId,
        cursorKey: args.cursorKey,
        report: args.report,
        nextCursor: args.nextCursor,
        isDone: args.isDone,
        createdAt: args.createdAt,
      });
    }
    const page = existing ?? {
      nextCursor: args.nextCursor,
      isDone: args.isDone,
    };
    const pageIsCurrent =
      run.nextCursor === currentCursor ||
      run.nextCursor === page.nextCursor;
    if (!pageIsCurrent) {
      return {
        status: run.status,
        continuationScheduled: false,
        isDone: false,
        stale: true,
      };
    }
    if (!page.isDone && !page.nextCursor) {
      throw new Error(
        "ACORD taxonomy write page omitted its continuation",
      );
    }
    const shouldContinue = !page.isDone;
    await ctx.db.patch(run._id, {
      status: page.isDone ? "completed" : "running",
      nextCursor: page.isDone ? undefined : page.nextCursor,
      retryCount: 0,
      lastError: undefined,
      updatedAt: args.createdAt,
    });
    if (shouldContinue) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.backfillAcordTaxonomy.continueBackfill,
        {
          runId: args.runId,
          cursor: page.nextCursor!,
          retryCount: 0,
        },
      );
    }
    return {
      status: page.isDone ? "completed" as const : "running" as const,
      continuationScheduled: shouldContinue,
      isDone: page.isDone,
      stale: false,
    };
  },
});

export const recordWriteFailureInternal = internalMutation({
  args: {
    runId: v.string(),
    cursor: v.union(v.string(), v.null()),
    expectedRetryCount: v.number(),
    error: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("acordTaxonomyWriteRuns")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .unique();
    if (!run || run.status === "completed") {
      return {
        status: run?.status ?? "missing",
        continuationScheduled: false,
      };
    }
    if (
      run.nextCursor !== (args.cursor ?? undefined) ||
      run.retryCount !== args.expectedRetryCount
    ) {
      return {
        status: run.status,
        continuationScheduled: false,
      };
    }
    const retryCount = args.expectedRetryCount + 1;
    const retryScheduled = retryCount <= MAX_WRITE_PAGE_RETRIES;
    await ctx.db.patch(run._id, {
      status: retryScheduled ? "running" : "failed",
      nextCursor: args.cursor ?? undefined,
      retryCount,
      lastError: args.error,
      updatedAt: args.updatedAt,
    });
    if (retryScheduled) {
      await ctx.scheduler.runAfter(
        Math.min(2 ** (retryCount - 1) * 1_000, 30_000),
        internal.actions.backfillAcordTaxonomy.continueBackfill,
        {
          runId: args.runId,
          cursor: args.cursor,
          retryCount,
        },
      );
    }
    return {
      status: retryScheduled ? "running" as const : "failed" as const,
      continuationScheduled: retryScheduled,
      retryCount,
    };
  },
});

export const resumeWriteRunInternal = internalMutation({
  args: {
    runId: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("acordTaxonomyWriteRuns")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .unique();
    if (!run) {
      throw new Error(`ACORD taxonomy write run ${args.runId} was not found`);
    }
    if (run.status === "completed") {
      return {
        dryRun: false as const,
        status: "completed" as const,
        continuationScheduled: false,
      };
    }
    await ctx.db.patch(run._id, {
      status: "running",
      retryCount: 0,
      lastError: undefined,
      updatedAt: args.updatedAt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.backfillAcordTaxonomy.continueBackfill,
      {
        runId: args.runId,
        cursor: run.nextCursor ?? null,
        retryCount: 0,
      },
    );
    return {
      dryRun: false as const,
      status: "running" as const,
      continuationScheduled: true,
      resumeCursor: run.nextCursor,
    };
  },
});

export const listDryRunReportPagesInternal = internalQuery({
  args: {
    runId: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("acordTaxonomyDryRunPages")
      .withIndex("by_runId", (query) => query.eq("runId", args.runId))
      .paginate({
        cursor: args.cursor,
        numItems: args.limit,
      }),
});

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
  if (
    policy.pipelineStatus !== undefined &&
    policy.pipelineStatus !== "complete"
  ) {
    return "extraction_in_progress";
  }
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

export const getPolicySnapshotInternal = internalQuery({
  args: {
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    return policy
      ? {
          policy,
          fingerprint: acordTaxonomyBackfillPolicyFingerprint(
            policy as unknown as Record<string, unknown>,
          ),
          skipReason: skipReason(policy),
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

export const applyPolicyDecisionInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    dryRun: v.boolean(),
    expectedFingerprint: v.string(),
    decision: backfillDecisionValidator,
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
    if (
      acordTaxonomyBackfillPolicyFingerprint(
        policy as unknown as Record<string, unknown>,
      ) !== args.expectedFingerprint
    ) {
      recordSkip(report, "policy_changed_during_backfill");
      return report;
    }
    recordDecision(report, policy._id, args.decision);
    if (!args.dryRun && args.decision.patch) {
      await ctx.db.patch(policy._id, args.decision.patch);
    }
    return report;
  },
});
