"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  formatWebChatUserMirrorText,
  getImessageOutboundRoute,
  sendIdempotentOutboundImessage,
  storedAttachmentsToImessageOutbound,
} from "../lib/imessageOutbound";

export const run = internalAction({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("threadMessages"),
  },
  handler: async (ctx, args) => {
    const [thread, message] = await Promise.all([
      ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId,
      }) as Promise<Doc<"threads"> | null>,
      ctx.runQuery(internal.threads.getMessageInternal, {
        id: args.messageId,
      }) as Promise<Doc<"threadMessages"> | null>,
    ]);

    if (!thread || !message) return;
    if (message.threadId !== args.threadId || message.orgId !== thread.orgId)
      return;
    if (message.role !== "user" || message.channel !== "chat") return;

    const route = getImessageOutboundRoute(thread);
    if (!route) return;

    const attachments = await storedAttachmentsToImessageOutbound(
      ctx,
      message.attachments,
    );
    await sendIdempotentOutboundImessage(ctx, {
      ...route,
      idempotencyKey: `web-chat:${message._id}`,
      orgId: message.orgId,
      threadId: message.threadId,
      threadMessageId: message._id,
      message: formatWebChatUserMirrorText({
        userName: message.userName,
        content: message.content,
        hasAttachments: attachments.length > 0,
      }),
      attachments,
      logPrefix: "mirrorWebChatToImessage",
    });
  },
});
