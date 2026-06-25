"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { resolveApplicationIntakeStartIntent } from "./applicationIntakeIntent";
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
import { renderWorkflowComms } from "./workflows/comms";
import { applicationIntakeOutcome } from "./workflows/applicationIntake";

export type ImessageDeterministicControlResult = {
  response: string;
  leaveGroup?: boolean;
};

export async function runImessageDeterministicControls(
  ctx: ActionCtx,
  args: {
    messageText: string;
    orgId: Id<"organizations">;
    userId: Id<"users">;
    orgName: string;
    userName?: string;
    userEmail?: string;
    threadId: Id<"threads">;
    userMessageId: Id<"threadMessages">;
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
    options?: {
      leaveGroup?: boolean;
      usedTools?: string[];
      toolCalls?: Array<{
        name: string;
        input?: string;
        output?: string;
      }>;
      toolArtifacts?: Array<{
        type: string;
        data: unknown;
      }>;
    },
  ): Promise<ImessageDeterministicControlResult> => {
    await ctx.runMutation(internal.threads.insertImessageMessage, {
      threadId: args.threadId,
      orgId: args.orgId,
      role: "agent",
      content: response,
      responseMessageId: `${args.eventKey}:response`,
      usedTools: options?.usedTools,
      toolCalls: options?.toolCalls,
      toolArtifacts: options?.toolArtifacts,
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

  const applicationStartIntent = resolveApplicationIntakeStartIntent(
    args.messageText,
  );
  if (applicationStartIntent) {
    if (!args.currentSenderIsLinked) {
      return await reply(
        "Only a linked Glass user in this chat can start an application intake.",
      );
    }
    if (args.scopeMode !== "client") {
      return null;
    }

    const intake = await ctx.runMutation(
      internal.applicationIntakes.startFromAgent,
      {
        orgId: args.orgId,
        userId: args.userId,
        sourceKind: "imessage",
        requestText: applicationStartIntent.requestText,
        title: applicationStartIntent.title,
        applicationType: applicationStartIntent.applicationType,
        lineOfBusiness: applicationStartIntent.lineOfBusiness,
        product: applicationStartIntent.product,
        threadId: args.threadId,
        threadMessageId: args.userMessageId,
        missingQuestions: applicationStartIntent.missingQuestions,
      },
    );
    const output = applicationIntakeOutcome({
      action: "started",
      applicationIntakeId: intake?._id,
      status: intake?.status,
      title: intake?.title,
      missingQuestions: intake?.missingQuestions,
    });
    const response = renderWorkflowComms(output.workflowOutcome, "imessage");
    const toolInput = {
      title: applicationStartIntent.title,
      applicationType: applicationStartIntent.applicationType,
      lineOfBusiness: applicationStartIntent.lineOfBusiness,
      requestText: applicationStartIntent.requestText,
      missingQuestions: applicationStartIntent.missingQuestions,
    };
    return await reply(response, {
      usedTools: ["start_application_intake"],
      toolCalls: [
        {
          name: "start_application_intake",
          input: JSON.stringify(toolInput),
          output: JSON.stringify(output),
        },
      ],
      toolArtifacts: [
        {
          type: "application_intake",
          data: output,
        },
      ],
    });
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
