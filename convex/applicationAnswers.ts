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
    rowKey: v.optional(v.string()),
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
          .eq("rowKey", args.rowKey),
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
      rowKey: args.rowKey,
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
    rowKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertCanEditApplicationDraft(ctx, args.applicationId);
    const existing = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId_questionId_rowKey", (q) =>
        q
          .eq("applicationId", args.applicationId)
          .eq("questionId", args.questionId)
          .eq("rowKey", args.rowKey),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// Remove a repeating row: delete all answers for the given rowKey, then shift
// any later rows in the same collection down by one index so the numbering
// stays contiguous.
export const removeRow = mutation({
  args: {
    applicationId: v.id("applications"),
    collectionKey: v.string(),
    rowIndex: v.number(),
  },
  handler: async (ctx, args) => {
    await assertCanAnswerApplication(ctx, args.applicationId);
    const all = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();
    const prefix = `${args.collectionKey}:`;
    for (const a of all) {
      if (!a.rowKey || !a.rowKey.startsWith(prefix)) continue;
      const suffix = a.rowKey.slice(prefix.length);
      const idx = Number(suffix);
      if (!Number.isFinite(idx)) continue;
      if (idx === args.rowIndex) {
        await ctx.db.delete(a._id);
      } else if (idx > args.rowIndex) {
        await ctx.db.patch(a._id, { rowKey: `${args.collectionKey}:${idx - 1}` });
      }
    }
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
    let answerId;
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
      answerId = existing._id;
    } else {
      answerId = await ctx.db.insert("applicationAnswers", {
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

    // Bump the containing group to "in_progress" on first answer
    const question = await ctx.db.get(args.questionId);
    if (question) {
      const group = await ctx.db.get(question.groupId);
      if (group && group.status === "not_started") {
        await ctx.db.patch(group._id, { status: "in_progress" });
      }
    }

    return answerId;
  },
});
