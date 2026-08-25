import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { resolveSlackAutomaticChannelId } from "./lib/slackChannelRouting";
import {
  isSlackBindingReachable,
  isSlackConnectionHealthy,
} from "./lib/slackAvailability";

export const getContext = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", notification.orgId).eq("status", "active"),
      )
      .first();
    if (!connection || !isSlackConnectionHealthy(connection)) return null;
    const primary =
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("connection_status", (q) =>
          q.eq("connectionId", connection._id).eq("status", "active"),
        )
        .first()) ??
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("connection_status", (q) =>
          q.eq("connectionId", connection._id).eq("status", "unavailable"),
        )
        .first());
    if (primary && !isSlackBindingReachable(primary)) return null;
    const channelId = resolveSlackAutomaticChannelId(
      connection,
      isSlackBindingReachable(primary) ? primary : null,
    );
    return channelId ? { notification, connection, channelId } : null;
  },
});

export const finish = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    sentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.notificationId))) return;
    await ctx.db.patch(args.notificationId, {
      slackStatus: args.status,
      slackSentAt: args.sentAt,
    });
  },
});
