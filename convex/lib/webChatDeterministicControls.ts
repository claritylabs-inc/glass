"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  isPendingEmailCancelConfirmationPrompt,
  pendingEmailCancelConfirmationMessage,
} from "./emailCancelIntent";
import { resolveTaskControlIntent } from "./taskControlDecision";
import { taskControlResponse } from "./taskControlIntent";
import { resolveTextChannelEmailControl } from "./textChannelControls";

export type WebChatControlMessage = {
  _id: Id<"threadMessages">;
  role: string;
  content: string;
  status?: string;
};

type WebChatEmailControlRecord = {
  _id: Id<"pendingEmails">;
};

export type WebChatDeterministicControlState = {
  messageText: string;
  threadMessages: WebChatControlMessage[];
  pendingEmails: WebChatEmailControlRecord[];
  draftEmails: WebChatEmailControlRecord[];
  latestCancelledEmail?: WebChatEmailControlRecord | null;
};

export async function loadWebChatDeterministicControlState(
  ctx: ActionCtx,
  args: {
    threadId: Id<"threads">;
    orgId: Id<"organizations">;
    userMessageId: Id<"threadMessages">;
  },
): Promise<WebChatDeterministicControlState> {
  const pendingEmails = (await ctx.runQuery(
    internal.pendingEmails.findPendingByThread,
    { threadId: args.threadId },
  )) as WebChatEmailControlRecord[];
  const draftEmails = (await ctx.runQuery(
    internal.pendingEmails.listDraftsInternal,
    { threadId: args.threadId, orgId: args.orgId },
  )) as WebChatEmailControlRecord[];
  const latestCancelledEmail = (await ctx.runQuery(
    internal.pendingEmails.findLatestCancelledByThread,
    { threadId: args.threadId, orgId: args.orgId },
  )) as WebChatEmailControlRecord | null;
  const userMessage = await ctx.runQuery(internal.threads.getMessageInternal, {
    id: args.userMessageId,
  });
  const threadMessages = (await ctx.runQuery(
    internal.threads.messagesInternal,
    { threadId: args.threadId },
  )) as WebChatControlMessage[];

  return {
    messageText: userMessage?.content.trim() ?? "",
    threadMessages,
    pendingEmails,
    draftEmails,
    latestCancelledEmail,
  };
}

export async function runWebChatEmailControls(
  ctx: ActionCtx,
  args: WebChatDeterministicControlState & {
    agentMessageId: Id<"threadMessages">;
    userMessageId: Id<"threadMessages">;
  },
): Promise<boolean> {
  const previousAgentMessage = args.threadMessages
    .filter(
      (message) =>
        message._id !== args.agentMessageId &&
        message._id !== args.userMessageId,
    )
    .filter((message) => message.role === "agent" && message.content)
    .at(-1);
  const emailControl = resolveTextChannelEmailControl({
    messageText: args.messageText,
    isCancelConfirmationContext: isPendingEmailCancelConfirmationPrompt(
      previousAgentMessage?.content,
    ),
    latestCancelledEmailId: args.latestCancelledEmail?._id,
    draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
    pendingEmailIds: args.pendingEmails.map((pendingEmail) => pendingEmail._id),
    allowDraftApproval: true,
  });

  if (emailControl?.kind === "restore_cancelled_email") {
    const restored = await ctx.runMutation(
      internal.pendingEmails.restoreAsDraftInternal,
      { id: emailControl.emailId },
    );
    await ctx.runMutation(internal.threads.updateAgentMessage, {
      id: args.agentMessageId,
      content: restored
        ? "Email restored as a draft. Review it in the email draft card."
        : "I couldn't restore that email.",
      pendingEmailId: restored?.id,
    });
    return true;
  }

  if (emailControl?.kind === "cancel_draft_emails") {
    for (const id of emailControl.emailIds) {
      await ctx.runMutation(internal.pendingEmails.cancelInternal, { id });
    }
    await ctx.runMutation(internal.threads.deleteMessageInternal, {
      id: args.agentMessageId,
    });
    return true;
  }

  if (emailControl?.kind === "request_draft_cancel_confirmation") {
    await ctx.runMutation(internal.threads.updateAgentMessage, {
      id: args.agentMessageId,
      content: pendingEmailCancelConfirmationMessage(
        "draft",
        emailControl.count,
      ),
    });
    return true;
  }

  if (emailControl?.kind === "send_draft_emails") {
    try {
      for (const id of emailControl.emailIds) {
        await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
          id,
        });
      }
      await ctx.runMutation(internal.threads.deleteMessageInternal, {
        id: args.agentMessageId,
      });
      return true;
    } catch (err) {
      await ctx.runMutation(internal.threads.updateAgentError, {
        id: args.agentMessageId,
        error: err instanceof Error ? err.message : String(err),
        content:
          args.draftEmails.length === 1
            ? "Failed to send the draft email."
            : "Failed to send one or more draft emails.",
      });
      return true;
    }
  }

  if (emailControl?.kind === "cancel_pending_emails") {
    let cancelledCount = 0;
    for (const id of emailControl.emailIds) {
      const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
        id,
      });
      if (ok) cancelledCount++;
    }
    if (cancelledCount === 0) return false;

    await ctx.runMutation(internal.threads.updateAgentMessage, {
      id: args.agentMessageId,
      content:
        cancelledCount === 1
          ? "Done - email cancelled."
          : `Done - ${cancelledCount} pending emails cancelled.`,
    });
    return true;
  }

  if (emailControl?.kind === "request_pending_cancel_confirmation") {
    await ctx.runMutation(internal.threads.updateAgentMessage, {
      id: args.agentMessageId,
      content: pendingEmailCancelConfirmationMessage(
        "pending",
        emailControl.count,
      ),
    });
    return true;
  }

  return false;
}

export async function runWebChatTaskControl(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    agentMessageId: Id<"threadMessages">;
    userMessageId: Id<"threadMessages">;
    messageText: string;
    threadMessages: WebChatControlMessage[];
  },
): Promise<boolean> {
  if (args.messageText.length >= 100) return false;

  const taskControlIntent = await resolveTaskControlIntent(ctx, {
    orgId: args.orgId,
    messageText: args.messageText,
    recentContext: args.threadMessages
      .filter((message) => message._id !== args.userMessageId)
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n"),
    channel: "web",
  });
  if (!taskControlIntent) return false;

  await ctx.runMutation(internal.threads.updateAgentMessage, {
    id: args.agentMessageId,
    content: taskControlResponse(taskControlIntent),
  });
  return true;
}
