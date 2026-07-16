"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  buildEmailPayload,
  type EmailAttachmentMeta,
} from "./emailDelivery";
import {
  buildEmailSignature,
  getEmailAgentFromName,
  type BrokerBranding,
} from "./emailIdentity";

export type EmailDraftArtifactContext = {
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  chatMessageId?: Id<"threadMessages">;
  channel: "web" | "email" | "imessage" | "mcp";
  fromHeader: string;
  agentAddress: string;
  replyTo?: string;
  brokerBranding?: BrokerBranding;
  senderEmail?: string;
  defaultBcc?: string[];
  inReplyTo?: string;
  references?: string;
};

export type EmailDraftArtifactParams = {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: EmailAttachmentMeta[];
  allowMultipleCoiAttachments?: boolean;
  referencedPolicyIds?: Id<"policies">[];
  sendBlockedReason?: string;
};

export async function upsertEmailDraftArtifact(
  ctx: ActionCtx,
  context: EmailDraftArtifactContext,
  params: EmailDraftArtifactParams,
): Promise<Id<"pendingEmails"> | undefined> {
  if (
    !["web", "imessage", "mcp"].includes(context.channel) ||
    !context.threadId
  ) {
    return undefined;
  }

  const signature = buildEmailSignature(
    context.agentAddress,
    context.brokerBranding,
  );
  const emailPayload = buildEmailPayload({
    fromHeader: context.fromHeader,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    signature,
    inReplyTo: context.inReplyTo,
    references: context.references,
    replyTo: context.replyTo,
  });

  const existing = await ctx.runQuery(
    internal.pendingEmails.findDraftByThreadAndRecipient,
    {
      threadId: context.threadId,
      recipientEmail: params.to,
    },
  );

  if (existing) {
    await ctx.runMutation(internal.pendingEmails.updateDraftInternal, {
      id: existing._id,
      emailPayload: JSON.stringify(emailPayload),
      recipientEmail: params.to,
      ccAddresses: params.cc.length > 0 ? params.cc : undefined,
      bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
      subject: params.subject,
      emailBody: params.body,
      fromHeader: context.fromHeader,
      replyTo: context.replyTo,
      inReplyTo: context.inReplyTo,
      references: context.references,
      renderedText: emailPayload.text,
      renderedHtml: emailPayload.html,
      attachments:
        params.attachments.length > 0 ? params.attachments : undefined,
      allowMultipleCoiAttachments: params.allowMultipleCoiAttachments,
      referencedPolicyIds: params.referencedPolicyIds,
      sendBlockedReason: params.sendBlockedReason,
      chatMessageId: context.chatMessageId,
    });
    if (existing.threadMessageId) {
      await ctx.runMutation(internal.threads.updateEmailMessage, {
        id: existing.threadMessageId,
        content: params.body,
        toAddresses: [params.to],
        ccAddresses: params.cc.length > 0 ? params.cc : undefined,
        bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
        subject: params.subject,
        attachments:
          params.attachments.length > 0 ? params.attachments : undefined,
        referencedPolicyIds: params.referencedPolicyIds,
        pendingEmailId: existing._id,
        status: "draft_email",
      });
    }
    if (context.chatMessageId) {
      await ctx.runMutation(internal.threads.attachPendingEmailToAgentMessage, {
        id: context.chatMessageId,
        pendingEmailId: existing._id,
      });
    }
    return existing._id;
  }

  const pendingEmailId = await ctx.runMutation(internal.pendingEmails.create, {
    orgId: context.orgId,
    threadId: context.threadId,
    emailPayload: JSON.stringify(emailPayload),
    scheduledSendTime: 0,
    chatMessageId: context.chatMessageId,
    recipientEmail: params.to,
    ccAddresses: params.cc.length > 0 ? params.cc : undefined,
    bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
    subject: params.subject,
    emailBody: params.body,
    fromHeader: context.fromHeader,
    replyTo: context.replyTo,
    inReplyTo: context.inReplyTo,
    references: context.references,
    renderedText: emailPayload.text,
    renderedHtml: emailPayload.html,
    attachments: params.attachments.length > 0 ? params.attachments : undefined,
    allowMultipleCoiAttachments: params.allowMultipleCoiAttachments,
    referencedPolicyIds: params.referencedPolicyIds,
    sendBlockedReason: params.sendBlockedReason,
    status: "draft",
  });
  const draftMessageId = await ctx.runMutation(
    internal.threads.insertEmailMessage,
    {
      threadId: context.threadId,
      orgId: context.orgId,
      role: "agent",
      fromEmail: context.agentAddress,
      fromName: getEmailAgentFromName(context.brokerBranding),
      content: params.body,
      toAddresses: [params.to],
      ccAddresses: params.cc.length > 0 ? params.cc : undefined,
      bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
      subject: params.subject,
      attachments:
        params.attachments.length > 0 ? params.attachments : undefined,
      referencedPolicyIds: params.referencedPolicyIds,
      status: "draft_email",
      pendingEmailId,
    },
  );
  await ctx.runMutation(internal.pendingEmails.setThreadMessage, {
    id: pendingEmailId,
    threadMessageId: draftMessageId,
  });
  if (context.chatMessageId) {
    await ctx.runMutation(internal.threads.attachPendingEmailToAgentMessage, {
      id: context.chatMessageId,
      pendingEmailId,
    });
  }

  return pendingEmailId;
}

export async function queueEmailDraftArtifact(
  ctx: ActionCtx,
  context: EmailDraftArtifactContext,
  params: EmailDraftArtifactParams & { scheduledSendTime: number },
): Promise<Id<"pendingEmails"> | undefined> {
  const pendingEmailId = await upsertEmailDraftArtifact(ctx, context, params);
  if (!pendingEmailId) return undefined;

  await ctx.runMutation(internal.pendingEmails.scheduleDraftInternal, {
    id: pendingEmailId,
    scheduledSendTime: params.scheduledSendTime,
  });
  return pendingEmailId;
}
