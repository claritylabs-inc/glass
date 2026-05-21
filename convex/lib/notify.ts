// convex/lib/notify.ts
import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  NotificationType,
  NOTIFICATION_SEVERITY,
  COALESCE_WINDOW_MS,
  buildCoalesceKey,
  getEffectiveEmailDefault,
  getEffectiveChannelDefault,
  NotificationSeverity,
} from "./notificationTypes";

export interface NotifyArgs {
  orgId: Id<"organizations">;
  type: NotificationType;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  userId?: Id<"users">;
  relatedOrgId?: Id<"organizations">;
  actionType?: string;
  actionPayload?: unknown;
  sourceRef?: unknown;
  coalesceKeyParts?: string[];
  /** Injectable for testing; defaults to dayjs().valueOf() */
  nowMs?: number;
}

/**
 * Resolve whether a given user should receive email for a notification type.
 * Exported for testability.
 */
export async function resolveEmailPreference(
  ctx: MutationCtx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
  type: NotificationType,
  severity: NotificationSeverity,
): Promise<{ shouldEmail: boolean }> {
  // Per-type row takes precedence
  const perType = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_userId_orgId_type_channel", (q) =>
      q.eq("userId", userId).eq("orgId", orgId).eq("type", type).eq("channel", "email")
    )
    .first();

  if (perType !== null) {
    return { shouldEmail: perType.enabled };
  }

  // __all__ catch-all
  const catchAll = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_userId_orgId_type_channel", (q) =>
      q.eq("userId", userId).eq("orgId", orgId).eq("type", "__all__").eq("channel", "email")
    )
    .first();

  if (catchAll !== null) {
    return { shouldEmail: catchAll.enabled };
  }

  // Severity default
    return { shouldEmail: getEffectiveEmailDefault(severity) };
}

async function resolveImessagePreference(
  ctx: MutationCtx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
  type: NotificationType,
  severity: NotificationSeverity,
): Promise<boolean> {
  const perType = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_userId_orgId_type_channel", (q) =>
      q.eq("userId", userId).eq("orgId", orgId).eq("type", type).eq("channel", "imessage")
    )
    .first();
  if (perType !== null) return perType.enabled;

  const catchAll = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_userId_orgId_type_channel", (q) =>
      q.eq("userId", userId).eq("orgId", orgId).eq("type", "__all__").eq("channel", "imessage")
    )
    .first();
  if (catchAll !== null) return catchAll.enabled;

  return getEffectiveChannelDefault("imessage", severity);
}

/**
 * Internal mutation — the single notification creation path.
 * Exposed as `internal.lib.notify.notifyInternal` for cross-module use.
 */
export const notifyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    severity: v.optional(v.union(v.literal("info"), v.literal("warning"), v.literal("critical"))),
    userId: v.optional(v.id("users")),
    relatedOrgId: v.optional(v.id("organizations")),
    actionType: v.optional(v.string()),
    actionPayload: v.optional(v.any()),
    sourceRef: v.optional(v.any()),
    coalesceKeyParts: v.optional(v.array(v.string())),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"notifications">> => {
    const type = args.type as NotificationType;
    const nowMs = args.nowMs ?? dayjs().valueOf();
    const severity = args.severity ?? NOTIFICATION_SEVERITY[type] ?? "info";

    // 1. Coalesce
    let coalesceKey: string | undefined;
    const windowMs = COALESCE_WINDOW_MS[type];

    if (args.coalesceKeyParts && windowMs) {
      coalesceKey = buildCoalesceKey(args.coalesceKeyParts, windowMs, nowMs);

      const existing = await ctx.db
        .query("notifications")
        .withIndex("by_orgId_coalesceKey_status", (q) =>
          q.eq("orgId", args.orgId).eq("coalesceKey", coalesceKey!).eq("status", "unread")
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          coalescedCount: (existing.coalescedCount ?? 1) + 1,
          lastEventAt: nowMs,
          body: args.body,
          title: args.title,
        });
        return existing._id;
      }
    }

    // 2. Insert new notification
    const notificationId = await ctx.db.insert("notifications", {
      orgId: args.orgId,
      userId: args.userId,
      type,
      title: args.title,
      body: args.body,
      severity,
      status: "unread",
      actionType: args.actionType,
      actionPayload: args.actionPayload,
      sourceRef: args.sourceRef,
      relatedOrgId: args.relatedOrgId,
      coalesceKey,
      coalescedCount: 1,
      lastEventAt: nowMs,
      emailStatus: "not_scheduled",
      imessageStatus: "not_scheduled",
      createdAt: nowMs,
    });

    // 3. External scheduling — per-user or org-wide
    const memberships = args.userId
      ? [{ userId: args.userId }]
      : await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
          .collect();

    let anyEmailScheduled = false;
    let anyImessageScheduled = false;
    for (const m of memberships) {
      const { shouldEmail } = await resolveEmailPreference(
        ctx,
        m.userId,
        args.orgId,
        type,
        severity,
      );
      if (shouldEmail) {
        anyEmailScheduled = true;
      }
      const shouldImessage = await resolveImessagePreference(
        ctx,
        m.userId,
        args.orgId,
        type,
        severity,
      );
      if (shouldImessage) anyImessageScheduled = true;
      if (anyEmailScheduled && anyImessageScheduled) break;
    }

    if (anyEmailScheduled) {
      await ctx.db.patch(notificationId, { emailStatus: "scheduled" });
      await ctx.scheduler.runAfter(0, (internal as any).actions.sendNotificationEmail.send, {
        notificationId,
      });
    } else {
      // Determine if suppressed by preference or just not applicable
      const hasPrefs = memberships.length > 0;
      await ctx.db.patch(notificationId, {
        emailStatus: hasPrefs ? "suppressed_by_preference" : "not_scheduled",
      });
    }

    if (anyImessageScheduled) {
      await ctx.db.patch(notificationId, { imessageStatus: "scheduled" });
      await ctx.scheduler.runAfter(0, (internal as any).actions.sendNotificationImessage.send, {
        notificationId,
      });
    } else {
      const hasPrefs = memberships.length > 0;
      await ctx.db.patch(notificationId, {
        imessageStatus: hasPrefs ? "suppressed_by_preference" : "not_scheduled",
      });
    }

    return notificationId;
  },
});

/**
 * Convenience wrapper called from other Convex mutations.
 * Usage: await notify(ctx, { orgId, type, title, body, ... })
 */
export async function notify(ctx: MutationCtx, args: NotifyArgs): Promise<Id<"notifications">> {
  return await ctx.runMutation((internal as any).lib.notify.notifyInternal, args);
}
