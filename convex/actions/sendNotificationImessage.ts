"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { sendIdempotentOutboundImessage, truncateImessageText } from "../lib/imessageOutbound";
import type { Id } from "../_generated/dataModel";
import { resolveNotificationThreadContext } from "../lib/notificationThreadContext";

export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.runQuery(
      internal.notifications.getInternal,
      { id: args.notificationId },
    );
    if (!notification || notification.imessageStatus !== "scheduled") return;

    const { privateThreadOwner } = await resolveNotificationThreadContext(
      ctx,
      notification,
    );

    const memberships = privateThreadOwner
      ? [{ userId: privateThreadOwner }]
      : notification.userId
      ? [{ userId: notification.userId }]
      : await ctx.runQuery(
          internal.organizations.listMembershipsForOrg,
          { orgId: notification.orgId },
        );

    const recipients = new Map<
      string,
      { userId: Id<"users">; userName?: string }
    >();
    for (const membership of memberships) {
      const user = await ctx.runQuery(
        internal.users.getInternal,
        { id: membership.userId },
      );
      if (!user?.phone) continue;

      const shouldSend = await ctx.runQuery(
        internal.notificationPreferences.resolveChannelForUser,
        {
          userId: membership.userId,
          orgId: notification.orgId,
          type: notification.type,
          channel: "imessage",
          severity: notification.severity,
        },
      );
      if (shouldSend) {
        recipients.set(user.phone, {
          userId: membership.userId,
          userName: user.name,
        });
      }
    }

    if (recipients.size === 0) {
      await ctx.runMutation(
        internal.notifications.patchImessageStatus,
        {
          id: args.notificationId,
          imessageStatus: "suppressed_by_preference",
        },
      );
      return;
    }

    let sent = 0;
    const message = truncateImessageText(`${notification.title}\n\n${notification.body}`);
    for (const [phone, recipient] of recipients.entries()) {
      const idempotencyKey = `notification-imessage:${args.notificationId}:${recipient.userId}`;
      const ok = await sendIdempotentOutboundImessage(ctx, {
        idempotencyKey,
        orgId: notification.orgId,
        toPhone: phone,
        message,
        logPrefix: "sendNotificationImessage",
      });
      if (!ok) continue;
      sent += 1;
      await ctx.runMutation(
        internal.threads.recordNotificationImessageInternal,
        {
          orgId: notification.orgId,
          userId: recipient.userId,
          userName: recipient.userName,
          phone,
          content: message,
          idempotencyKey,
        },
      );
    }

    await ctx.runMutation(
      internal.notifications.patchImessageStatus,
      {
        id: args.notificationId,
        imessageStatus: sent > 0 ? "sent" : "failed",
        imessageSentAt: sent > 0 ? dayjs().valueOf() : undefined,
      },
    );
  },
});
