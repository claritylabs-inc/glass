// convex/notifications.ts
import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { getCurrentOrgAccess as getOrgAccess, requireCurrentOrgAccess as requireOrgAccess } from "./lib/access";
import { Id } from "./_generated/dataModel";

// ── Public queries ──────────────────────────────────────────────────────────

export const listInbox = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(v.union(
      v.literal("unread"),
      v.literal("read"),
      v.literal("actioned"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access || access.orgId !== args.orgId) return [];

    const limit = args.limit ?? 50;

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_orgId_status", (q) =>
        args.status
          ? q.eq("orgId", args.orgId).eq("status", args.status)
          : q.eq("orgId", args.orgId)
      )
      .order("desc")
      .take(limit * 2); // over-fetch to filter dismissed

    const visible = rows
      .filter((n) => n.status !== "dismissed")
      .slice(0, limit);

    // Enrich with relatedOrg name when present
    const enriched = await Promise.all(
      visible.map(async (n) => {
        if (!n.relatedOrgId) return { ...n, relatedOrgName: undefined };
        const org = await ctx.db.get(n.relatedOrgId);
        return { ...n, relatedOrgName: org?.name };
      })
    );

    return enriched;
  },
});

// Keep backward-compat list query
export const list = query({
  args: {
    orgId: v.optional(v.id("organizations")),
    status: v.optional(v.union(
      v.literal("unread"),
      v.literal("read"),
      v.literal("actioned"),
      v.literal("dismissed"),
    )),
    type: v.optional(v.string()),
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
          idx.eq("orgId", orgId).eq("type", args.type! as "merge_suggestion")
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
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return 0;
    const orgId = args.orgId ?? access.orgId;
    if (orgId !== access.orgId) return 0;

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "unread")
      )
      .take(100);
    return unread.length;
  },
});

// ── Public mutations ────────────────────────────────────────────────────────

export const markRead = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    for (const id of args.ids) {
      const n = await ctx.db.get(id);
      if (n && n.orgId === orgId) {
        await ctx.db.patch(id, { status: "read" });
      }
    }
  },
});

export const markAllRead = mutation({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    const orgId = args.orgId ?? access.orgId;
    if (orgId !== access.orgId) throw new Error("Access denied");

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "unread")
      )
      .collect();
    await Promise.all(unread.map((n) => ctx.db.patch(n._id, { status: "read" })));
  },
});

export const dismiss = mutation({
  args: { id: v.optional(v.id("notifications")), notificationId: v.optional(v.id("notifications")) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const id = args.id ?? args.notificationId;
    if (!id) throw new Error("id required");
    const n = await ctx.db.get(id);
    if (!n || n.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status: "dismissed" });
  },
});

export const markActioned = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const n = await ctx.db.get(args.notificationId);
    if (!n || n.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.notificationId, { status: "actioned" });
  },
});

// ── Internal mutations / queries ────────────────────────────────────────────

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
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
      ...(args as Parameters<typeof ctx.db.insert<"notifications">>[1]),
      status: "unread",
      createdAt: Date.now(),
    });
  },
});

export const markActionedInternal = internalMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { status: "actioned" });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const patchEmailStatus = internalMutation({
  args: {
    id: v.id("notifications"),
    emailStatus: v.union(
      v.literal("not_scheduled"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("suppressed_by_preference"),
      v.literal("failed"),
    ),
    emailSentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

export const patchImessageStatus = internalMutation({
  args: {
    id: v.id("notifications"),
    imessageStatus: v.union(
      v.literal("not_scheduled"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("suppressed_by_preference"),
      v.literal("failed"),
    ),
    imessageSentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Fetch unread info-level notifications older than 30 days
    const old = await ctx.db
      .query("notifications")
      .withIndex("by_orgId_status", (q) =>
        // We scan all unread and filter by severity and age in JS
        // since Convex doesn't support multi-field range in one index
        q.gt("orgId", "" as unknown as Id<"organizations">)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("severity"), "info"),
          q.eq(q.field("status"), "unread"),
          q.lt(q.field("createdAt"), thirtyDaysAgo),
        )
      )
      .take(500);

    for (const n of old) {
      await ctx.db.patch(n._id, { status: "dismissed" });
    }
  },
});
