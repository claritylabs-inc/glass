import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmailAddress } from "./emailAddress";
import { parseEmailPayloadRecord } from "./emailPayloadFields";

function normalizeRecipientList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map(normalizeEmailAddress)
    .filter(Boolean);
}

export function updateEmailPayloadRecipient(
  emailPayload: string,
  recipientEmail: string,
): string {
  const normalizedRecipient = normalizeEmailAddress(recipientEmail);
  const payload = parseEmailPayloadRecord(emailPayload);
  const cc = normalizeRecipientList(payload.cc).filter(
    (email) => email !== normalizedRecipient,
  );
  const bcc = normalizeRecipientList(payload.bcc).filter(
    (email) => email !== normalizedRecipient && !cc.includes(email),
  );

  payload.to = normalizedRecipient;
  if (cc.length > 0) {
    payload.cc = cc;
  } else {
    delete payload.cc;
  }
  if (bcc.length > 0) {
    payload.bcc = bcc;
  } else {
    delete payload.bcc;
  }

  return JSON.stringify(payload);
}

function parseLegacyConfirmationOutput(
  output: string | undefined,
  recipientEmail: string,
): string | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as {
      status?: unknown;
      confirmationReason?: unknown;
      responseTo?: unknown;
    };
    if (parsed.status !== "needs_confirmation") return null;
    if (
      typeof parsed.responseTo === "string" &&
      normalizeEmailAddress(parsed.responseTo) !== recipientEmail
    ) {
      return null;
    }
    return typeof parsed.confirmationReason === "string" &&
      parsed.confirmationReason.trim()
      ? parsed.confirmationReason.trim()
      : "Confirm the recipient before sending.";
  } catch {
    return null;
  }
}

export async function withLegacySendBlockedReason(
  ctx: QueryCtx,
  pending: Doc<"pendingEmails"> | null,
) {
  if (
    !pending ||
    pending.status !== "draft" ||
    pending.sendBlockedReason ||
    !pending.threadId
  ) {
    return pending;
  }

  const recipientEmail = normalizeEmailAddress(pending.recipientEmail);
  const messages = await ctx.db
    .query("threadMessages")
    .withIndex("by_threadId", (q) => q.eq("threadId", pending.threadId!))
    .collect();
  for (const message of [...messages].reverse()) {
    if (message.pendingEmailId !== pending._id) continue;
    for (const toolCall of [...(message.toolCalls ?? [])].reverse()) {
      const reason = parseLegacyConfirmationOutput(
        toolCall.output,
        recipientEmail,
      );
      if (reason) return { ...pending, sendBlockedReason: reason };
    }
  }

  return pending;
}

export async function restoreCancelledEmailAsDraft(
  ctx: MutationCtx,
  id: Id<"pendingEmails">,
) {
  const pending = await ctx.db.get(id);
  if (!pending || pending.status !== "cancelled") {
    return null;
  }

  await ctx.db.patch(id, {
    status: "draft",
    scheduledSendTime: 0,
    sentMessageId: undefined,
  });

  if (pending.threadMessageId) {
    await ctx.db.patch(pending.threadMessageId, {
      content: pending.emailBody,
      toAddresses: [pending.recipientEmail],
      ccAddresses: pending.ccAddresses,
      bccAddresses: pending.bccAddresses,
      subject: pending.subject,
      attachments: pending.attachments,
      referencedPolicyIds: pending.referencedPolicyIds,
      pendingEmailId: id,
      responseMessageId: undefined,
      status: "draft_email",
      error: undefined,
    });
  }

  if (pending.chatMessageId) {
    await ctx.db.patch(pending.chatMessageId, {
      content: "Email restored as a draft. Review it in the email draft card.",
      status: undefined,
      pendingEmailId: id,
    });
  }

  return pending;
}

export async function cancelDraftOrPendingEmail(
  ctx: MutationCtx,
  id: Id<"pendingEmails">,
) {
  const pending = await ctx.db.get(id);
  if (!pending || (pending.status !== "pending" && pending.status !== "draft")) {
    return false;
  }

  await ctx.db.patch(id, { status: "cancelled" });

  if (pending.threadMessageId) {
    await ctx.db.patch(pending.threadMessageId, {
      status: "cancelled",
    });
  }

  if (pending.chatMessageId) {
    await ctx.db.patch(pending.chatMessageId, {
      content: "Email cancelled.",
      status: undefined,
      pendingEmailId: id,
    });
  }
  return true;
}

export async function updateDraftRecipient(
  ctx: MutationCtx,
  id: Id<"pendingEmails">,
  recipientEmailInput: string,
) {
  const pending = await ctx.db.get(id);
  if (!pending || pending.status !== "draft") return null;

  const recipientEmail = normalizeEmailAddress(recipientEmailInput);
  const ccAddresses = (pending.ccAddresses ?? [])
    .map(normalizeEmailAddress)
    .filter((email) => email && email !== recipientEmail);
  const bccAddresses = (pending.bccAddresses ?? [])
    .map(normalizeEmailAddress)
    .filter(
      (email) =>
        email && email !== recipientEmail && !ccAddresses.includes(email),
    );

  await ctx.db.patch(id, {
    recipientEmail,
    ccAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
    bccAddresses: bccAddresses.length > 0 ? bccAddresses : undefined,
    emailPayload: updateEmailPayloadRecipient(
      pending.emailPayload,
      recipientEmail,
    ),
    sendBlockedReason: undefined,
  });

  if (pending.threadMessageId) {
    await ctx.db.patch(pending.threadMessageId, {
      toAddresses: [recipientEmail],
      ccAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
      bccAddresses: bccAddresses.length > 0 ? bccAddresses : undefined,
      error: undefined,
    });
  }

  return await ctx.db.get(id);
}
