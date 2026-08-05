import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getContext = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("by_clientOrgId_and_status", (q) =>
        q.eq("clientOrgId", notification.orgId).eq("status", "active"),
      )
      .first();
    if (!connection) return null;
    const primary = await ctx.db
      .query("slackChannelBindings")
      .withIndex("by_connectionId_and_status", (q) =>
        q.eq("connectionId", connection._id).eq("status", "active"),
      )
      .first();
    return primary ? { notification, connection, primary } : null;
  },
});

export const finish = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    sentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, {
      slackStatus: args.status,
      slackSentAt: args.sentAt,
    });
  },
});
