import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { assertCanAnswerApplication } from "./lib/applicationCapabilities";

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
