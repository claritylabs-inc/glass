import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const append = internalMutation({
  args: {
    policyId: v.optional(v.id("policies")),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
    action: v.string(),
    detail: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("policyAuditLog", args);
  },
});
