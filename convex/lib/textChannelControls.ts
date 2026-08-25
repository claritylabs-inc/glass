import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
} from "./emailCancelIntent";
import {
  isShowMoreEmailDraftIntent,
} from "./emailDraftSummary";
import { parseStandaloneEmailAddress } from "./emailAddress";
import type { EmailCommand } from "./emailWorkflow";

const CONTEXTUAL_CONFIRMATIONS = new Set([
  "yes",
  "confirm",
  "send",
  "send it",
]);

export function isContextualConfirmation(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, "").trim();
  return CONTEXTUAL_CONFIRMATIONS.has(normalized);
}

export type TextChannelEmailControl<EmailId> = EmailCommand<EmailId>;

function extractStandaloneEmailAddress(text: string): string | null {
  return parseStandaloneEmailAddress(text);
}

export function resolveTextChannelEmailControl<EmailId>(args: {
  messageText: string;
  isCancelConfirmationContext: boolean;
  latestCancelledEmailId?: EmailId;
  draftEmailIds: EmailId[];
  draftApprovalEmailIds?: EmailId[];
  pendingEmailIds: EmailId[];
  allowDraftApproval?: boolean;
  allowDraftList?: boolean;
  maxControlTextLength?: number;
}): TextChannelEmailControl<EmailId> | null {
  const text = args.messageText.trim();
  if (text.length >= (args.maxControlTextLength ?? 100)) return null;

  if (args.latestCancelledEmailId && isPendingEmailRestoreIntent(text)) {
    return {
      kind: "restore_cancelled_email",
      emailId: args.latestCancelledEmailId,
    };
  }

  if (args.draftEmailIds.length > 0) {
    const correctedRecipient = extractStandaloneEmailAddress(text);
    if (correctedRecipient && args.draftEmailIds.length === 1) {
      return {
        kind: "update_single_draft_recipient",
        emailId: args.draftEmailIds[0],
        recipientEmail: correctedRecipient,
      };
    }
    if (
      args.isCancelConfirmationContext &&
      isPendingEmailCancelConfirmation(text)
    ) {
      return { kind: "cancel_draft_emails", emailIds: args.draftEmailIds };
    }
    if (isPendingEmailCancelIntent(text)) {
      return {
        kind: "request_draft_cancel_confirmation",
        count: args.draftEmailIds.length,
      };
    }
    if (args.allowDraftList && isShowMoreEmailDraftIntent(text)) {
      return { kind: "show_draft_emails" };
    }
    const draftApprovalEmailIds =
      args.draftApprovalEmailIds ?? args.draftEmailIds;
    if (
      args.allowDraftApproval &&
      draftApprovalEmailIds.length > 0 &&
      isContextualConfirmation(text)
    ) {
      return { kind: "send_draft_emails", emailIds: draftApprovalEmailIds };
    }
  }

  if (args.pendingEmailIds.length > 0) {
    if (
      args.isCancelConfirmationContext &&
      isPendingEmailCancelConfirmation(text)
    ) {
      return { kind: "cancel_pending_emails", emailIds: args.pendingEmailIds };
    }
    if (isPendingEmailCancelIntent(text)) {
      return {
        kind: "request_pending_cancel_confirmation",
        count: args.pendingEmailIds.length,
      };
    }
  }

  return null;
}
