import type { Doc, Id } from "../_generated/dataModel";

export type EmailCommand<EmailId = Id<"pendingEmails">> =
  | { kind: "restore_cancelled_email"; emailId: EmailId }
  | { kind: "cancel_draft_emails"; emailIds: EmailId[] }
  | { kind: "request_draft_cancel_confirmation"; count: number }
  | { kind: "show_draft_emails" }
  | {
      kind: "update_single_draft_recipient";
      emailId: EmailId;
      recipientEmail: string;
    }
  | { kind: "send_draft_emails"; emailIds: EmailId[] }
  | { kind: "cancel_pending_emails"; emailIds: EmailId[] }
  | { kind: "request_pending_cancel_confirmation"; count: number };

export type EmailDraftBlockerCode =
  | "missing_recipient"
  | "missing_subject"
  | "missing_body"
  | "needs_confirmation"
  | "invalid_status";

export type EmailDraftBlocker = {
  code: EmailDraftBlockerCode;
  message: string;
};

type EmailDraftLike = Pick<
  Doc<"pendingEmails">,
  "recipientEmail" | "subject" | "emailBody" | "sendBlockedReason" | "status"
>;

export type EmailDraftSendability =
  | { status: "sendable"; blockers: [] }
  | { status: "blocked"; blockers: EmailDraftBlocker[] };

export function getEmailDraftBlockers(
  draft: Partial<EmailDraftLike>,
  options?: {
    allowedStatuses?: Array<Doc<"pendingEmails">["status"]>;
  },
): EmailDraftBlocker[] {
  const allowedStatuses = options?.allowedStatuses ?? ["draft"];
  const blockers: EmailDraftBlocker[] = [];

  if (draft.status && !allowedStatuses.includes(draft.status)) {
    blockers.push({
      code: "invalid_status",
      message: `Draft status is ${draft.status}.`,
    });
  }
  if (!draft.recipientEmail?.trim()) {
    blockers.push({
      code: "missing_recipient",
      message: "Draft is missing a recipient.",
    });
  }
  if (!draft.subject?.trim()) {
    blockers.push({
      code: "missing_subject",
      message: "Draft is missing a subject line.",
    });
  }
  if (!draft.emailBody?.trim()) {
    blockers.push({
      code: "missing_body",
      message: "Draft is missing an email body.",
    });
  }
  if (draft.sendBlockedReason?.trim()) {
    blockers.push({
      code: "needs_confirmation",
      message: draft.sendBlockedReason.trim(),
    });
  }

  return blockers;
}

export function getEmailDraftSendability(
  draft: Partial<EmailDraftLike>,
  options?: {
    allowedStatuses?: Array<Doc<"pendingEmails">["status"]>;
  },
): EmailDraftSendability {
  const blockers = getEmailDraftBlockers(draft, options);
  return blockers.length === 0
    ? { status: "sendable", blockers: [] }
    : { status: "blocked", blockers };
}

export function formatEmailDraftBlockers(blockers: EmailDraftBlocker[]) {
  return blockers.map((blocker) => blocker.message).join(" ");
}
