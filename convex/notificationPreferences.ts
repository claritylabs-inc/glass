// convex/notificationPreferences.ts
import { v } from "convex/values";
import dayjs from "dayjs";
import { mutation, query, internalQuery, MutationCtx } from "./_generated/server";
import { requireCurrentOrgAccess as requireOrgAccess } from "./lib/access";
import { Id } from "./_generated/dataModel";
import {
  getEffectiveChannelDefault,
  type NotificationChannel,
  type NotificationSeverity,
} from "./lib/notificationTypes";

const channelValidator = v.union(
  v.literal("email"),
  v.literal("imessage"),
);

// ── Shared helpers ──────────────────────────────────────────────────────────

async function upsertPref(
  ctx: MutationCtx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
  type: string,
  channel: NotificationChannel,
  enabled: boolean,
) {
  const existing = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_userId_orgId_type_channel", (q) =>
      q.eq("userId", userId).eq("orgId", orgId).eq("type", type).eq("channel", channel)
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { enabled, updatedAt: dayjs().valueOf() });
  } else {
    await ctx.db.insert("notificationPreferences", {
      userId,
      orgId,
      type,
      channel,
      enabled,
      updatedAt: dayjs().valueOf(),
    });
  }
}

// ── Public mutations ────────────────────────────────────────────────────────

export const set = mutation({
  args: {
	    orgId: v.id("organizations"),
	    type: v.string(),
	    channel: channelValidator,
	    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgAccess(ctx);
    await upsertPref(ctx, userId, args.orgId, args.type, args.channel, args.enabled);
  },
});

export const setAllEmail = mutation({
  args: {
    orgId: v.id("organizations"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgAccess(ctx);
    await upsertPref(ctx, userId, args.orgId, "__all__", "email", args.enabled);
  },
});

export const setAllChannel = mutation({
  args: {
    orgId: v.id("organizations"),
    channel: channelValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgAccess(ctx);
    await upsertPref(ctx, userId, args.orgId, "__all__", args.channel, args.enabled);
  },
});

export const getForUser = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgAccess(ctx);
    return await ctx.db
      .query("notificationPreferences")
      .withIndex("by_userId_orgId", (q) => q.eq("userId", userId).eq("orgId", args.orgId))
      .collect();
  },
});

// ── Internal query (used by sendNotificationEmail action) ───────────────────

/** Returns resolved email preference (true/false) for a user+type, or null if no row exists. */
export const resolveForUser = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
    type: v.string(),
  },
  handler: async (ctx, args): Promise<boolean | null> => {
    const perType = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_userId_orgId_type_channel", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId).eq("type", args.type).eq("channel", "email")
      )
      .first();
    if (perType !== null) return perType.enabled;

    const catchAll = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_userId_orgId_type_channel", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId).eq("type", "__all__").eq("channel", "email")
      )
      .first();
    if (catchAll !== null) return catchAll.enabled;

    return null;
  },
});

export const resolveChannelForUser = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
    type: v.string(),
    channel: channelValidator,
    severity: v.optional(v.union(v.literal("info"), v.literal("warning"), v.literal("critical"))),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const perType = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_userId_orgId_type_channel", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId).eq("type", args.type).eq("channel", args.channel)
      )
      .first();
    if (perType !== null) return perType.enabled;

    const catchAll = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_userId_orgId_type_channel", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId).eq("type", "__all__").eq("channel", args.channel)
      )
      .first();
    if (catchAll !== null) return catchAll.enabled;

    return getEffectiveChannelDefault(
      args.channel,
      (args.severity ?? "info") as NotificationSeverity,
    );
  },
});
