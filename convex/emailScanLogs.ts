import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { getOrgAccess } from "./lib/orgAuth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    return await ctx.db
      .query("emailScanLogs")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", access.orgId))
      .order("desc")
      .take(50);
  },
});

export const insert = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    connectionId: v.id("emailConnections"),
    connectionLabel: v.string(),
    trigger: v.union(v.literal("manual"), v.literal("daily"), v.literal("calendar")),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("error"),
    ),
    sinceDate: v.optional(v.string()),
    untilDate: v.optional(v.string()),
    senderDomains: v.optional(v.array(v.string())),
    inboxFound: v.number(),
    sentFound: v.number(),
    totalInserted: v.number(),
    duplicatesSkipped: v.number(),
    insuranceFound: v.optional(v.number()),
    error: v.optional(v.string()),
    log: v.optional(v.array(v.string())),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("emailScanLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const update = internalMutation({
  args: {
    id: v.id("emailScanLogs"),
    status: v.optional(v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("error"),
    )),
    inboxFound: v.optional(v.number()),
    sentFound: v.optional(v.number()),
    totalInserted: v.optional(v.number()),
    duplicatesSkipped: v.optional(v.number()),
    insuranceFound: v.optional(v.number()),
    error: v.optional(v.string()),
    log: v.optional(v.array(v.string())),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) patch[k] = val;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
    }
  },
});

export const get = query({
  args: { id: v.id("emailScanLogs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
