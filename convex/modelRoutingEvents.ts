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

function expiresAt(timestamp: number) {
  return dayjs(timestamp).add(RETENTION_DAYS, "day").valueOf();
}

export const recordResponseInternal = internalMutation({
  args: {
    run: runValidator,
    step: v.number(),
    hasTools: v.boolean(),
    hasToolResults: v.boolean(),
    response: v.any(),
  },
  handler: async (ctx, args) => {
    const response = args.response as ClRouterResponseMetadata;
    const timestamp = dayjs().valueOf();
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
      cachedInputTokens: response.usage.cachedInputTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      costUsd: response.costUsd,
      costStatus: response.costStatus,
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
      timestamp,
      expiresAt: expiresAt(timestamp),
    });
  },
});

export const recordRunInternal = internalMutation({
  args: {
    run: runValidator,
    status: v.union(v.literal("complete"), v.literal("error")),
    requestId: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("direct"), v.literal("cl-router"))),
    fallbackProvider: v.optional(modelProviderValidator),
    fallbackModel: v.optional(v.string()),
    fallbackReason: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    toolCallCount: v.number(),
    workflowOutcomeCount: v.number(),
    workflowFailureCount: v.number(),
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
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedInputTokens: args.cachedInputTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      toolCallCount: args.toolCallCount,
      workflowOutcomeCount: args.workflowOutcomeCount,
      workflowFailureCount: args.workflowFailureCount,
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
      .withIndex("by_timestamp")
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
      .withIndex("by_timestamp")
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
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", dayjs().valueOf()))
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
