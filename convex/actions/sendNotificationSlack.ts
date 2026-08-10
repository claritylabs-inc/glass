"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

const internalApi = internal as any;

export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internalApi.notificationSlack.getContext, args);
    if (!context || context.notification.slackStatus !== "scheduled") return;

    const result = await ctx.runAction(internalApi.actions.sendSlack.send, {
      idempotencyKey: `notification:${String(args.notificationId)}:slack`,
      orgId: context.notification.orgId,
      connectionId: context.connection._id,
      channelId: context.channelId,
      content: `*${context.notification.title}*\n${context.notification.body}`,
    });

    await ctx.runMutation(internalApi.notificationSlack.finish, {
      notificationId: args.notificationId,
      status: result.status === "sent" ? "sent" : "failed",
      sentAt: result.status === "sent" ? dayjs().valueOf() : undefined,
    });
  },
});
