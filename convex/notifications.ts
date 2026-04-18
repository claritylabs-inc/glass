import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { getOrgAccess, requireOrgAccess } from "./lib/orgAuth";

const notificationTypeValidator = v.union(
  v.literal("merge_suggestion"),
  v.literal("coverage_gap"),
  v.literal("renewal_reminder"),
  v.literal("policy_lapsed"),
  v.literal("coverage_limit_concern"),
  v.literal("missing_coverage"),
  v.literal("carrier_rating_change"),
  v.literal("broker_action"),
  v.literal("extraction_complete"),
  v.literal("extraction_error"),
  v.literal("incomplete_extraction"),
  v.literal("stale_data"),
  v.literal("premium_anomaly"),
  v.literal("dream_insight"),
);

const notificationStatusValidator = v.union(
  v.literal("unread"),
  v.literal("read"),
  v.literal("actioned"),
  v.literal("dismissed"),
);

export const list = query({
  args: {
    orgId: v.optional(v.id("organizations")),
    status: v.optional(notificationStatusValidator),
    type: v.optional(notificationTypeValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const effectiveLimit = args.limit ?? 50;

    let results;
    if (args.status) {
      results = await ctx.db
        .query("notifications")
        .withIndex("by_orgId_status", (idx) =>
          idx.eq("orgId", orgId).eq("status", args.status!)
        )
        .order("desc")
        .take(effectiveLimit);
    } else if (args.type) {
      results = await ctx.db
        .query("notifications")
        .withIndex("by_orgId_type", (idx) =>
          idx.eq("orgId", orgId).eq("type", args.type!)
        )
        .order("desc")
        .take(effectiveLimit);
    } else {
      results = await ctx.db
        .query("notifications")
        .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
        .order("desc")
        .take(effectiveLimit);
    }

    return results;
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return 0;
    const { orgId } = access;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_orgId_status", (idx) =>
        idx.eq("orgId", orgId).eq("status", "unread")
      )
      .collect();
    return unread.length;
  },
});

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: notificationTypeValidator,
    title: v.string(),
    body: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    actionType: v.optional(v.string()),
    actionPayload: v.optional(v.any()),
    sourceRef: v.optional(v.any()),
    userId: v.optional(v.id("users")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      ...args,
      status: "unread",
      createdAt: Date.now(),
    });
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.notificationId, { status: "read" });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_orgId_status", (idx) =>
        idx.eq("orgId", orgId).eq("status", "unread")
      )
      .collect();
    await Promise.all(
      unread.map((n) => ctx.db.patch(n._id, { status: "read" }))
    );
  },
});

export const dismiss = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.notificationId, { status: "dismissed" });
  },
});

export const markActioned = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.notificationId, { status: "actioned" });
  },
});

export const markActionedInternal = internalMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { status: "actioned" });
  },
});
