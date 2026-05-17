"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { sendResendEmail } from "../lib/resend";
import { toResendAttachments } from "../lib/emailSubagent";
import { getImessageWorkerUrl } from "../lib/imessageConfig";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

type SendEmailResult = { recipientEmail: string } | null;
type BulkDraftSendResult = {
  sent: Array<{ id: Id<"pendingEmails">; recipientEmail: string }>;
  failed: Array<{ id: Id<"pendingEmails">; error: string }>;
};

function isCoiText(text: string | undefined): boolean {
  return /\b(coi|certificate(?:\s+of\s+insurance)?)\b/i.test(text ?? "");
}

function isCoiAttachment(filename: string): boolean {
  return /\b(coi|certificate[-_\s]?of[-_\s]?insurance)\b/i.test(filename);
}

function assertSafeDraftAttachments(pending: Doc<"pendingEmails">) {
  const attachments = pending.attachments ?? [];
  if (!attachments.length) return;
  const coiAttachmentCount = attachments.filter((attachment) =>
    isCoiAttachment(attachment.filename),
  ).length;
  if (
    coiAttachmentCount > 3 &&
    (isCoiText(pending.subject) || isCoiText(pending.emailBody))
  ) {
    throw new Error(
      "This COI draft has too many certificate attachments. Cancel it and regenerate the draft before sending.",
    );
  }
}

async function sendTextConfirmation(params: {
  toPhone: string;
  chatGuid?: string;
  message: string;
}): Promise<boolean> {
  const workerUrl = getImessageWorkerUrl();
  if (!workerUrl) return false;

  try {
    const res = await fetch(`${workerUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.IMESSAGE_WORKER_SECRET ?? ""}`,
      },
      body: JSON.stringify({
        toPhone: params.toPhone,
        chatGuid: params.chatGuid,
        message: params.message,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[sendPendingEmail] SMS sent confirmation failed ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[sendPendingEmail] SMS sent confirmation failed:", err);
    return false;
  }
}

async function sendPendingEmailById(
  ctx: ActionCtx,
  id: Id<"pendingEmails">,
  options: {
    allowedStatuses: Array<Doc<"pendingEmails">["status"]>;
    updateChatMessage: boolean;
    notifyImessage: boolean;
  },
): Promise<SendEmailResult> {
  const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
    id,
  }) as Doc<"pendingEmails"> | null;
    if (!pending || !options.allowedStatuses.includes(pending.status)) {
      return null; // cancelled or already sent
    }
    if (!pending.recipientEmail || !pending.subject || !pending.emailBody) {
      throw new Error("Draft is missing required email fields.");
    }
    assertSafeDraftAttachments(pending);

    try {
      const payload = JSON.parse(pending.emailPayload);
      if (pending.attachments && pending.attachments.length > 0) {
        payload.attachments = await toResendAttachments(ctx, pending.attachments);
      }
      const result = await sendResendEmail(payload);
      if (!result.ok) throw new Error(`Failed to send email: ${result.error}`);
      const sentMessageId = result.id;

      // Mark as sent
      await ctx.runMutation(internal.pendingEmails.markSent, {
        id,
        sentMessageId,
      });

      if (options.updateChatMessage && pending.chatMessageId) {
        const ccNote =
          pending.ccAddresses && pending.ccAddresses.length > 0
            ? ` (CC: ${pending.ccAddresses.join(", ")})`
            : "";
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: pending.chatMessageId,
          content: `Email sent to ${pending.recipientEmail}${ccNote}.`,
        });
      }

      if (pending.threadId) {
        const thread = await ctx.runQuery(internal.threads.getInternal, {
          id: pending.threadId,
        });
        if (pending.threadMessageId) {
          await ctx.runMutation(internal.threads.updateEmailMessage, {
            id: pending.threadMessageId,
            content: pending.emailBody,
            toAddresses: [pending.recipientEmail],
            ccAddresses: pending.ccAddresses,
            bccAddresses: pending.bccAddresses,
            subject: pending.subject,
            responseMessageId: sentMessageId,
            attachments: pending.attachments,
            referencedPolicyIds: pending.referencedPolicyIds,
            referencedQuoteIds: pending.referencedQuoteIds,
            clearStatus: true,
          });
        } else {
          await ctx.runMutation(internal.threads.insertEmailMessage, {
            threadId: pending.threadId,
            orgId: pending.orgId,
            role: "agent",
            content: pending.emailBody,
            toAddresses: [pending.recipientEmail],
            ccAddresses: pending.ccAddresses,
            bccAddresses: pending.bccAddresses,
            subject: pending.subject,
            responseMessageId: sentMessageId,
            attachments: pending.attachments,
            referencedPolicyIds: pending.referencedPolicyIds,
            referencedQuoteIds: pending.referencedQuoteIds,
            pendingEmailId: id,
          });
        }

        if (options.notifyImessage && thread?.threadPhone) {
          const ccNote =
            pending.ccAddresses && pending.ccAddresses.length > 0
              ? ` CC ${pending.ccAddresses.join(", ")}`
              : "";
          const confirmation = `Email sent to ${pending.recipientEmail}.${ccNote}`;
          const sent = await sendTextConfirmation({
            toPhone: thread.threadPhone,
            chatGuid: thread.imessageChatGuid,
            message: confirmation,
          });
          if (sent) {
            await ctx.runMutation(internal.threads.insertImessageMessage, {
              threadId: pending.threadId,
              orgId: pending.orgId,
              role: "agent",
              content: confirmation,
              responseMessageId: `${id}:sent-confirmation`,
              pendingEmailId: id,
            });
          }
        }
      }

      return { recipientEmail: pending.recipientEmail };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to send pending email:", errMsg);

      if (options.updateChatMessage && pending.chatMessageId) {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: pending.chatMessageId,
          content: `_Failed to send email: ${errMsg}_`,
        });
      }
      if (pending.threadMessageId) {
        await ctx.runMutation(internal.threads.updateEmailMessage, {
          id: pending.threadMessageId,
          error: errMsg,
        });
      }
      throw err;
    }
}

export const sendPending = internalAction({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["pending"],
      updateChatMessage: true,
      notifyImessage: true,
    });
  },
});

export const sendDraftInternal = internalAction({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["draft"],
      updateChatMessage: false,
      notifyImessage: false,
    });
  },
});

export const sendDraftNow = action({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args): Promise<{ recipientEmail: string }> => {
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {}) as {
      membership?: { orgId: string };
    } | null;
    if (!orgData?.membership?.orgId) {
      throw new Error("Not authenticated");
    }
    const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.id,
    }) as Doc<"pendingEmails"> | null;
    if (!pending || pending.orgId !== orgData.membership.orgId) {
      throw new Error("Not found");
    }
    const sent = await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["draft"],
      updateChatMessage: false,
      notifyImessage: false,
    });
    return sent ?? { recipientEmail: pending.recipientEmail };
  },
});

export const sendDraftsNow = action({
  args: { ids: v.array(v.id("pendingEmails")) },
  handler: async (ctx, args): Promise<BulkDraftSendResult> => {
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {}) as {
      membership?: { orgId: string };
    } | null;
    if (!orgData?.membership?.orgId) {
      throw new Error("Not authenticated");
    }

    const uniqueIds = [...new Set(args.ids)];
    if (uniqueIds.length === 0) {
      throw new Error("No email drafts selected.");
    }

    const drafts: Array<Doc<"pendingEmails">> = [];
    for (const id of uniqueIds) {
      const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
        id,
      }) as Doc<"pendingEmails"> | null;
      if (!pending || pending.orgId !== orgData.membership.orgId) {
        throw new Error("Not found");
      }
      if (pending.status !== "draft") {
        throw new Error("Only draft emails can be sent together.");
      }
      drafts.push(pending);
    }

    const result: BulkDraftSendResult = { sent: [], failed: [] };
    for (const draft of drafts) {
      try {
        const sent = await sendPendingEmailById(ctx, draft._id, {
          allowedStatuses: ["draft"],
          updateChatMessage: false,
          notifyImessage: false,
        });
        result.sent.push({
          id: draft._id,
          recipientEmail: sent?.recipientEmail ?? draft.recipientEmail,
        });
      } catch (err) {
        result.failed.push({
          id: draft._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  },
});
