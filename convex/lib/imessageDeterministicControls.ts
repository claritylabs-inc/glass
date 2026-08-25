"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { AgentScope } from "./agentScope";
import { isPendingEmailCancelConfirmation } from "./emailCancelIntent";
import { pendingEmailDraftFingerprint } from "./actionConfirmationFingerprint";
import { executeEmailCommand } from "./emailCommandExecutor";
import type { ImessageHistoryMessage } from "./imessageAgentContext";
import { runImessageSlashCommand } from "./imessageSlashCommands";
import {
  isContextualConfirmation,
  resolveTextChannelEmailControl,
} from "./textChannelControls";

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
    eventKey: string;
    chatGuid: string;
    isGroup: boolean;
    scopeMode: AgentScope["mode"];
    currentSenderIsLinked: boolean;
    draftEmails: Array<Doc<"pendingEmails">>;
    pendingEmails: Array<Doc<"pendingEmails">>;
    latestCancelledEmail?: Doc<"pendingEmails"> | null;
    history: ImessageHistoryMessage[];
    currentMessageId: Id<"threadMessages">;
  },
): Promise<ImessageDeterministicControlResult | null> {
  const reply = async (
    response: string,
    options?: {
      leaveGroup?: boolean;
      draftSnapshot?: {
        pendingEmailIds: Id<"pendingEmails">[];
        draftFingerprints: string[];
      };
      cancelTargets?: Array<Doc<"pendingEmails">>;
    },
  ): Promise<ImessageDeterministicControlResult> => {
    const promptMessageId = await ctx.runMutation(
      internal.threads.insertImessageMessage,
      {
        threadId: args.threadId,
        orgId: args.orgId,
        role: "agent",
        messageKind:
          options?.draftSnapshot || options?.cancelTargets
            ? "workflow_status"
            : "conversation",
        content: response,
        responseMessageId: `${args.eventKey}:response`,
      },
    );
    if (options?.draftSnapshot) {
      await ctx.runMutation(internal.threadActionConfirmations.createInternal, {
        orgId: args.orgId,
        threadId: args.threadId,
        actor: { kind: "user", userId: args.userId },
        promptMessageId,
        payload: {
          kind: "draft_snapshot",
          pendingEmailIds: options.draftSnapshot.pendingEmailIds,
          draftFingerprints: options.draftSnapshot.draftFingerprints,
        },
      });
    }
    if (options?.cancelTargets?.length) {
      await ctx.runMutation(internal.threadActionConfirmations.createInternal, {
        orgId: args.orgId,
        threadId: args.threadId,
        actor: { kind: "user", userId: args.userId },
        promptMessageId,
        payload: {
          kind: "email_cancel",
          pendingEmailIds: options.cancelTargets.map((target) => target._id),
          draftFingerprints: await Promise.all(
            options.cancelTargets.map((target) =>
              pendingEmailDraftFingerprint(target),
            ),
          ),
        },
      });
    }
    return { response, leaveGroup: options?.leaveGroup };
  };

  const slashCommandResult = await runImessageSlashCommand(ctx, {
    messageText: args.messageText,
    orgId: args.orgId,
    userId: args.userId,
    orgName: args.orgName,
    userName: args.userName,
    userEmail: args.userEmail,
    isGroup: args.isGroup,
    scopeMode: args.scopeMode,
    currentSenderIsLinked: args.currentSenderIsLinked,
    draftEmails: args.draftEmails,
    pendingEmails: args.pendingEmails,
    history: args.history,
    threadId: args.threadId,
    currentMessageId: args.currentMessageId,
  });
  if (slashCommandResult) {
    if (slashCommandResult.leaveGroup && args.isGroup) {
      await ctx.runMutation(internal.imessageChats.markLeft, {
        chatGuid: args.chatGuid,
      });
    }
    return await reply(slashCommandResult.response, {
      leaveGroup: slashCommandResult.leaveGroup,
      draftSnapshot: slashCommandResult.draftSnapshot,
    });
  }

  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.latestPendingInternal,
    { threadId: args.threadId },
  );
  const isCancelConfirmationContext =
    confirmation?.payload.kind === "email_cancel";
  const confirmationRequested =
    confirmation?.payload.kind === "email_cancel"
      ? isPendingEmailCancelConfirmation(args.messageText)
      : isContextualConfirmation(args.messageText);
  if (args.currentSenderIsLinked && confirmationRequested) {
    if (
      confirmation &&
      confirmation.orgId === args.orgId &&
      confirmation.actor.kind === "user" &&
      confirmation.actor.userId === args.userId &&
      confirmation.payload.kind !== "draft_snapshot"
    ) {
      const outcome = await ctx.runMutation(
        internal.threadActionConfirmations.consumeInternal,
        {
          id: confirmation._id,
          actor: { kind: "user", userId: args.userId },
          currentMessageId: args.currentMessageId,
          requireAdjacentPrompt: true,
        },
      );
      if (outcome !== "completed") {
        return await reply(
          outcome === "expired"
            ? "That confirmation expired. Use /drafts and confirm again."
            : "That draft changed or is no longer the latest confirmation. Use /drafts and confirm again.",
        );
      }
      if (confirmation.payload.kind === "coi_batch_delivery") {
        return await reply(
          "The exact COI attachment set is authorized. Use /send 1 to deliver it.",
        );
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
        return await reply(
          `Imported ${createdCount} insurance requirement${createdCount === 1 ? "" : "s"} from the confirmed source${imports.length === 1 ? "" : "s"}.`,
        );
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
        return await reply(result.responseBody);
      }
      if (confirmation.payload.kind === "email_cancel") {
        const draftIds = new Set(args.draftEmails.map((draft) => draft._id));
        const emailIds = confirmation.payload.pendingEmailIds;
        const result = await executeEmailCommand(
          ctx,
          emailIds.every((id) => draftIds.has(id))
            ? { kind: "cancel_draft_emails", emailIds }
            : { kind: "cancel_pending_emails", emailIds },
          { draftEmails: args.draftEmails },
        );
        return await reply(result.responseBody);
      }
    }
  }
  const emailControl = args.currentSenderIsLinked
    ? resolveTextChannelEmailControl({
        messageText: args.messageText,
        isCancelConfirmationContext,
        latestCancelledEmailId: args.latestCancelledEmail?._id,
        draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
        pendingEmailIds: args.pendingEmails.map(
          (pendingEmail) => pendingEmail._id,
        ),
        allowDraftList: false,
      })
    : null;

  if (emailControl) {
    const result = await executeEmailCommand(ctx, emailControl, {
      draftEmails: args.draftEmails,
    });
    const cancelTargets =
      result.kind === "request_draft_cancel_confirmation"
        ? args.draftEmails
        : result.kind === "request_pending_cancel_confirmation"
          ? args.pendingEmails
          : undefined;
    return await reply(result.responseBody, { cancelTargets });
  }

  return null;
}
