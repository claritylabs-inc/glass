import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
} from "./emailCancelIntent";
import {
  isSendAllEmailDraftsIntent,
  isShowMoreEmailDraftIntent,
} from "./emailDraftSummary";

const DRAFT_APPROVAL_PATTERN =
  /^(yes|yep|yeah|ok|okay|approved|approve|confirmed|confirm|send|send it|looks good|this is good|go ahead|do it|please send)\.?!?$/i;

export type TextChannelEmailControl<EmailId> =
  | { kind: "restore_cancelled_email"; emailId: EmailId }
  | { kind: "cancel_draft_emails"; emailIds: EmailId[] }
  | { kind: "request_draft_cancel_confirmation"; count: number }
  | { kind: "show_draft_emails" }
  | { kind: "send_draft_emails"; emailIds: EmailId[] }
  | { kind: "cancel_pending_emails"; emailIds: EmailId[] }
  | { kind: "request_pending_cancel_confirmation"; count: number };

export function resolveTextChannelEmailControl<EmailId>(args: {
  messageText: string;
  isCancelConfirmationContext: boolean;
  latestCancelledEmailId?: EmailId;
  draftEmailIds: EmailId[];
  pendingEmailIds: EmailId[];
  allowDraftApproval?: boolean;
  allowDraftList?: boolean;
  allowDraftSendAll?: boolean;
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
    if (
      (args.allowDraftSendAll && isSendAllEmailDraftsIntent(text)) ||
      (args.allowDraftApproval && DRAFT_APPROVAL_PATTERN.test(text))
    ) {
      return { kind: "send_draft_emails", emailIds: args.draftEmailIds };
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
