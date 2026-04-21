// convex/integrationSyncLogs.ts
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { getOrgAccess } from "./lib/access";
import { assertCanReadIntegrationsList } from "./lib/access";

export const getSyncLogs = query({
  args: {
    connectionId: v.id("integrationConnections"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Fetch the connection to get clientOrgId for access check
    const conn = await ctx.db.get(args.connectionId);
    if (!conn) return [];
    const access = await getOrgAccess(ctx, conn.clientOrgId);
    assertCanReadIntegrationsList(access);

    return ctx.db
      .query("integrationSyncLogs")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const insertLogInternal = internalMutation({
  args: {
    connectionId: v.id("integrationConnections"),
    clientOrgId: v.id("organizations"),
    trigger: v.union(
      v.literal("initial"), v.literal("webhook"),
      v.literal("scheduled"), v.literal("manual"),
    ),
    status: v.union(v.literal("running"), v.literal("success"), v.literal("error")),
    metricsWritten: v.number(),
    error: v.optional(v.string()),
    startedAt: v.number(),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => ctx.db.insert("integrationSyncLogs", args),
});

export const updateLogInternal = internalMutation({
  args: {
    logId: v.id("integrationSyncLogs"),
    status: v.union(v.literal("running"), v.literal("success"), v.literal("error")),
    metricsWritten: v.number(),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { logId, ...patch } = args;
    await ctx.db.patch(logId, patch);
  },
});
