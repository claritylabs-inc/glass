import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";

export const append = internalMutation({
  args: {
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.id("policies")),
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

export const appendPublic = mutation({
  args: {
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.id("policies")),
    action: v.string(),
    detail: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.policyId,
      quoteId: args.quoteId,
      userId,
      orgId,
      action: args.action,
      detail: args.detail,
      metadata: args.metadata,
    });
  },
});

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx);
    const entries = await ctx.db
      .query("policyAuditLog")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    return entries.sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const listByOrg = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const entries = await ctx.db
      .query("policyAuditLog")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(args.limit ?? 50);
    return entries;
  },
});
