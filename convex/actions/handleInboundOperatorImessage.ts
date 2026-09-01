"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  buildInboundImessageEventKey,
  isImessageAudioAttachment,
  normalizeInboundImessageSender,
  storeImessageAttachments,
} from "../lib/imessageIngress";
import { normalizeAgentAttachmentFilename } from "../lib/agentAttachmentLimits";
import { isOperatorImessageInboundEnabled } from "../lib/imessageConfig";
import {
  handleOperatorChannelConfirmation,
  waitForOperatorAgentRun,
} from "../lib/operatorAgentChannel";
import { cleanAgentMarkdownForTransport } from "../lib/transportRenderers";

const internalApi = internal as any;

const attachmentValidator = v.object({
  data: v.string(),
  mimeType: v.string(),
  name: v.string(),
});

export const processInbound = internalAction({
  args: {
    fromPhone: v.string(),
    messageText: v.string(),
    chatGuid: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    chatTitle: v.optional(v.string()),
    participantsUnavailable: v.optional(v.boolean()),
    participants: v.optional(
      v.array(
        v.object({
          address: v.string(),
          displayName: v.optional(v.string()),
        }),
      ),
    ),
    sourceMessageId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    recoveryFailure: v.optional(
      v.object({
        stage: v.union(
          v.literal("raw_message"),
          v.literal("attachment_download"),
        ),
        error: v.string(),
      }),
    ),
    attachments: v.optional(v.array(attachmentValidator)),
  },
  handler: async (ctx, args) => {
    if (!isOperatorImessageInboundEnabled()) {
      throw new Error("Operator iMessage inbound is not configured");
    }
    if (args.isGroup) {
      throw new Error("Operator iMessage supports direct conversations only");
    }
    const identity = await ctx.runQuery(
      internalApi.operatorImessage.resolveIdentity,
      { fromPhone: args.fromPhone },
    );
    if (!identity) {
      throw new Error("Operator iMessage sender is not authorized");
    }
    const fromPhone = normalizeInboundImessageSender(identity.phone);
    const chatGuid = args.chatGuid?.trim() || fromPhone;
    const requestedFilenames = (args.attachments ?? []).map((attachment) =>
      normalizeAgentAttachmentFilename(attachment.name),
    );
    if ((args.attachments ?? []).some(isImessageAudioAttachment)) {
      throw new Error(
        "Operator iMessage voice memos are not supported; send text or a supported document or image instead",
      );
    }
    const preliminaryContent =
      args.messageText.trim() ||
      (requestedFilenames.length > 0
        ? `[Attached ${requestedFilenames.join(", ")}]`
        : "Please help with this.");
    const threadId = await ctx.runMutation(
      internalApi.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: identity.operatorUserId,
        channel: "imessage",
        conversationKey: `${fromPhone}:${chatGuid}`,
        title: args.chatTitle?.trim() || `iMessage · ${identity.displayName}`,
      },
    );
    const confirmation = await handleOperatorChannelConfirmation(ctx, {
      operatorUserId: identity.operatorUserId,
      threadId,
      channel: "imessage",
      content: preliminaryContent,
    });
    if (confirmation) {
      return {
        response: cleanAgentMarkdownForTransport(confirmation.content ?? ""),
        sendContactCard: false,
      };
    }
    const eventKey = buildInboundImessageEventKey({
      fromPhone,
      chatGuid,
      messageText: args.messageText.trim(),
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
      attachments: args.attachments,
    });
    const storedAttachments = await storeImessageAttachments(
      ctx,
      args.attachments,
    );
    const filenames = storedAttachments.map(({ filename }) => filename);
    const content =
      args.messageText.trim() ||
      (filenames.length > 0
        ? `[Attached ${filenames.join(", ")}]`
        : "Please help with this.");
    const storedFileIds = storedAttachments.flatMap((attachment) =>
      attachment.fileId ? [attachment.fileId] : [],
    );
    let queued;
    try {
      queued = await ctx.runMutation(
        internalApi.operatorAgent.enqueueMessageInternal,
        {
          operatorUserId: identity.operatorUserId,
          threadId,
          channel: "imessage",
          content,
          dedupeKey: `operator-imessage:${eventKey}`,
          attachments: storedAttachments.flatMap((attachment) =>
            attachment.fileId
              ? [
                  {
                    fileId: attachment.fileId,
                    filename: attachment.filename,
                    contentType: attachment.contentType,
                    size: attachment.size,
                  },
                ]
              : [],
          ),
        },
      );
    } catch (error) {
      await ctx.runMutation(
        internalApi.operatorAgent.deleteUnreferencedAttachmentsInternal,
        { fileIds: storedFileIds },
      );
      throw error;
    }
    if (queued.duplicate && storedFileIds.length > 0) {
      await ctx.runMutation(
        internalApi.operatorAgent.deleteUnreferencedAttachmentsInternal,
        { fileIds: storedFileIds },
      );
    }
    const result = await waitForOperatorAgentRun(
      ctx,
      identity.operatorUserId,
      queued.runId,
    );
    const response = result.response;
    const attachments = await Promise.all(
      (response?.attachments ?? [])
        .flatMap(
          (attachment: {
            fileId?: Id<"_storage">;
            filename: string;
            contentType: string;
          }) => (attachment.fileId ? [attachment] : []),
        )
        .map(
          async (attachment: {
            fileId: Id<"_storage">;
            filename: string;
            contentType: string;
          }) => ({
            url: await ctx.storage.getUrl(attachment.fileId),
            filename: attachment.filename,
            mimeType: attachment.contentType,
          }),
        ),
    );
    const attachmentFailures = attachments.flatMap((attachment) =>
      attachment.url
        ? []
        : [
            {
              filename: attachment.filename,
              error: "Storage URL was unavailable.",
            },
          ],
    );
    if (attachmentFailures.length > 0 && response?.messageId) {
      await ctx.runMutation(
        internalApi.operatorAgent
          .recordImessageAttachmentDeliveryFailureInternal,
        {
          operatorMessageId: response.messageId,
          stage: "url_resolution",
          failures: attachmentFailures,
        },
      );
    }
    const responseText = cleanAgentMarkdownForTransport(
      response?.content ?? "",
    );
    return {
      response:
        attachmentFailures.length > 0
          ? `${responseText.trim()}\n\nOne or more attachments could not be delivered.`.trim()
          : responseText,
      attachments: attachments.flatMap((attachment) =>
        attachment.url ? [{ ...attachment, url: attachment.url }] : [],
      ),
      threadMessageId: response?.messageId
        ? String(response.messageId)
        : undefined,
      sendContactCard: false,
    };
  },
});
