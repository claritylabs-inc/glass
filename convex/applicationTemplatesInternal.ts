import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getById = internalQuery({
  args: { templateId: v.id("applicationTemplates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.templateId);
  },
});
