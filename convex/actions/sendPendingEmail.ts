"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { sendResendEmail } from "../lib/resend";
import { toResendAttachments } from "../lib/emailSubagent";
import { getImessageWorkerUrl } from "../lib/imessageConfig";

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

export const sendPending = internalAction({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.id,
    });
    if (!pending || pending.status !== "pending") {
      return; // cancelled or already sent
    }

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
        id: args.id,
        sentMessageId,
      });

      // Update chat message to show confirmation
      if (pending.chatMessageId) {
        const ccNote =
          pending.ccAddresses && pending.ccAddresses.length > 0
            ? ` (CC: ${pending.ccAddresses.join(", ")})`
            : "";
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: pending.chatMessageId,
          content: `Email sent to ${pending.recipientEmail}${ccNote}.`,
        });
      }

      // Insert the sent email as an email-channel message in the thread
      if (pending.threadId) {
        const thread = await ctx.runQuery(internal.threads.getInternal, {
          id: pending.threadId,
        });
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
        });

        if (thread?.threadPhone) {
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
              responseMessageId: `${args.id}:sent-confirmation`,
            });
          }
        }
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to send pending email:", errMsg);

      // Update chat message with error
      if (pending.chatMessageId) {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: pending.chatMessageId,
          content: `_Failed to send email: ${errMsg}_`,
        });
      }
    }
  },
});
