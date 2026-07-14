"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { isPendingEmailCancelConfirmationPrompt } from "./emailCancelIntent";
import {
  executeEmailCommand,
  type EmailCommandDraft,
} from "./emailCommandExecutor";
import { resolveTaskControlIntent } from "./taskControlDecision";
import { taskControlResponse } from "./taskControlIntent";
import { resolveTextChannelEmailControl } from "./textChannelControls";

export type WebChatControlMessage = {
  _id: Id<"threadMessages">;
  role: string;
  content: string;
  status?: string;
  pendingEmailId?: Id<"pendingEmails">;
};

type WebChatEmailControlRecord = {
  _id: Id<"pendingEmails">;
};

export type WebChatDeterministicControlState = {
  messageText: string;
  threadMessages: WebChatControlMessage[];
  pendingEmails: WebChatEmailControlRecord[];
  draftEmails: EmailCommandDraft[];
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
  )) as EmailCommandDraft[];
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
  const draftApprovalEmailIds =
    args.draftEmails.length === 1 &&
    previousAgentMessage?.pendingEmailId === args.draftEmails[0]._id
      ? [args.draftEmails[0]._id]
      : [];
  const emailControl = resolveTextChannelEmailControl({
    messageText: args.messageText,
    isCancelConfirmationContext: isPendingEmailCancelConfirmationPrompt(
      previousAgentMessage?.content,
    ),
    latestCancelledEmailId: args.latestCancelledEmail?._id,
    draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
    draftApprovalEmailIds,
    pendingEmailIds: args.pendingEmails.map((pendingEmail) => pendingEmail._id),
    allowDraftApproval: true,
  });

  if (!emailControl) return false;

  const result = await executeEmailCommand(ctx, emailControl, {
    draftEmails: args.draftEmails,
  });
  if (
    result.kind === "cancel_draft_emails" ||
    result.kind === "send_draft_emails"
  ) {
    await ctx.runMutation(internal.threads.deleteMessageInternal, {
      id: args.agentMessageId,
    });
    return true;
  }
  if (result.kind === "send_failed") {
    await ctx.runMutation(internal.threads.updateAgentError, {
      id: args.agentMessageId,
      error: result.error ?? result.responseBody,
      content:
        args.draftEmails.length === 1
          ? "Failed to send the draft email."
          : "Failed to send one or more draft emails.",
    });
    return true;
  }
  await ctx.runMutation(internal.threads.updateAgentMessage, {
    id: args.agentMessageId,
    content:
      result.kind === "restore_cancelled_email" && result.pendingEmailId
        ? "Email restored as a draft. Review it in the email draft card."
        : result.kind === "update_single_draft_recipient" &&
            result.pendingEmailId
          ? "Updated the draft recipient. Review it in the email draft card."
          : result.kind === "cancel_pending_emails"
            ? `Done - ${result.responseBody}`
            : result.responseBody,
    pendingEmailId: result.pendingEmailId,
  });
  return true;
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
