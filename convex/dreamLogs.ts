import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { getOrgAccess } from "./lib/orgAuth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    return await ctx.db
      .query("dreamLogs")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", access.orgId))
      .order("desc")
      .take(50);
  },
});

export const insert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    status: v.union(v.literal("success"), v.literal("partial"), v.literal("error")),
    entriesReviewed: v.number(),
    entriesDeleted: v.number(),
    entriesConsolidated: v.number(),
    gapsIdentified: v.number(),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("dreamLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
