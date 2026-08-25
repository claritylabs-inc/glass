import dayjs from "dayjs";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import type { ClRouterResponseMetadata } from "./lib/clRouterClient";
import { requireOperator } from "./lib/operatorIdentity";

const RETENTION_DAYS = 30;

const modelProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("fireworks"),
  v.literal("moonshot"),
  v.literal("deepseek"),
);

const runValidator = v.object({
  runId: v.string(),
  sessionKey: v.string(),
  orgId: v.optional(v.id("organizations")),
  task: v.string(),
  taskKind: v.string(),
  channel: v.string(),
  label: v.string(),
  phase: v.string(),
  parentRequestId: v.optional(v.string()),
});

const failureAttemptValidator = v.object({
  attempt: v.number(),
  provider: modelProviderValidator,
  model: v.string(),
  outcome: v.union(v.literal("error"), v.literal("timeout")),
  errorCode: v.optional(v.string()),
});

function expiresAt(timestamp: number) {
  return dayjs(timestamp).add(RETENTION_DAYS, "day").valueOf();
}

export const recordResponseInternal = internalMutation({
  args: {
    run: runValidator,
    step: v.number(),
    hasTools: v.boolean(),
    hasToolResults: v.boolean(),
    maxOutputTokens: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    hitOutputLimit: v.optional(v.boolean()),
    visibleTextLength: v.optional(v.number()),
    toolNames: v.optional(v.array(v.string())),
    response: v.any(),
  },
  handler: async (ctx, args) => {
    const response = args.response as ClRouterResponseMetadata;
    const timestamp = dayjs().valueOf();
    const completionIssue = args.hitOutputLimit
      ? "output_limit" as const
      : args.visibleTextLength === 0 && (args.toolNames?.length ?? 0) === 0
        ? "empty_response" as const
        : undefined;
    await ctx.db.insert("modelRoutingEvents", {
      kind: "model_step",
      ...args.run,
      step: args.step,
      hasTools: args.hasTools,
      hasToolResults: args.hasToolResults,
      requestId: response.requestId,
      provider: response.model.provider,
      model: response.model.model,
      routeSource: response.routing.routeSource,
      transport: "cl-router",
      routing: response.routing,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      ...(response.usage.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: response.usage.reasoningTokens }),
      cachedInputTokens: response.usage.cachedInputTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      ...(args.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: args.maxOutputTokens }),
      ...(args.finishReason === undefined
        ? {}
        : { finishReason: args.finishReason }),
      ...(args.hitOutputLimit === undefined
        ? {}
        : { hitOutputLimit: args.hitOutputLimit }),
      ...(args.visibleTextLength === undefined
        ? {}
        : { visibleTextLength: args.visibleTextLength }),
      ...(args.toolNames === undefined
        ? {}
        : {
            toolCallCount: args.toolNames.length,
            toolNames: args.toolNames,
          }),
      costUsd: response.costUsd,
      costStatus: response.costStatus,
      status: completionIssue ? "incomplete" : "complete",
      ...(completionIssue ? { completionIssue } : {}),
      timestamp,
      expiresAt: expiresAt(timestamp),
    });
  },
});

export const recordFallbackInternal = internalMutation({
  args: {
    run: runValidator,
    step: v.number(),
    hasTools: v.boolean(),
    hasToolResults: v.boolean(),
    error: v.string(),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    fallbackProvider: v.optional(modelProviderValidator),
    fallbackModel: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("direct"), v.literal("cl-router"))),
    requestId: v.optional(v.string()),
    routerCode: v.optional(v.string()),
    routerStatus: v.optional(v.number()),
    routerRetryable: v.optional(v.boolean()),
    routerExecutionStarted: v.optional(v.boolean()),
    failureAttempts: v.optional(v.array(failureAttemptValidator)),
  },
  handler: async (ctx, args) => {
    const timestamp = dayjs().valueOf();
    await ctx.db.insert("modelRoutingEvents", {
      kind: "direct_fallback",
      ...args.run,
      step: args.step,
      hasTools: args.hasTools,
      hasToolResults: args.hasToolResults,
      status: "fallback",
      error: args.error,
      provider: args.provider,
      model: args.model,
      fallbackProvider: args.fallbackProvider,
      fallbackModel: args.fallbackModel,
      routeSource: args.routeSource,
      transport: args.transport,
      requestId: args.requestId,
      routerCode: args.routerCode,
      routerStatus: args.routerStatus,
      routerRetryable: args.routerRetryable,
      routerExecutionStarted: args.routerExecutionStarted,
      failureAttempts: args.failureAttempts,
      timestamp,
      expiresAt: expiresAt(timestamp),
    });
  },
});

export const recordRunInternal = internalMutation({
  args: {
    run: runValidator,
    status: v.union(
      v.literal("complete"),
      v.literal("incomplete"),
      v.literal("error"),
    ),
    requestId: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("direct"), v.literal("cl-router"))),
    fallbackProvider: v.optional(modelProviderValidator),
    fallbackModel: v.optional(v.string()),
    fallbackReason: v.optional(v.string()),
    routerCode: v.optional(v.string()),
    routerStatus: v.optional(v.number()),
    routerRetryable: v.optional(v.boolean()),
    routerExecutionStarted: v.optional(v.boolean()),
    failureAttempts: v.optional(v.array(failureAttemptValidator)),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    maxOutputTokens: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    hitOutputLimit: v.optional(v.boolean()),
    visibleTextLength: v.optional(v.number()),
    toolCallCount: v.number(),
    completedToolCount: v.number(),
    toolNames: v.array(v.string()),
    workflowOutcomeCount: v.number(),
    workflowFailureCount: v.number(),
    completionIssue: v.optional(
      v.union(
        v.literal("empty_response"),
        v.literal("output_limit"),
        v.literal("workflow_failure"),
      ),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = dayjs().valueOf();
    await ctx.db.insert("modelRoutingEvents", {
      kind: "run",
      ...args.run,
      status: args.status,
      requestId: args.requestId,
      provider: args.provider,
      model: args.model,
      routeSource: args.routeSource,
      transport: args.transport,
      fallbackProvider: args.fallbackProvider,
      fallbackModel: args.fallbackModel,
      fallbackReason: args.fallbackReason,
      routerCode: args.routerCode,
      routerStatus: args.routerStatus,
      routerRetryable: args.routerRetryable,
      routerExecutionStarted: args.routerExecutionStarted,
      failureAttempts: args.failureAttempts,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      ...(args.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: args.reasoningTokens }),
      cachedInputTokens: args.cachedInputTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      ...(args.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: args.maxOutputTokens }),
      ...(args.finishReason === undefined
        ? {}
        : { finishReason: args.finishReason }),
      ...(args.hitOutputLimit === undefined
        ? {}
        : { hitOutputLimit: args.hitOutputLimit }),
      ...(args.visibleTextLength === undefined
        ? {}
        : { visibleTextLength: args.visibleTextLength }),
      toolCallCount: args.toolCallCount,
      completedToolCount: args.completedToolCount,
      toolNames: args.toolNames,
      workflowOutcomeCount: args.workflowOutcomeCount,
      workflowFailureCount: args.workflowFailureCount,
      ...(args.completionIssue === undefined
        ? {}
        : { completionIssue: args.completionIssue }),
      error: args.error,
      timestamp,
      expiresAt: expiresAt(timestamp),
    });
  },
});

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 200), 500));
    return await ctx.db
      .query("modelRoutingEvents")
      .withIndex("time")
      .order("desc")
      .take(limit);
  },
});

export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await ctx.db
      .query("modelRoutingEvents")
      .withIndex("time")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const sweepExpired = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(
      1,
      Math.min(Math.floor(args.batchSize ?? 500), 1_000),
    );
    const expired = await ctx.db
      .query("modelRoutingEvents")
      .withIndex("expiration", (q) => q.lt("expiresAt", dayjs().valueOf()))
      .take(limit);
    for (const event of expired) await ctx.db.delete(event._id);
    const continuationScheduled = expired.length === limit;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(0, internal.modelRoutingEvents.sweepExpired, {
        batchSize: limit,
      });
    }
    return { deleted: expired.length, continuationScheduled };
  },
});
