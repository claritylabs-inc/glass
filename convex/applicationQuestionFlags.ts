import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { assertCanReviewApplication } from "./lib/applicationCapabilities";

export const create = mutation({
  args: {
    applicationId: v.id("applications"),
    groupId: v.id("applicationGroups"),
    questionId: v.id("applicationQuestions"),
    rowKey: v.optional(v.string()),
    flagType: v.union(v.literal("comment"), v.literal("needs_new_answer")),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const { access } = await assertCanReviewApplication(ctx, args.applicationId);
    return await ctx.db.insert("applicationQuestionFlags", {
      applicationId: args.applicationId,
      groupId: args.groupId,
      questionId: args.questionId,
      rowKey: args.rowKey,
      flagType: args.flagType,
      authorUserId: access.userId,
      message: args.message,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const updateStatus = mutation({
  args: {
    flagId: v.id("applicationQuestionFlags"),
    status: v.union(v.literal("resolved"), v.literal("dismissed")),
  },
  handler: async (ctx, args) => {
    const flag = await ctx.db.get(args.flagId);
    if (!flag) throw new Error("Flag not found");
    const app = await ctx.db.get(flag.applicationId);
    if (!app) throw new Error("Application not found");
    await ctx.db.patch(args.flagId, {
      status: args.status,
      resolvedAt: Date.now(),
    });
  },
});
