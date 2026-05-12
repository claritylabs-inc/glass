"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { sendResendEmail } from "../lib/resend";
import { toResendAttachments } from "../lib/emailSubagent";

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
          legacyConversationId: pending.legacyConversationId,
        });
      }

      // Update legacy conversation if applicable
      if (pending.legacyConversationId) {
        const ccNote =
          pending.ccAddresses && pending.ccAddresses.length > 0
            ? ` (CC: ${pending.ccAddresses.join(", ")})`
            : "";
        await ctx.runMutation(internal.agentConversations.updateResponse, {
          id: pending.legacyConversationId,
          responseBody: `Email sent to ${pending.recipientEmail}${ccNote}.`,
          responseTo: pending.recipientEmail,
          responseCc: pending.ccAddresses,
          responseMessageId: sentMessageId,
          referencedPolicyIds: pending.referencedPolicyIds,
          referencedQuoteIds: pending.referencedQuoteIds,
        });
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
