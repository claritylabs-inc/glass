"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { pendingEmailCancelConfirmationMessage } from "./emailCancelIntent";
import { buildEmailDraftTextSummary } from "./emailDraftSummary";
import type { EmailCommand } from "./emailWorkflow";

export type EmailCommandDraft = Pick<
  Doc<"pendingEmails">,
  | "_id"
  | "recipientEmail"
  | "subject"
  | "emailBody"
  | "attachments"
  | "ccAddresses"
  | "bccAddresses"
  | "sendBlockedReason"
>;

export type EmailCommandExecutionResult = {
  kind: EmailCommand["kind"] | "send_failed";
  responseBody: string;
  pendingEmailId?: Id<"pendingEmails">;
  sentCount?: number;
  failedCount?: number;
  error?: string;
};

type EmailCommandMutation =
  | typeof internal.pendingEmails.cancelInternal
  | typeof internal.pendingEmails.restoreAsDraftInternal
  | typeof internal.pendingEmails.updateDraftRecipientInternal;

export type EmailCommandExecutionCtx = {
  runAction(
    action: typeof internal.actions.sendPendingEmail.sendDraftInternal,
    args: { id: Id<"pendingEmails">; userConfirmedDraft: boolean },
  ): Promise<unknown>;
  runMutation(
    mutation: EmailCommandMutation,
    args:
      | { id: Id<"pendingEmails"> }
      | { id: Id<"pendingEmails">; recipientEmail: string },
  ): Promise<unknown>;
};

export async function executeEmailCommand(
  ctx: EmailCommandExecutionCtx,
  command: EmailCommand,
  args: {
    draftEmails: EmailCommandDraft[];
    includeBodyPreview?: boolean;
    continueOnSendFailure?: boolean;
  },
): Promise<EmailCommandExecutionResult> {
  if (command.kind === "restore_cancelled_email") {
    const restored = await ctx.runMutation(
      internal.pendingEmails.restoreAsDraftInternal,
      { id: command.emailId },
    ) as { id: Id<"pendingEmails"> } | null;
    return {
      kind: command.kind,
      responseBody: restored
        ? "Email restored as a draft."
        : "I couldn't restore that email.",
      pendingEmailId: restored?.id,
    };
  }

  if (command.kind === "cancel_draft_emails") {
    let cancelledCount = 0;
    for (const id of command.emailIds) {
      const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
        id,
      }) as boolean;
      if (ok) cancelledCount += 1;
    }
    return {
      kind: command.kind,
      responseBody:
        cancelledCount === 1
          ? "Email cancelled."
          : `${cancelledCount} draft emails cancelled.`,
    };
  }

  if (command.kind === "request_draft_cancel_confirmation") {
    return {
      kind: command.kind,
      responseBody: pendingEmailCancelConfirmationMessage(
        "draft",
        command.count,
      ),
    };
  }

  if (command.kind === "show_draft_emails") {
    return {
      kind: command.kind,
      responseBody: buildEmailDraftTextSummary(args.draftEmails, {
        sampleSize: args.draftEmails.length,
        includeBodyPreview: args.includeBodyPreview,
        commands: "chat",
      }),
    };
  }

  if (command.kind === "update_single_draft_recipient") {
    const updated = await ctx.runMutation(
      internal.pendingEmails.updateDraftRecipientInternal,
      {
        id: command.emailId,
        recipientEmail: command.recipientEmail,
      },
    ) as Doc<"pendingEmails"> | null;
    return {
      kind: command.kind,
      responseBody: updated
        ? buildEmailDraftTextSummary([updated], {
            sampleSize: 1,
            includeBodyPreview: args.includeBodyPreview,
            commands: "chat",
          })
        : "I couldn't update that draft.",
      pendingEmailId: updated?._id,
    };
  }

  if (command.kind === "send_draft_emails") {
    let sentCount = 0;
    const failures: string[] = [];
    for (const id of command.emailIds) {
      try {
        await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
          id,
          userConfirmedDraft: true,
        });
        sentCount += 1;
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
        if (!args.continueOnSendFailure) break;
      }
    }

    if (failures.length > 0) {
      return {
        kind: "send_failed",
        responseBody: `Sent ${sentCount} draft email${sentCount === 1 ? "" : "s"}; ${failures.length} failed. ${failures[0]}`,
        sentCount,
        failedCount: failures.length,
        error: failures[0],
      };
    }

    return {
      kind: command.kind,
      responseBody:
        sentCount === 1
          ? "Sent the draft email."
          : `Sent ${sentCount} draft emails.`,
      sentCount,
      failedCount: 0,
    };
  }

  if (command.kind === "cancel_pending_emails") {
    let cancelledCount = 0;
    for (const id of command.emailIds) {
      const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
        id,
      }) as boolean;
      if (ok) cancelledCount += 1;
    }
    return {
      kind: command.kind,
      responseBody:
        cancelledCount === 1
          ? "Email cancelled."
          : `${cancelledCount} pending emails cancelled.`,
    };
  }

  return {
    kind: command.kind,
    responseBody: pendingEmailCancelConfirmationMessage(
      "pending",
      command.count,
    ),
  };
}
