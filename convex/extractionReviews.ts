import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireOperator, requireOperatorForUser } from "./lib/operatorIdentity";

const targetKindValidator = v.union(
  v.literal("policy_extraction"),
  v.literal("requirement_extraction"),
);
const ratingValidator = v.union(v.literal("positive"), v.literal("negative"));
const categoryValidator = v.union(
  v.literal("incorrect"),
  v.literal("missing"),
  v.literal("ungrounded"),
  v.literal("unsafe"),
  v.literal("other"),
);
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

function targetKey(targetKind: string, targetId: string) {
  return `${targetKind}:${targetId.trim()}`;
}

function bounded(value: string | undefined, maxLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export const getForTarget = query({
  args: {
    targetKind: targetKindValidator,
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await ctx.db
      .query("extractionReviews")
      .withIndex("target_operator", (query) =>
        query
          .eq("targetKey", targetKey(args.targetKind, args.targetId))
          .eq("operatorUserId", operator.userId),
      )
      .unique();
  },
});

export const resolveTargetInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    targetKind: targetKindValidator,
    targetId: v.string(),
    routerRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const normalizedTargetId = args.targetId.trim();
    if (!normalizedTargetId) throw new Error("Extraction review target is required");

    if (args.targetKind === "requirement_extraction") {
      const run = await ctx.db
        .query("requirementExtractionRuns")
        .withIndex("run", (query) => query.eq("runId", normalizedTargetId))
        .unique();
      if (!run) throw new Error("Requirement extraction run not found");
      return {
        targetId: normalizedTargetId,
        orgId: run.orgId,
        routerRequestId: run.requestId,
        taskKind: run.requestId ? "requirement_extraction" : undefined,
        provider: run.provider,
        model: run.model,
      };
    }

    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (query) => query.eq("traceId", normalizedTargetId))
      .unique();
    if (!session) throw new Error("Policy extraction trace not found");

    const requestedRouterRequestId = bounded(args.routerRequestId, 500);
    const event = requestedRouterRequestId
      ? await ctx.db
          .query("policyExtractionTraceEvents")
          .withIndex("trace_time", (query) =>
            query.eq("traceId", normalizedTargetId),
          )
          .filter((query) =>
            query.eq(
              query.field("routerRequestId"),
              requestedRouterRequestId,
            ),
          )
          .first()
      : null;
    if (requestedRouterRequestId && !event) {
      throw new Error("Selected model request does not belong to this trace");
    }
    if (event && (event.error || event.status === "error")) {
      throw new Error("Failed model requests cannot receive quality ratings");
    }

    return {
      targetId: normalizedTargetId,
      orgId: session.orgId,
      policyId: session.policyId,
      routerRequestId: event?.routerRequestId,
      taskKind: event?.taskKind,
      provider: event?.provider,
      model: event?.model,
    };
  },
});

export const recordInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    targetKind: targetKindValidator,
    targetId: v.string(),
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    rating: ratingValidator,
    category: v.optional(categoryValidator),
    fieldPath: v.optional(v.string()),
    expectedValue: v.optional(v.string()),
    comment: v.optional(v.string()),
    routerRequestId: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = targetKey(args.targetKind, args.targetId);
    const existing = await ctx.db
      .query("extractionReviews")
      .withIndex("target_operator", (query) =>
        query.eq("targetKey", key).eq("operatorUserId", args.operatorUserId),
      )
      .unique();
    if (existing) {
      return {
        id: existing._id,
        rating: existing.rating,
        routerRequestId: existing.routerRequestId,
        taskKind: existing.taskKind,
        shouldSubmit:
          Boolean(existing.routerRequestId) &&
          (existing.routerSignalStatus === "pending" ||
            existing.routerSignalStatus === "error"),
      };
    }

    const timestamp = dayjs().valueOf();
    const routerRequestId = bounded(args.routerRequestId, 500);
    const id = await ctx.db.insert("extractionReviews", {
      targetKind: args.targetKind,
      targetId: args.targetId,
      targetKey: key,
      orgId: args.orgId,
      operatorUserId: args.operatorUserId,
      policyId: args.policyId,
      rating: args.rating,
      category: args.rating === "negative" ? args.category : undefined,
      fieldPath:
        args.rating === "negative" ? bounded(args.fieldPath, 500) : undefined,
      expectedValue:
        args.rating === "negative"
          ? bounded(args.expectedValue, 4_000)
          : undefined,
      comment:
        args.rating === "negative" ? bounded(args.comment, 4_000) : undefined,
      routerRequestId,
      taskKind: bounded(args.taskKind, 200),
      provider: args.provider,
      model: bounded(args.model, 500),
      routerSignalStatus: routerRequestId ? "pending" : "not_applicable",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      id,
      rating: args.rating,
      routerRequestId,
      taskKind: args.taskKind,
      shouldSubmit: Boolean(routerRequestId),
    };
  },
});

export const markRouterSignalInternal = internalMutation({
  args: {
    reviewId: v.id("extractionReviews"),
    status: v.union(v.literal("submitted"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return false;
    await ctx.db.patch(review._id, {
      routerSignalStatus: args.status,
      routerSignalError:
        args.status === "error" ? bounded(args.error, 1_000) : undefined,
      updatedAt: dayjs().valueOf(),
    });
    return true;
  },
});
