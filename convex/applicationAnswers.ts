import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import {
  assertCanAnswerApplication,
  assertCanEditApplicationDraft,
} from "./lib/applicationCapabilities";

// Internal, no-auth upsert for AI prefill. Does not overwrite human-entered answers.
export const upsertPrefill = internalMutation({
  args: {
    applicationId: v.id("applications"),
    questionId: v.id("applicationQuestions"),
    value: v.any(),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId_questionId_rowKey", (q) =>
        q
          .eq("applicationId", args.applicationId)
          .eq("questionId", args.questionId)
          .eq("rowKey", undefined),
      )
      .first();
    const now = Date.now();
    if (existing) {
      // Never overwrite human-entered answers
      if (existing.source === "manual") return existing._id;
      await ctx.db.patch(existing._id, {
        value: args.value,
        source: "auto_prefill",
        sourceRef: args.sourceRef,
        status: "answered",
        answeredAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("applicationAnswers", {
      applicationId: args.applicationId,
      questionId: args.questionId,
      rowKey: undefined,
      value: args.value,
      source: "auto_prefill",
      sourceRef: args.sourceRef,
      status: "answered",
      answeredAt: now,
    });
  },
});

// Broker-side: set or approve an answer on a draft application. Broker edits
// always mark the answer as "manual" (broker-confirmed).
export const brokerSetAnswer = mutation({
  args: {
    applicationId: v.id("applications"),
    questionId: v.id("applicationQuestions"),
    value: v.any(),
  },
  handler: async (ctx, args) => {
    const { access } = await assertCanEditApplicationDraft(ctx, args.applicationId);
    const existing = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId_questionId_rowKey", (q) =>
        q
          .eq("applicationId", args.applicationId)
          .eq("questionId", args.questionId)
          .eq("rowKey", undefined),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        source: "manual",
        status: "answered",
        answeredAt: now,
        answeredByUserId: access.userId,
      });
      return existing._id;
    }
    return await ctx.db.insert("applicationAnswers", {
      applicationId: args.applicationId,
      questionId: args.questionId,
      rowKey: undefined,
      value: args.value,
      source: "manual",
      status: "answered",
      answeredAt: now,
      answeredByUserId: access.userId,
    });
  },
});

// Broker-side: remove an answer from a draft application.
export const brokerRemoveAnswer = mutation({
  args: {
    applicationId: v.id("applications"),
    questionId: v.id("applicationQuestions"),
  },
  handler: async (ctx, args) => {
    await assertCanEditApplicationDraft(ctx, args.applicationId);
    const existing = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId_questionId_rowKey", (q) =>
        q
          .eq("applicationId", args.applicationId)
          .eq("questionId", args.questionId)
          .eq("rowKey", undefined),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const upsert = mutation({
  args: {
    applicationId: v.id("applications"),
    questionId: v.id("applicationQuestions"),
    rowKey: v.optional(v.string()),
    value: v.optional(v.any()),
    source: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("passport"),
        v.literal("integration"),
        v.literal("document"),
      ),
    ),
    sourceRef: v.optional(v.string()),
    overrideOfIntegration: v.optional(
      v.object({
        connectorKey: v.string(),
        syncedValue: v.any(),
        syncedAt: v.number(),
        overriddenAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { access } = await assertCanAnswerApplication(ctx, args.applicationId);
    const existing = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId_questionId_rowKey", (q) =>
        q
          .eq("applicationId", args.applicationId)
          .eq("questionId", args.questionId)
          .eq("rowKey", args.rowKey),
      )
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        source: args.source ?? existing.source,
        sourceRef: args.sourceRef,
        overrideOfIntegration: args.overrideOfIntegration,
        status: "answered",
        answeredAt: now,
        answeredByUserId: access.userId,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("applicationAnswers", {
        applicationId: args.applicationId,
        questionId: args.questionId,
        rowKey: args.rowKey,
        value: args.value,
        source: args.source ?? "manual",
        sourceRef: args.sourceRef,
        overrideOfIntegration: args.overrideOfIntegration,
        status: "answered",
        answeredAt: now,
        answeredByUserId: access.userId,
      });
    }
  },
});
