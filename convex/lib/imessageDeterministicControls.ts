"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { AgentScope } from "./agentScope";
import {
  isPendingEmailCancelConfirmationPrompt,
  pendingEmailCancelConfirmationMessage,
} from "./emailCancelIntent";
import { buildEmailDraftTextSummary } from "./emailDraftSummary";
import type { ImessageHistoryMessage } from "./imessageAgentContext";
import { runImessageSlashCommand } from "./imessageSlashCommands";
import { resolveTaskControlIntent } from "./taskControlDecision";
import { taskControlResponse } from "./taskControlIntent";
import { resolveTextChannelEmailControl } from "./textChannelControls";

export type ImessageDeterministicControlResult = {
  response: string;
  leaveGroup?: boolean;
};

export async function runImessageDeterministicControls(
  ctx: ActionCtx,
  args: {
    messageText: string;
    orgId: Id<"organizations">;
    orgName: string;
    userName?: string;
    userEmail?: string;
    threadId: Id<"threads">;
    eventKey: string;
    chatGuid: string;
    isGroup: boolean;
    scopeMode: AgentScope["mode"];
    currentSenderIsLinked: boolean;
    draftEmails: Array<Doc<"pendingEmails">>;
    pendingEmails: Array<Doc<"pendingEmails">>;
    latestCancelledEmail?: Doc<"pendingEmails"> | null;
    recentConversationContext: string;
    history: ImessageHistoryMessage[];
  },
): Promise<ImessageDeterministicControlResult | null> {
  const reply = async (
    response: string,
    options?: { leaveGroup?: boolean },
  ): Promise<ImessageDeterministicControlResult> => {
    await ctx.runMutation(internal.threads.insertImessageMessage, {
      threadId: args.threadId,
      orgId: args.orgId,
      role: "agent",
      content: response,
      responseMessageId: `${args.eventKey}:response`,
    });
    return { response, leaveGroup: options?.leaveGroup };
  };

  const slashCommandResult = await runImessageSlashCommand(ctx, {
    messageText: args.messageText,
    orgName: args.orgName,
    userName: args.userName,
    userEmail: args.userEmail,
    isGroup: args.isGroup,
    scopeMode: args.scopeMode,
    currentSenderIsLinked: args.currentSenderIsLinked,
    draftEmails: args.draftEmails,
    pendingEmails: args.pendingEmails,
    history: args.history,
  });
  if (slashCommandResult) {
    if (slashCommandResult.leaveGroup && args.isGroup) {
      await ctx.runMutation(internal.imessageChats.markLeft, {
        chatGuid: args.chatGuid,
      });
    }
    return await reply(slashCommandResult.response, {
      leaveGroup: slashCommandResult.leaveGroup,
    });
  }

  const isCancelConfirmationContext = isPendingEmailCancelConfirmationPrompt(
    args.recentConversationContext,
  );
  const emailControl = args.currentSenderIsLinked
    ? resolveTextChannelEmailControl({
        messageText: args.messageText,
        isCancelConfirmationContext,
        latestCancelledEmailId: args.latestCancelledEmail?._id,
        draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
        pendingEmailIds: args.pendingEmails.map((pendingEmail) => pendingEmail._id),
        allowDraftList: true,
        allowDraftSendAll: true,
      })
    : null;

  if (emailControl?.kind === "restore_cancelled_email") {
    const restored = await ctx.runMutation(
      internal.pendingEmails.restoreAsDraftInternal,
      { id: emailControl.emailId },
    );
    return await reply(
      restored ? "Email restored as a draft." : "I couldn't restore that email.",
    );
  }
  if (emailControl?.kind === "cancel_draft_emails") {
    let cancelledCount = 0;
    for (const id of emailControl.emailIds) {
      const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
        id,
      });
      if (ok) cancelledCount += 1;
    }
    return await reply(
      cancelledCount === 1
        ? "Email cancelled."
        : `${cancelledCount} draft emails cancelled.`,
    );
  }
  if (emailControl?.kind === "request_draft_cancel_confirmation") {
    return await reply(
      pendingEmailCancelConfirmationMessage("draft", emailControl.count),
    );
  }
  if (emailControl?.kind === "show_draft_emails") {
    return await reply(
      buildEmailDraftTextSummary(args.draftEmails, {
        sampleSize: args.draftEmails.length,
        commands: "chat",
      }),
    );
  }
  if (emailControl?.kind === "send_draft_emails") {
    let sentCount = 0;
    try {
      for (const id of emailControl.emailIds) {
        await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
          id,
        });
        sentCount += 1;
      }
      return await reply(
        sentCount === 1
          ? "Sent the draft email."
          : `Sent ${sentCount} draft emails.`,
      );
    } catch (err) {
      return await reply(
        err instanceof Error
          ? `I couldn't send all drafts: ${err.message}`
          : "I couldn't send all drafts.",
      );
    }
  }
  if (emailControl?.kind === "cancel_pending_emails") {
    let cancelledCount = 0;
    for (const id of emailControl.emailIds) {
      const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
        id,
      });
      if (ok) cancelledCount += 1;
    }
    return await reply(
      cancelledCount === 1
        ? "Email cancelled."
        : `${cancelledCount} pending emails cancelled.`,
    );
  }
  if (emailControl?.kind === "request_pending_cancel_confirmation") {
    return await reply(
      pendingEmailCancelConfirmationMessage("pending", emailControl.count),
    );
  }

  const taskControlIntent = args.messageText.trim().length < 100
    ? await resolveTaskControlIntent(ctx, {
        orgId: args.orgId,
        messageText: args.messageText,
        recentContext: args.recentConversationContext,
        channel: "imessage",
      })
    : null;
  if (taskControlIntent) {
    return await reply(taskControlResponse(taskControlIntent));
  }

  return null;
}
