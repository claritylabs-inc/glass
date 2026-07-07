"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { stepCountIs } from "ai";
import { generateTextForOrg, generatedTextFromResult } from "../lib/models";
import {
  createImessageGroupChat,
  coordinateMailboxTask,
  webResearch,
} from "../lib/chatTools";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import {
  buildSystemPromptForContext,
  buildChannelInstructions,
  buildPolicyToolInstructions,
} from "../lib/aiUtils";
import { classifyPromptInjection, enforceInputLimits } from "../lib/security";
import type { Doc, Id } from "../_generated/dataModel";
import type { AgentScope } from "../lib/agentScope";
import { isImessageInboundEnabled } from "../lib/imessageConfig";
import { sendOutboundImessage } from "../lib/imessageOutbound";
import { getClientPortalUrl } from "../lib/domains";
import {
  anonymousParticipantLabel,
  buildImessageGroupMemberTitle,
  buildImessageRosterContext,
  normalizeImessageAddress,
  resolveImessageConversationScope,
  type ResolvedImessageParticipant,
} from "../lib/imessageGroupResolution";
import {
  buildEmailExpertTool,
  resolveEmailAgentIdentity,
} from "../lib/emailSubagent";
import { isBrokerDirectedEmailRequest } from "../lib/emailIntentGuards";
import { FATAL_ACTION_FAILED_MESSAGE } from "../lib/actionFailures";
import { buildEmailDraftTextSummary } from "../lib/emailDraftSummary";
import { runWebRetrieval, type WebRetrievalInput } from "../lib/webRetrieval";
import {
  buildImessageKnowledgeContext,
  buildImessageModelMessages,
  buildImessageRetrievalQuery,
  buildRecentImessageTextContext,
  isImessageStatusCue,
  type ImessageHistoryMessage,
} from "../lib/imessageAgentContext";
import {
  mintImessageAppCards,
  type ImessageAppCard,
} from "../lib/imessageAppCards";
import { runImessageDeterministicControls } from "../lib/imessageDeterministicControls";
import { postProcessImessageResponseText } from "../lib/imessageResponsePostProcessing";
import { collectToolAudit } from "../lib/agentToolAudit";
import { createImessageAgentRunState } from "../lib/imessageAgentRunState";
import {
  buildFallbackImessageChatGuid,
  buildImessageParticipantInputs,
  buildInboundImessageEventKey,
  normalizeInboundImessageSender,
  storeImessageAttachments,
} from "../lib/imessageIngress";

export { buildFallbackImessageChatGuid } from "../lib/imessageIngress";

type ImessageResponse = {
  response: string;
  attachments?: Array<{ url: string; filename: string; mimeType: string }>;
  appCards?: ImessageAppCard[];
  leaveGroup?: boolean;
  chatGuid?: string;
};

async function sendImmediateImessage(params: {
  toPhone: string;
  chatGuid?: string;
  message: string;
}): Promise<boolean> {
  return await sendOutboundImessage({
    toPhone: params.toPhone,
    chatGuid: params.chatGuid,
    message: params.message,
    logPrefix: "imessage",
  });
}

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
    attachments: v.optional(
      v.array(
        v.object({
          data: v.string(), // base64-encoded bytes
          mimeType: v.string(),
          name: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<ImessageResponse> => {
    if (!isImessageInboundEnabled()) {
      console.warn(
        "[imessage] Inbound message received while iMessage inbound is not enabled",
      );
      return { response: "" };
    }

    const fromPhone = normalizeInboundImessageSender(args.fromPhone);
    const senderAddress = normalizeImessageAddress(args.fromPhone);
    const isGroup = args.isGroup === true;
    const chatGuid =
      args.chatGuid?.trim() ||
      buildFallbackImessageChatGuid({
        fromPhone,
        isGroup,
        participants: args.participants,
      });
    const siteUrl = getClientPortalUrl();
    const eventKey = buildInboundImessageEventKey({
      fromPhone,
      chatGuid,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
      attachments: args.attachments,
    });

    const claim = await ctx.runMutation(internal.imessageInboundEvents.claim, {
      eventKey,
      fromPhone,
      chatGuid,
      isGroup,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
    });
    if (claim.duplicate) {
      console.log("[imessage] Duplicate inbound event ignored", {
        fromPhone,
        sourceMessageId: args.sourceMessageId,
        status: claim.status,
      });
      return { response: "" };
    }

    const finish = async (
      response: string,
      attachments?: ImessageResponse["attachments"],
      options?: { leaveGroup?: boolean; appCards?: ImessageAppCard[] },
    ) => {
      await ctx.runMutation(internal.imessageInboundEvents.complete, {
        eventKey,
        response,
      });
      return {
        response,
        attachments,
        appCards: options?.appCards,
        leaveGroup: options?.leaveGroup,
        chatGuid,
      };
    };

    try {
      if (isGroup && args.participantsUnavailable) {
        return await finish(
          "I couldn't confirm who is in this group chat yet. Please try again in a moment.",
        );
      }

      const participantInputs = buildImessageParticipantInputs({
        senderAddress,
        participants: args.participants,
      });

      const phones = [...participantInputs.keys()].filter(
        (address) => !address.includes("@"),
      );
      const linkedUsers = await ctx.runQuery(internal.users.findManyByPhones, {
        phones,
      }) as Array<Doc<"users"> | null>;
      const linkedUserRecords = linkedUsers.filter(
        (linkedUser): linkedUser is Doc<"users"> => Boolean(linkedUser),
      );
      const usersByPhone = new Map(
        linkedUserRecords
          .filter((linkedUser) => linkedUser.phone)
          .map((linkedUser) => [
            normalizeImessageAddress(linkedUser.phone!),
            linkedUser,
          ]),
      );
      const memberships = await ctx.runQuery(internal.orgs.getUserMemberships, {
        userIds: linkedUserRecords.map((linkedUser) => linkedUser._id),
      }) as Array<Doc<"orgMemberships"> | null>;
      const membershipByUserId = new Map(
        memberships
          .filter((membership): membership is Doc<"orgMemberships"> =>
            Boolean(membership),
          )
          .map((membership) => [String(membership.userId), membership]),
      );

      const resolvedParticipants: ResolvedImessageParticipant[] = [
        ...participantInputs.values(),
      ].map((participant) => {
        const linkedUser = usersByPhone.get(participant.address);
        const membership = linkedUser
          ? membershipByUserId.get(String(linkedUser._id))
          : undefined;
        const role: "linked" | "anonymous" =
          linkedUser && membership ? "linked" : "anonymous";
        return {
          address: participant.address,
          displayName: participant.displayName,
          userId: linkedUser?._id,
          userName: linkedUser?.name,
          userEmail: linkedUser?.email,
          orgId: membership?.orgId,
          role,
        };
      });

      const scope = resolveImessageConversationScope({
        senderAddress,
        participants: resolvedParticipants,
      });
      const groupMemberTitle = isGroup
        ? buildImessageGroupMemberTitle(resolvedParticipants)
        : undefined;

      await ctx.runMutation(internal.imessageChats.syncChat, {
        chatGuid,
        isGroup,
        primaryOrgId: scope.primaryOrgId,
        title: groupMemberTitle ?? args.chatTitle,
        participants: resolvedParticipants.map((participant) => ({
          address: participant.address,
          displayName: participant.displayName,
          userId: participant.userId,
          orgId: participant.orgId,
          role: participant.role,
        })),
      });

      if (scope.kind === "no_linked_users") {
        const demo = await ctx.runAction(
          internal.actions.publicDemoAgent.respond,
          {
            channel: "imessage",
            senderContact: fromPhone,
            messageText: args.messageText,
            sourceMessageId: args.sourceMessageId,
            chatGuid,
          },
        );
        if (isGroup) {
          await ctx.runMutation(internal.imessageChats.markLeft, { chatGuid });
        }
        return await finish(
          demo.text,
          undefined,
          { leaveGroup: isGroup },
        );
      }

      const orgId = scope.primaryOrgId;
      const user = linkedUsers.find(
        (candidate) => candidate?._id === scope.primaryUserId,
      );
      if (!user) {
        const demo = await ctx.runAction(
          internal.actions.publicDemoAgent.respond,
          {
            channel: "imessage",
            senderContact: fromPhone,
            messageText: args.messageText,
            sourceMessageId: args.sourceMessageId,
            chatGuid,
          },
        );
        return await finish(demo.text);
      }
      const currentParticipant = resolvedParticipants.find(
        (participant) =>
          normalizeImessageAddress(participant.address) === senderAddress,
      );
      const currentSenderIsLinked = Boolean(
        currentParticipant?.userId && currentParticipant.orgId,
      );

      const guardedText = enforceInputLimits(args.messageText);
      const injectionCheck = await classifyPromptInjection(ctx, guardedText, orgId);
      if (!injectionCheck.safe) {
        console.warn("[security] iMessage prompt injection blocked", {
          fromPhone,
        });
        return await finish("I can't process that request.");
      }

      const threadId = await ctx.runMutation(
        internal.threads.findOrCreateByImessageChat,
        {
          orgId,
          userId: user._id,
          chatGuid,
          isGroup,
          scope: scope.kind === "multi_org" ? "multi_org" : "single_org",
          title: groupMemberTitle ?? args.chatTitle,
          fallbackPhone: fromPhone.includes("@") ? undefined : fromPhone,
          userName: user.name,
        },
      );

      const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
      if (!org) return await finish("Unable to find your account.");
      const agentScope = (await ctx.runQuery(
        internal.lib.agentScope.resolveForAction,
        {
          orgId,
          userId: user._id,
          surface: "imessage",
          allowBrokerPortfolio:
            org.type === "broker" && scope.kind === "single_org",
        },
      )) as AgentScope;
      const readOrgIds = agentScope.mode === "broker_portfolio" ? agentScope.readOrgIds : scope.orgIds;
      const scopedOrgs = await Promise.all(
        readOrgIds.map((scopedOrgId) =>
          ctx.runQuery(internal.orgs.getInternal, { id: scopedOrgId }),
        ),
      ) as Array<Doc<"organizations"> | null>;
      const orgNamesById = Object.fromEntries(
        scopedOrgs
          .filter(Boolean)
          .map((scopedOrg) => [String(scopedOrg!._id), scopedOrg!.name]),
      );

      const userName = user.name?.split(/\s+/)[0];
      const emailIdentity = await resolveEmailAgentIdentity(ctx, org);

      const attachmentRecords = await storeImessageAttachments(
        ctx,
        args.attachments,
      );

      await ctx.runMutation(internal.threads.insertImessageMessage, {
        threadId,
        orgId,
        role: "user",
        userId: currentParticipant?.userId,
        userName:
          currentParticipant?.userName ??
          currentParticipant?.displayName ??
          anonymousParticipantLabel(senderAddress, 1),
        imessageSenderAddress: senderAddress,
        imessageParticipantLabel:
          currentParticipant?.userName ??
          currentParticipant?.displayName ??
          anonymousParticipantLabel(senderAddress, 1),
        content: args.messageText,
        messageId: args.sourceMessageId ?? eventKey,
        attachments:
          attachmentRecords.length > 0
            ? attachmentRecords.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
                fileId: a.fileId,
              }))
            : undefined,
      });

      const history = await ctx.runQuery(internal.threads.getImessageHistory, {
        threadId,
        limit: 16,
      }) as ImessageHistoryMessage[];
      const historyForContext = history.filter((msg) => {
        if (msg.status === "processing") return false;
        if (isImessageStatusCue(msg)) return false;
        return !(msg.role === "user" && msg.content === args.messageText);
      });
      const recentConversationContext =
        buildRecentImessageTextContext(historyForContext);
      const retrievalQuery = buildImessageRetrievalQuery({
        recentConversationContext,
        messageText: args.messageText,
      });

      const draftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId, orgId },
      ) as Array<Doc<"pendingEmails">>;
      const pendingEmails = await ctx.runQuery(
        internal.pendingEmails.findPendingByThread,
        { threadId },
      ) as Array<Doc<"pendingEmails">>;
      const latestCancelledEmail = await ctx.runQuery(
        internal.pendingEmails.findLatestCancelledByThread,
        { threadId, orgId },
      );
      const deterministicControlResult = await runImessageDeterministicControls(ctx, {
        messageText: args.messageText,
        orgId,
        orgName: org.name,
        userName: user.name,
        userEmail: user.email,
        threadId,
        eventKey,
        chatGuid,
        isGroup,
        scopeMode: agentScope.mode,
        currentSenderIsLinked,
        draftEmails,
        pendingEmails,
        latestCancelledEmail,
        recentConversationContext,
        history: historyForContext,
      });
      if (deterministicControlResult) {
        return await finish(
          deterministicControlResult.response,
          undefined,
          { leaveGroup: deterministicControlResult.leaveGroup },
        );
      }

      const {
        policyContext,
        memoryContext,
        orgMemoryBlock,
        requirementsBlock,
        relevantPolicyIds,
      } = await buildImessageKnowledgeContext(ctx, {
        orgId,
        readOrgIds,
        orgNamesById,
        retrievalQuery,
      });

      const currentSpeakerLabel =
        currentParticipant?.userName ??
        currentParticipant?.displayName ??
        anonymousParticipantLabel(senderAddress, 1);
      const modelMessages = await buildImessageModelMessages({
        history,
        messageText: args.messageText,
        currentSpeakerLabel,
        attachmentRecords,
      });

      const brokerIdentity = org.type === "client"
        ? await ctx.runQuery(internal.orgs.resolveBrokerIdentityInternal, {
            clientOrgId: orgId,
          })
        : null;

      const systemPrompt =
        buildSystemPromptForContext({
          org: {
            name: org.name,
            context: org.context,
            broker: brokerIdentity?.brokerCompanyName
              ? {
                  name: brokerIdentity.brokerCompanyName,
                  contactName: brokerIdentity.contactName,
                  contactEmail: brokerIdentity.contactEmail,
                  contactPhone: brokerIdentity.contactPhone,
                }
              : undefined,
          },
          mode: "direct",
          userName,
          siteUrl,
        }) +
        buildChannelInstructions({
          platform: "imessage",
          canSendEmail: emailIdentity.canSend,
          emailUnavailableReason: emailIdentity.reason,
          autoSendEmails: org.autoSendEmails === true,
        }) +
        "\n\n" +
        buildImessageRosterContext({
          senderAddress,
          participants: resolvedParticipants,
          orgNamesById,
          scopeKind: scope.kind,
        }) +
        "\n\n" +
        policyContext +
        buildPolicyToolInstructions(8) +
        memoryContext +
        orgMemoryBlock +
        requirementsBlock;

      const runState = createImessageAgentRunState({ relevantPolicyIds });
      const orgMembers = (await ctx.runQuery(
        internal.users.listByOrgInternal,
        { orgId },
      )) as Array<Doc<"users">>;
      const allowedRecipients = [
        ...new Set(
          [
            user.email,
            brokerIdentity?.contactEmail,
            ...orgMembers.map((member) => member.email),
          ]
            .filter(Boolean)
            .map((email) => String(email).toLowerCase()),
        ),
      ];
      const brokerDirectedEmailRequest = isBrokerDirectedEmailRequest(args.messageText);
      const brokerRecipientEmail = brokerDirectedEmailRequest
        ? brokerIdentity?.contactEmail
        : undefined;
      const brokerRecipientName = brokerDirectedEmailRequest
        ? brokerIdentity?.contactName ?? brokerIdentity?.brokerCompanyName
        : undefined;
      const availableEmailAttachments = attachmentRecords
        .filter(
          (att): att is typeof att & { fileId: Id<"_storage"> } => !!att.fileId,
        )
        .map((att) => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          fileId: att.fileId,
        }));
      const availableFileIds = new Set(
        availableEmailAttachments.map((attachment) => String(attachment.fileId)),
      );
      const imessageWritableOrgIds =
        agentScope.mode === "broker_portfolio"
          ? agentScope.writableOrgIds
          : currentParticipant?.orgId
            ? [currentParticipant.orgId]
            : [];

      const imessageTools = {
        ...buildAgentToolExecutors(ctx, {
          surface: "imessage",
          orgId,
          userId: user._id,
          scope: agentScope,
          readOrgIds,
          writableOrgIds: imessageWritableOrgIds,
          threadId,
          canWrite: currentSenderIsLinked,
          writeUnavailableMessage:
            "Only a linked Glass user in this chat can do that.",
          availableFileIds,
          onPolicyReferenced: runState.onPolicyReferenced,
          onResponseAttachment: runState.onResponseAttachment,
          onToolArtifact: runState.onToolArtifact,
        }),
        create_imessage_group_chat: {
          ...createImessageGroupChat,
          execute: async (params: {
            recipients: string[];
            openingMessage: string;
            title?: string;
            confirmed: boolean;
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user can start a new group chat.";
            }
            if (!params.confirmed) {
              return "Ask the user to confirm before creating a new iMessage group chat.";
            }
            return await ctx.runAction(
              internal.actions.createOutboundImessageGroup.createOutboundImessageGroupInternal,
              {
                orgId,
                userId: user._id,
                recipients: params.recipients,
                openingMessage: params.openingMessage,
                title: params.title,
              },
            );
          },
        },
        ...(currentSenderIsLinked
          ? {
              coordinate_mailbox_task: {
                ...coordinateMailboxTask,
                execute: async (params: { task: string }) =>
                  await ctx.runAction(internal.actions.mailboxCoordinator.runInternal, {
                    orgId,
                    userId: user._id,
                    task: params.task,
                    statusToPhone: fromPhone,
                    statusChatGuid: chatGuid,
                  }),
              },
              web_research: {
                ...webResearch,
                execute: async (params: WebRetrievalInput) => {
                  const result = await runWebRetrieval(ctx, orgId, params);
                  if (!result.text) {
                    return {
                      status: "unavailable",
                      attempts: result.attempts,
                      warnings: result.warnings,
                    };
                  }
                  return {
                    status: "ok",
                    provider: result.provider,
                    text: result.text,
                    sources: result.sources,
                    warnings: result.warnings,
                  };
                },
              },
            }
          : {}),
        ...(currentSenderIsLinked &&
        emailIdentity.canSend &&
        emailIdentity.agentAddress &&
        emailIdentity.fromHeader
          ? {
              email_expert: buildEmailExpertTool(ctx, {
                orgId,
                userId: user._id,
                threadId,
                channel: "imessage",
                fromHeader: emailIdentity.fromHeader,
                agentAddress: emailIdentity.agentAddress,
                brokerBranding: emailIdentity.brokerBranding,
                senderEmail: user.email,
                defaultTo: brokerDirectedEmailRequest ? brokerRecipientEmail : user.email,
                defaultRecipientName: brokerDirectedEmailRequest
                  ? brokerRecipientName
                  : user.name,
                requireKnownRecipient: brokerDirectedEmailRequest,
                missingRecipientMessage:
                  "No broker contact email is set for this organization. Add the broker contact in Settings, or send me the broker's email address first.",
                unknownRecipientMessage:
                  "I cannot use that broker recipient because it is not the configured broker contact in Glass. Add the broker contact in Settings, or send me the correct broker email address explicitly.",
                defaultBcc:
                  org.bccRequesterOnAgentEmails !== false && user.email
                    ? [user.email]
                    : undefined,
                allowedRecipients,
                availableAttachments: availableEmailAttachments,
                referencedPolicyIds: relevantPolicyIds,
                autoSendEmails: brokerDirectedEmailRequest
                  ? false
                  : org.autoSendEmails === true,
                emailSendDelay: org.emailSendDelay,
                conversationContext:
                  recentConversationContext +
                  (draftEmails.length > 0
                    ? `\n\nCURRENT EMAIL DRAFTS:\n${buildEmailDraftTextSummary(draftEmails, {
                        sampleSize: Math.min(3, draftEmails.length),
                        commands: "chat",
                      })}`
                    : ""),
                onResult: runState.setEmailResult,
              }),
            }
          : {}),
      };

      const result = await generateTextForOrg(ctx, orgId, "chat", {
        maxOutputTokens: 512,
        system: systemPrompt,
        messages: modelMessages,
        tools: imessageTools,
        stopWhen: stepCountIs(8),
      }, {
        taskKind: "query_reason",
      });

      const { usedTools, toolCalls, workflowOutcomes } = collectToolAudit(result);
      runState.appendWorkflowOutcomes(workflowOutcomes);
      const responseFileAttachments = runState.responseFileAttachments;
      const imessageToolArtifacts = runState.toolArtifacts;
      let responseText = generatedTextFromResult(result);
      let responseAlreadySent = false;
      let pendingEmailIdForResponse: Id<"pendingEmails"> | undefined;
      const emailResult = runState.getEmailResult();
      if (emailResult) {
        responseText = emailResult.responseBody;
        pendingEmailIdForResponse = emailResult.pendingEmailId;
        if (
          emailResult.status === "draft" ||
          emailResult.status === "needs_confirmation"
        ) {
          const draftsAfterEmailTool = await ctx.runQuery(
            internal.pendingEmails.listDraftsInternal,
            { threadId, orgId },
          ) as Array<Doc<"pendingEmails">>;
          if (draftsAfterEmailTool.length > 0) {
            pendingEmailIdForResponse =
              pendingEmailIdForResponse ?? draftsAfterEmailTool[0]._id;
            responseText = buildEmailDraftTextSummary(draftsAfterEmailTool, {
              sampleSize: Math.min(3, draftsAfterEmailTool.length),
              commands: "chat",
            });
          }
        }
        if (emailResult.status === "pending") {
          const sent = await sendImmediateImessage({
            toPhone: fromPhone,
            chatGuid,
            message: emailResult.responseBody,
          });
          if (sent) {
            responseAlreadySent = true;
            await ctx.runMutation(internal.threads.insertImessageMessage, {
              threadId,
              orgId,
              role: "agent",
              content: emailResult.responseBody,
              responseMessageId: `${eventKey}:pending-email`,
              pendingEmailId: emailResult.pendingEmailId,
              referencedPolicyIds:
                relevantPolicyIds.length > 0
                  ? relevantPolicyIds
                  : undefined,
              usedTools: usedTools.length > 0 ? usedTools : undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      }

      responseText = postProcessImessageResponseText({
        messageText: args.messageText,
        recentConversationContext,
        responseText,
        usedTools,
        responseFileAttachments,
        shouldStripGenericCta: !emailResult && !responseAlreadySent,
      });
      if (!responseText.trim() && !responseAlreadySent) {
        console.warn("[imessage] Model completed without response text", {
          fromPhone,
          orgId,
          threadId,
          usedTools,
          toolCallCount: toolCalls.length,
        });
        responseText =
          "I couldn't format that response. Please try again in a moment.";
      }

      const responseAttachments: Array<{
        url: string;
        filename: string;
        mimeType: string;
      }> = [];
      for (const fileAttachment of responseFileAttachments) {
        try {
          const url = await ctx.storage.getUrl(fileAttachment.storageId);
          if (url) {
            responseAttachments.push({
              url,
              filename: fileAttachment.filename,
              mimeType: "application/pdf",
            });
          }
        } catch (err) {
          console.warn("[imessage] Failed to get attachment URL:", err);
        }
      }

      const agentAttachments = responseFileAttachments.map((c) => ({
        filename: c.filename,
        contentType: "application/pdf",
        size: 0,
        fileId: c.storageId,
      }));
      let agentResponseMessageId: Id<"threadMessages"> | undefined;
      if (!responseAlreadySent && responseText.trim()) {
        agentResponseMessageId = await ctx.runMutation(internal.threads.insertImessageMessage, {
          threadId,
          orgId,
          role: "agent",
          content: responseText,
          responseMessageId: `${eventKey}:response`,
          referencedPolicyIds:
            relevantPolicyIds.length > 0
              ? relevantPolicyIds
              : undefined,
          pendingEmailId: pendingEmailIdForResponse,
          attachments:
            agentAttachments.length > 0 ? agentAttachments : undefined,
          usedTools: usedTools.length > 0 ? usedTools : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolArtifacts:
            imessageToolArtifacts.length > 0 ? imessageToolArtifacts : undefined,
        });
      }

      const appCards = await mintImessageAppCards(ctx, {
        orgId,
        threadId,
        sourceThreadMessageId: agentResponseMessageId,
        createdByUserId: user._id,
        messageText: args.messageText,
        responseText,
        relevantPolicyIds,
        artifacts: imessageToolArtifacts,
        usedTools,
      });

      return await finish(
        responseAlreadySent ? "" : responseText,
        responseAttachments.length > 0 ? responseAttachments : undefined,
        appCards.length > 0 ? { appCards } : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[imessage] Agent processing error:", message);
      return await finish(FATAL_ACTION_FAILED_MESSAGE);
    }
  },
});
