import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";

const PRESENCE_TIMEOUT_MS = 30_000; // 30 seconds
const STALE_TIMEOUT_MS = 60_000; // 60 seconds

export const heartbeat = mutation({
  args: { pageKey: v.string() },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const user = await ctx.db.get(userId);
    const userName = user?.name ?? user?.email ?? "User";

    // Find existing presence record for this user
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        pageKey: args.pageKey,
        userName,
        lastSeen: Date.now(),
      });
    } else {
      await ctx.db.insert("presence", {
        orgId,
        userId,
        pageKey: args.pageKey,
        userName,
        lastSeen: Date.now(),
      });
    }
  },
});

export const getPagePresence = query({
  args: { pageKey: v.string() },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;

    const all = await ctx.db
      .query("presence")
      .withIndex("by_pageKey", (q) => q.eq("pageKey", args.pageKey))
      .collect();

    return all
      .filter((p) => p.orgId === orgId && p.userId !== userId && p.lastSeen > cutoff)
      .map((p) => ({
        userId: p.userId,
        userName: p.userName,
        lastSeen: p.lastSeen,
      }));
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_TIMEOUT_MS;
    // Clean up in batches
    const stale = await ctx.db
      .query("presence")
      .collect();
    for (const record of stale) {
      if (record.lastSeen < cutoff) {
        await ctx.db.delete(record._id);
      }
    }
  },
});
