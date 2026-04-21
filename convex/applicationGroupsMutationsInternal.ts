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
