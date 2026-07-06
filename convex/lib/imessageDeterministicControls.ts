"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { AgentScope } from "./agentScope";
import { isPendingEmailCancelConfirmationPrompt } from "./emailCancelIntent";
import { executeEmailCommand } from "./emailCommandExecutor";
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

  if (emailControl) {
    const result = await executeEmailCommand(ctx, emailControl, {
      draftEmails: args.draftEmails,
    });
    return await reply(result.responseBody);
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
