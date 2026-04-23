import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const insert = internalMutation({
  args: {
    applicationId: v.id("applications"),
    title: v.string(),
    description: v.optional(v.string()),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("applicationGroups", {
      applicationId: args.applicationId,
      title: args.title,
      description: args.description,
      order: args.order,
      status: "not_started",
    });
  },
});

export const deleteMany = internalMutation({
  args: {
    groupIds: v.array(v.id("applicationGroups")),
  },
  handler: async (ctx, args) => {
    for (const groupId of args.groupIds) {
      await ctx.db.delete(groupId);
    }
  },
});
