import {
  extractEmailAddress,
  normalizeEmailAddress,
} from "./emailAddress";

export type EmailAttachmentLike = {
  filename: string;
};

export type RequestedEmailAttachment = {
  kind: "original_policy" | "coi" | "uploaded_file";
  policyId?: string;
  fileId?: string;
  filename?: string;
  certificateHolder?: string;
  requestText?: string;
  requestedEndorsements?: string[];
};

export const MULTIPLE_COI_SINGLE_RECIPIENT_WARNING =
  "A single recipient email was given multiple COI attachments. I did not attach the batch because each holder email must include only that holder's COI.";

const SEPARATE_DELIVERY_PATTERN =
  /\b(separate|separately|individual|individually|one per|each holder|each recipient)\b/i;

const EXPLICIT_BUNDLE_PATTERN =
  /\b(bundle|packet|package|zip|same email|one email|single email|together)\b/i;

const EXPLICIT_ALL_CERTIFICATES_PATTERN =
  /\b(?:all|every|both|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of\s+)?(?:the\s+)?(?:cois|certificates|certificates of insurance)\b/i;

const EXPLICIT_ATTACH_COUNT_PATTERN =
  /\battach\s+(?:all|every|both|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

/**
 * Centralized COI attachment safety rules.
 *
 * Default behavior is holder-safe: one recipient should receive only the COI
 * that matches that recipient/holder. The exception is explicit user intent to
 * bundle multiple COIs into one email for one recipient, such as "attach all
 * five COIs" or "send all certificates together in one email".
 */
export function explicitlyRequestsCoiBatchForOneEmail(request: string | undefined): boolean {
  const text = request ?? "";
  return (
    EXPLICIT_BUNDLE_PATTERN.test(text) ||
    EXPLICIT_ALL_CERTIFICATES_PATTERN.test(text) ||
    EXPLICIT_ATTACH_COUNT_PATTERN.test(text)
  ) && !SEPARATE_DELIVERY_PATTERN.test(text);
}

export function isCoiDeliveryRequest(request: string | undefined): boolean {
  return /\b(coi|certificate of insurance|insurance certificate)\b/i.test(request ?? "");
}

export function isCoiAttachmentFilename(filename: string | undefined): boolean {
  return /\b(coi|certificate[-_\s]?of[-_\s]?insurance)\b/i.test(filename ?? "");
}

export function explicitlyRequestsOriginalPolicy(request: string | undefined): boolean {
  return /\b(original|full|complete|entire|copy of (?:the )?policy|policy pdf|policy document|declarations?|wording|specimen)\b/i.test(request ?? "");
}

export function shouldSuppressOriginalPolicyForCoiRequest(request: string | undefined): boolean {
  return isCoiDeliveryRequest(request) && !explicitlyRequestsOriginalPolicy(request);
}

export function normalizeAttachmentText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMatchText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@.+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recipientSearchTokens(email: string | null | undefined): string[] {
  if (!email) return [];
  const normalized = normalizeEmailAddress(email);
  const localPart = normalized.split("@")[0] ?? "";
  const plusTag = localPart.includes("+") ? localPart.split("+").at(-1) : localPart;
  return [normalized, localPart, plusTag ?? ""]
    .map((value) => normalizeMatchText(value).replace(/\d+$/g, ""))
    .filter((value) => value.length >= 4);
}

export function countCoiAttachments(attachments: EmailAttachmentLike[] | undefined): number {
  return (attachments ?? []).filter((attachment) =>
    isCoiAttachmentFilename(attachment.filename),
  ).length;
}

export function shouldBlockUnapprovedCoiAttachmentBatch(params: {
  attachments?: EmailAttachmentLike[];
  requestText?: string;
  allowMultipleCoiAttachments?: boolean;
  maxCoiAttachmentsWithoutExplicitBundle?: number;
}): boolean {
  if (params.allowMultipleCoiAttachments) return false;
  if (explicitlyRequestsCoiBatchForOneEmail(params.requestText)) return false;
  if (!isCoiDeliveryRequest(params.requestText)) return false;
  return countCoiAttachments(params.attachments) >
    (params.maxCoiAttachmentsWithoutExplicitBundle ?? 3);
}

export function resolveRequestedCoiAttachmentsForRecipient(input: {
  request: string;
  to?: string;
  recipientName?: string;
  defaultTo?: string;
  defaultRecipientName?: string;
  attachments?: RequestedEmailAttachment[];
}): {
  attachments: RequestedEmailAttachment[];
  allowMultipleCoiAttachments: boolean;
  warning?: string;
} {
  const attachments = input.attachments ?? [];
  const coiAttachments = attachments.filter((attachment) => attachment.kind === "coi");
  const allowMultipleCoiAttachments = explicitlyRequestsCoiBatchForOneEmail(input.request);

  if (coiAttachments.length <= 1 || allowMultipleCoiAttachments) {
    return { attachments, allowMultipleCoiAttachments };
  }

  const nonCoiAttachments = attachments.filter((attachment) => attachment.kind !== "coi");
  const recipient = extractEmailAddress(input.to) ?? extractEmailAddress(input.defaultTo);
  const tokens = [
    ...recipientSearchTokens(recipient),
    normalizeMatchText(input.recipientName),
    normalizeMatchText(input.defaultRecipientName),
  ].filter((token) => token.length >= 4);

  const matches = coiAttachments.filter((attachment) => {
    const searchable = normalizeMatchText([
      attachment.certificateHolder,
      attachment.filename,
      attachment.fileId,
    ].filter(Boolean).join(" "));
    return tokens.some((token) => searchable.includes(token));
  });

  if (matches.length === 1) {
    return {
      attachments: [...nonCoiAttachments, matches[0]],
      allowMultipleCoiAttachments,
    };
  }

  return {
    attachments: nonCoiAttachments,
    allowMultipleCoiAttachments,
    warning: MULTIPLE_COI_SINGLE_RECIPIENT_WARNING,
  };
}
