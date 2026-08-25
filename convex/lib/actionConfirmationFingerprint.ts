import type { Doc, Id } from "../_generated/dataModel";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}
export async function confirmationFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function pendingEmailDraftFingerprint(
  draft: Pick<
    Doc<"pendingEmails">,
    | "recipientEmail"
    | "ccAddresses"
    | "bccAddresses"
    | "subject"
    | "emailBody"
    | "attachments"
    | "referencedPolicyIds"
  >,
): Promise<string> {
  return await confirmationFingerprint({
    recipientEmail: draft.recipientEmail.trim().toLowerCase(),
    ccAddresses: (draft.ccAddresses ?? []).map((value) =>
      value.trim().toLowerCase(),
    ),
    bccAddresses: (draft.bccAddresses ?? []).map((value) =>
      value.trim().toLowerCase(),
    ),
    subject: draft.subject,
    emailBody: draft.emailBody,
    attachments: (draft.attachments ?? []).map((attachment) => ({
      fileId: String(attachment.fileId as Id<"_storage">),
      filename: attachment.filename,
      kind: attachment.kind,
    })),
    referencedPolicyIds: (draft.referencedPolicyIds ?? []).map(String),
  });
}
