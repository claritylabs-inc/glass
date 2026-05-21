"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { sendIdempotentOutboundImessage, truncateImessageText } from "../lib/imessageOutbound";
import type { Id } from "../_generated/dataModel";

export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.runQuery(
      (internal as any).notifications.getInternal,
      { id: args.notificationId },
    );
    if (!notification || notification.imessageStatus !== "scheduled") return;

    const memberships = notification.userId
      ? [{ userId: notification.userId }]
      : await ctx.runQuery(
          (internal as any).organizations.listMembershipsForOrg,
          { orgId: notification.orgId },
        );

    const recipients = new Map<string, Id<"users">>();
    for (const membership of memberships) {
      const user = await ctx.runQuery(
        (internal as any).users.getInternal,
        { id: membership.userId },
      );
      if (!user?.phone) continue;

      const shouldSend = await ctx.runQuery(
        (internal as any).notificationPreferences.resolveChannelForUser,
        {
          userId: membership.userId,
          orgId: notification.orgId,
          type: notification.type,
          channel: "imessage",
          severity: notification.severity,
        },
      );
      if (shouldSend) recipients.set(user.phone, membership.userId);
    }

    if (recipients.size === 0) {
      await ctx.runMutation(
        (internal as any).notifications.patchImessageStatus,
        {
          id: args.notificationId,
          imessageStatus: "suppressed_by_preference",
        },
      );
      return;
    }

    let sent = 0;
    const message = truncateImessageText(`${notification.title}\n\n${notification.body}`);
    for (const [phone, userId] of recipients.entries()) {
      const ok = await sendIdempotentOutboundImessage(ctx, {
        idempotencyKey: `notification-imessage:${args.notificationId}:${userId}`,
        orgId: notification.orgId,
        toPhone: phone,
        message,
        logPrefix: "sendNotificationImessage",
      });
      if (ok) sent += 1;
    }

    await ctx.runMutation(
      (internal as any).notifications.patchImessageStatus,
      {
        id: args.notificationId,
        imessageStatus: sent > 0 ? "sent" : "failed",
        imessageSentAt: sent > 0 ? dayjs().valueOf() : undefined,
      },
    );
  },
});
