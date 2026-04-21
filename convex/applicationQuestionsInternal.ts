import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const patch = internalMutation({
  args: {
    questionId: v.id("applicationQuestions"),
    groupId: v.id("applicationGroups"),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.questionId, {
      groupId: args.groupId,
      order: args.order,
      placedByAi: true,
    });
  },
});
