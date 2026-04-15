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
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
    ),
    entriesReviewed: v.number(),
    entriesDeleted: v.number(),
    entriesConsolidated: v.number(),
    gapsIdentified: v.number(),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    log: v.optional(v.array(v.string())),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("dreamLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const update = internalMutation({
  args: {
    id: v.id("dreamLogs"),
    status: v.optional(v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
    )),
    entriesDeleted: v.optional(v.number()),
    entriesConsolidated: v.optional(v.number()),
    gapsIdentified: v.optional(v.number()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    log: v.optional(v.array(v.string())),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    // Filter out undefined values
    const patch: Record<string, any> = {};
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) patch[k] = val;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
    }
  },
});
