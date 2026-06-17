import type { Id } from "../_generated/dataModel";
import type { BrokerIdentity } from "./brokerIdentity";

export const BROKER_CONTACT_REQUIRED_CODE = "broker_contact_required";

export type BrokerRecipientQuestionKind = "policy_change" | "certificate";

export type MissingInfoQuestion = {
  code: string;
  question: string;
  reason: string;
};

export type BrokerSubmissionSnapshot = Record<string, unknown> & {
  routingStatus?: string;
  source?: string;
  brokerOrgId?: Id<"organizations">;
  brokerCompanyName?: string;
  recipientEmail?: string;
  recipientName?: string;
  contactPhone?: string;
  needsRecipient?: boolean;
};

export type PolicyChangeCaseForBrokerRouting = {
  status?: string;
  brokerSubmission?: unknown;
  missingInfoQuestions?: unknown;
  pendingQuestions?: unknown;
  validationIssues?: unknown;
};

export type BrokerRecipientReconciliationPatch = {
  brokerSubmission?: BrokerSubmissionSnapshot;
  missingInfoQuestions?: unknown[];
  pendingQuestions?: string[];
  status?: "ready_to_submit";
};

export type BrokerRecipientReconciliationResult<
  TCase extends PolicyChangeCaseForBrokerRouting,
> = {
  changed: boolean;
  case: TCase;
  patch?: BrokerRecipientReconciliationPatch;
};

const POLICY_CHANGE_BROKER_CONTACT_QUESTION =
  "Which broker email or contact should receive this policy change request?";

const CERTIFICATE_BROKER_CONTACT_QUESTION =
  "Which broker email or contact should receive this certificate change request?";

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanEmail(value: unknown): string | undefined {
  return cleanText(value)?.toLowerCase();
}

function normalizedQuestionText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasBlockingValidationIssue(validationIssues: unknown): boolean {
  if (!Array.isArray(validationIssues)) return false;
  return validationIssues.some((issue) => {
    if (!issue || typeof issue !== "object") return false;
    return (issue as { severity?: unknown }).severity === "blocking";
  });
}

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === "accepted" ||
    status === "completed" ||
    status === "declined" ||
    status === "cancelled"
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeMissingInfoQuestions(missingInfo: unknown): unknown[] {
  return Array.isArray(missingInfo) ? missingInfo : [];
}

export function buildBrokerSubmissionFromIdentity(
  identity: BrokerIdentity | null | undefined,
): BrokerSubmissionSnapshot | undefined {
  if (!identity || !identity.clientOrgId) return undefined;

  const recipientEmail = cleanEmail(identity.contactEmail);
  const recipientName = identity.contactName ?? identity.brokerCompanyName;
  const routingStatus = recipientEmail
    ? "recipient_ready"
    : identity.source === "none"
      ? "needs_broker_contact"
      : "needs_broker_recipient";

  return {
    routingStatus,
    source: identity.source,
    brokerOrgId: identity.brokerOrgId,
    brokerCompanyName: identity.brokerCompanyName,
    recipientEmail,
    recipientName,
    contactPhone: identity.contactPhone,
    needsRecipient: !recipientEmail,
  };
}

export function brokerRecipientQuestion(
  kind: BrokerRecipientQuestionKind = "policy_change",
): MissingInfoQuestion {
  if (kind === "certificate") {
    return {
      code: BROKER_CONTACT_REQUIRED_CODE,
      question: CERTIFICATE_BROKER_CONTACT_QUESTION,
      reason:
        "Certificate requests that require policy changes are broker-mediated and need a broker recipient before Glass can draft or send one.",
    };
  }

  return {
    code: BROKER_CONTACT_REQUIRED_CODE,
    question: POLICY_CHANGE_BROKER_CONTACT_QUESTION,
    reason:
      "Policy change emails are broker-mediated and need an explicit broker recipient before Glass can draft or send one.",
  };
}

export function isBrokerRecipientQuestion(question: unknown): boolean {
  if (question && typeof question === "object") {
    const record = question as { code?: unknown; question?: unknown };
    if (record.code === BROKER_CONTACT_REQUIRED_CODE) return true;
    return isBrokerRecipientQuestion(record.question);
  }

  if (typeof question !== "string") return false;
  const normalized = normalizedQuestionText(question);
  return (
    normalized === BROKER_CONTACT_REQUIRED_CODE ||
    normalized === POLICY_CHANGE_BROKER_CONTACT_QUESTION ||
    normalized === CERTIFICATE_BROKER_CONTACT_QUESTION
  );
}

export function hasMissingBrokerRecipient(missingInfo: unknown[]): boolean {
  return missingInfo.some(isBrokerRecipientQuestion);
}

export function withBrokerRecipientQuestion(
  missingInfo: unknown[],
  brokerSubmission: unknown,
  kind: BrokerRecipientQuestionKind = "policy_change",
): unknown[] {
  if (
    asRecord(brokerSubmission).needsRecipient === true &&
    !hasMissingBrokerRecipient(missingInfo)
  ) {
    return [...missingInfo, brokerRecipientQuestion(kind)];
  }
  return missingInfo;
}

export function missingBrokerRecipientInfo(
  brokerSubmission: unknown,
  kind: BrokerRecipientQuestionKind = "policy_change",
): MissingInfoQuestion[] {
  return asRecord(brokerSubmission).needsRecipient === true
    ? [brokerRecipientQuestion(kind)]
    : [];
}

export function removeBrokerRecipientQuestions(
  questions: unknown,
): unknown[] {
  return normalizeMissingInfoQuestions(questions).filter(
    (question) => !isBrokerRecipientQuestion(question),
  );
}

export function pendingQuestionsFromMissingInfo(missingInfo: unknown): string[] {
  return normalizeMissingInfoQuestions(missingInfo)
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "question" in item) {
        return cleanText((item as { question?: unknown }).question);
      }
      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

export function reconcileBrokerRecipientSnapshot<
  TCase extends PolicyChangeCaseForBrokerRouting,
>(args: {
  changeCase: TCase;
  currentBrokerSubmission?: BrokerSubmissionSnapshot;
}): BrokerRecipientReconciliationResult<TCase> {
  const existingSubmission = asRecord(
    args.changeCase.brokerSubmission,
  ) as BrokerSubmissionSnapshot;
  const existingRecipientEmail = cleanText(existingSubmission.recipientEmail);
  const currentRecipientEmail = cleanEmail(
    args.currentBrokerSubmission?.recipientEmail,
  );
  const recipientEmail = existingRecipientEmail ?? currentRecipientEmail;

  if (!recipientEmail) {
    return { changed: false, case: args.changeCase };
  }

  const nextSubmission: BrokerSubmissionSnapshot = existingRecipientEmail
    ? {
        ...existingSubmission,
        recipientEmail: existingRecipientEmail,
        needsRecipient: false,
        routingStatus: "recipient_ready",
      }
    : {
        ...existingSubmission,
        ...args.currentBrokerSubmission,
        recipientEmail,
        needsRecipient: false,
        routingStatus: "recipient_ready",
      };

  const nextMissingInfo = removeBrokerRecipientQuestions(
    args.changeCase.missingInfoQuestions,
  );
  const nextPendingQuestions = normalizePendingQuestions(
    args.changeCase.pendingQuestions,
  ).filter((question) => !isBrokerRecipientQuestion(question));

  const patch: BrokerRecipientReconciliationPatch = {};
  if (!sameJson(existingSubmission, nextSubmission)) {
    patch.brokerSubmission = nextSubmission;
  }
  if (
    !sameJson(
      normalizeMissingInfoQuestions(args.changeCase.missingInfoQuestions),
      nextMissingInfo,
    )
  ) {
    patch.missingInfoQuestions = nextMissingInfo;
  }
  if (
    !sameJson(
      normalizePendingQuestions(args.changeCase.pendingQuestions),
      nextPendingQuestions,
    )
  ) {
    patch.pendingQuestions = nextPendingQuestions;
  }

  const status = args.changeCase.status;
  if (
    status === "needs_info" &&
    !isTerminalStatus(status) &&
    nextMissingInfo.length === 0 &&
    nextPendingQuestions.length === 0 &&
    !hasBlockingValidationIssue(args.changeCase.validationIssues)
  ) {
    patch.status = "ready_to_submit";
  }

  if (Object.keys(patch).length === 0) {
    return { changed: false, case: args.changeCase };
  }

  return {
    changed: true,
    case: {
      ...args.changeCase,
      ...patch,
    } as TCase,
    patch,
  };
}

export function normalizePendingQuestions(pendingQuestions: unknown): string[] {
  return Array.isArray(pendingQuestions)
    ? pendingQuestions.filter((question): question is string => {
        return typeof question === "string" && question.trim().length > 0;
      })
    : [];
}
