"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { isPendingEmailCancelConfirmation } from "./emailCancelIntent";
import { pendingEmailDraftFingerprint } from "./actionConfirmationFingerprint";
import {
  executeEmailCommand,
  type EmailCommandDraft,
} from "./emailCommandExecutor";
import { taskControlResponse } from "./taskControlIntent";
import {
  isContextualConfirmation,
  resolveTextChannelEmailControl,
} from "./textChannelControls";

export type WebChatControlMessage = {
  _id: Id<"threadMessages">;
  role: string;
  content: string;
  status?: string;
  pendingEmailId?: Id<"pendingEmails">;
};

type WebChatEmailControlRecord = Doc<"pendingEmails">;

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
    internal.agentHistory.getRecentControlMessages,
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
    userId: Id<"users">;
    threadId: Id<"threads">;
    orgId: Id<"organizations">;
  },
): Promise<boolean> {
  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.latestPendingInternal,
    { threadId: args.threadId },
  );
  const confirmationRequested =
    confirmation?.payload.kind === "email_cancel"
      ? isPendingEmailCancelConfirmation(args.messageText)
      : isContextualConfirmation(args.messageText);
  if (confirmationRequested) {
    if (
      confirmation &&
      confirmation.orgId === args.orgId &&
      confirmation.actor.kind === "user" &&
      confirmation.actor.userId === args.userId &&
      confirmation.payload.kind !== "draft_snapshot"
    ) {
      const confirmationResult = await ctx.runMutation(
        internal.threadActionConfirmations.consumeInternal,
        {
          id: confirmation._id,
          actor: { kind: "user", userId: args.userId },
          currentMessageId: args.userMessageId,
          requireAdjacentPrompt: true,
        },
      );
      if (confirmationResult !== "completed") {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: args.agentMessageId,
          content:
            confirmationResult === "expired"
              ? "That confirmation expired. Refresh the draft and confirm again."
              : "That draft changed or is no longer the latest confirmation. Refresh it and confirm again.",
        });
        return true;
      }
      if (confirmation.payload.kind === "coi_batch_delivery") {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: args.agentMessageId,
          content:
            "The exact COI attachment set is authorized. Use the Send action on the draft to deliver it.",
          pendingEmailId: confirmation.payload.pendingEmailId,
        });
        return true;
      }
      if (confirmation.payload.kind === "requirement_import") {
        const imports = [];
        for (const document of confirmation.payload.classifications) {
          if (document.documentClass !== "insurance_requirements") continue;
          const imported = await ctx.runAction(
            internal.actions.complianceRequirements.importRequirementsInternal,
            {
              orgId: args.orgId,
              userId: args.userId,
              fileId: document.fileId,
              fileName: document.filename,
              contentType: document.contentType,
              sourceName: document.filename,
              scope: confirmation.payload.scope,
            },
          );
          imports.push(imported);
        }
        const createdCount = imports.reduce(
          (total, imported) => total + imported.createdCount,
          0,
        );
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: args.agentMessageId,
          content: `Imported ${createdCount} insurance requirement${createdCount === 1 ? "" : "s"} from the confirmed source${imports.length === 1 ? "" : "s"}.`,
          toolArtifacts: [
            {
              type: "workflow_outcome",
              data: {
                workflowKind: "requirement_import",
                status: "completed",
                sourceDocumentIds: imports.map((item) => item.sourceDocumentId),
                requirementIds: imports.flatMap((item) => item.requirementIds),
              },
            },
          ],
        });
        return true;
      }
      if (confirmation.payload.kind === "email_send") {
        const result = await executeEmailCommand(
          ctx,
          {
            kind: "send_draft_emails",
            emailIds: confirmation.payload.pendingEmailIds,
          },
          {
            draftEmails: args.draftEmails,
            sendConfirmationId: confirmation._id,
          },
        );
        if (result.kind === "send_failed") {
          await ctx.runMutation(internal.threads.updateAgentError, {
            id: args.agentMessageId,
            error: result.error ?? result.responseBody,
            content: "Failed to send the confirmed draft email.",
          });
        } else {
          await ctx.runMutation(internal.threads.deleteMessageInternal, {
            id: args.agentMessageId,
          });
        }
        return true;
      }
      if (confirmation.payload.kind === "email_cancel") {
        const emailIds = confirmation.payload.pendingEmailIds;
        const draftIds = new Set(args.draftEmails.map((draft) => draft._id));
        const result = await executeEmailCommand(
          ctx,
          emailIds.every((id) => draftIds.has(id))
            ? { kind: "cancel_draft_emails", emailIds }
            : { kind: "cancel_pending_emails", emailIds },
          { draftEmails: args.draftEmails },
        );
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: args.agentMessageId,
          content: result.responseBody,
        });
        return true;
      }
    }
  }

  const emailControl = resolveTextChannelEmailControl({
    messageText: args.messageText,
    isCancelConfirmationContext: confirmation?.payload.kind === "email_cancel",
    latestCancelledEmailId: args.latestCancelledEmail?._id,
    draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
    pendingEmailIds: args.pendingEmails.map((pendingEmail) => pendingEmail._id),
    allowDraftApproval: false,
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
  if (
    result.kind === "request_draft_cancel_confirmation" ||
    result.kind === "request_pending_cancel_confirmation"
  ) {
    const targets =
      result.kind === "request_draft_cancel_confirmation"
        ? args.draftEmails
        : args.pendingEmails;
    if (targets.length > 0) {
      await ctx.runMutation(internal.threadActionConfirmations.createInternal, {
        orgId: args.orgId,
        threadId: args.threadId,
        actor: { kind: "user", userId: args.userId },
        promptMessageId: args.agentMessageId,
        payload: {
          kind: "email_cancel",
          pendingEmailIds: targets.map((target) => target._id),
          draftFingerprints: await Promise.all(
            targets.map((target) => pendingEmailDraftFingerprint(target)),
          ),
        },
      });
    }
  }
  return true;
}

export async function runWebChatTaskControl(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    threadId: Id<"threads">;
    agentMessageId: Id<"threadMessages">;
    userMessageId: Id<"threadMessages">;
    messageText: string;
    threadMessages: WebChatControlMessage[];
  },
): Promise<boolean> {
  const command = args.messageText.trim().toLowerCase();
  const taskControlIntent =
    command === "/cancel"
      ? ("cancel_task" as const)
      : command === "/reset" || command === "/new"
        ? ("reset_task" as const)
        : null;
  if (!taskControlIntent) return false;

  await ctx.runMutation(internal.agentHistory.resetTask, {
    threadId: args.threadId,
    currentMessageId: args.userMessageId,
  });

  await ctx.runMutation(internal.threads.updateAgentMessage, {
    id: args.agentMessageId,
    content: taskControlResponse(taskControlIntent),
  });
  return true;
}
