"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";
import { haikuModel } from "../lib/ai";
import {
  lookupPolicy,
  lookupPolicySection,
  compareCoverages,
  lookupComplianceRequirements,
  saveNote,
  attachPolicyDocument,
  confirmPolicyFact,
  generateCoi as generateCoiTool,
  createPolicyChangeRequest,
  addPolicyChangeInfo,
  draftPolicyChangeSubmission,
  completePolicyChangeFromEndorsement,
  createImessageGroupChat,
  coordinateMailboxTask,
  webResearch,
} from "../lib/chatTools";
import {
  buildComplianceRequirementsContext,
  buildDocumentContext,
  buildConversationMemoryContext,
  buildIntelligenceContext,
} from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildChannelInstructions,
  buildPolicyToolInstructions,
  policySearchScore,
} from "../lib/aiUtils";
import { searchPolicyDocumentWithSourceSpans } from "../lib/policyLookup";
import { tryBuildDoclingPdfText } from "../lib/doclingPreprocessor";
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
  type EmailSubagentResult,
} from "../lib/emailSubagent";
import { isBrokerDirectedEmailRequest } from "../lib/emailIntentGuards";
import {
  COI_GENERATION_FAILED_MESSAGE,
  FATAL_ACTION_FAILED_MESSAGE,
} from "../lib/actionFailures";
import {
  buildCertificateProgramSelection,
  formatCertificateProgramSelectionForModel,
  formatCertificateProgramSelectionForUser,
  normalizeSelectedPartnerProgramId,
  type CertificateProgramSelection,
} from "../lib/certificateProgramSelection";
import { resolvePolicyReferenceForOrg } from "../lib/policyToolResolution";
import { evaluatePceIntake, type PceRequestKind } from "../lib/pceIntake";
import {
  filterComplianceRequirements,
  formatComplianceRequirement,
} from "../lib/complianceAgent";
import { buildVendorComplianceTools } from "../lib/vendorComplianceTools";
import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelConfirmationPrompt,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
  pendingEmailCancelConfirmationMessage,
} from "../lib/emailCancelIntent";
import {
  buildEmailDraftTextSummary,
  isSendAllEmailDraftsIntent,
  isShowMoreEmailDraftIntent,
} from "../lib/emailDraftSummary";
import { runWebRetrieval, type WebRetrievalInput } from "../lib/webRetrieval";

/** Normalize a raw phone string to E.164 (+1XXXXXXXXXX). */
function normalizePhone(raw: string): string {
  if (raw.includes("@")) return raw.trim().toLowerCase();
  const cleaned = raw.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

export function buildFallbackImessageChatGuid(args: {
  fromPhone: string;
  isGroup: boolean;
  participants?: Array<{ address: string }>;
}): string {
  if (!args.isGroup) return args.fromPhone;
  const participantAddresses = new Set<string>();
  participantAddresses.add(normalizeImessageAddress(args.fromPhone));
  for (const participant of args.participants ?? []) {
    const address = normalizeImessageAddress(participant.address);
    if (address) participantAddresses.add(address);
  }
  const rosterKey =
    [...participantAddresses].sort().join("|") || args.fromPhone;
  const rosterHash = createHash("sha256")
    .update(rosterKey)
    .digest("hex")
    .slice(0, 24);
  return `group:${rosterHash}`;
}

function buildInboundEventKey(args: {
  fromPhone: string;
  chatGuid?: string;
  messageText: string;
  sourceMessageId?: string;
  receivedAt?: number;
  attachments?: Array<{ mimeType: string; name: string; data: string }>;
}): string {
  const hash = createHash("sha256");
  const scope = args.chatGuid ?? args.fromPhone;
  if (args.sourceMessageId) {
    hash.update(`source:${scope}:${args.sourceMessageId}`);
  } else {
    const minuteBucket = Math.floor((args.receivedAt ?? Date.now()) / 60000);
    hash.update(
      `fallback:${scope}:${args.fromPhone}:${minuteBucket}:${args.messageText}`,
    );
    for (const attachment of args.attachments ?? []) {
      hash.update(
        `:${attachment.name}:${attachment.mimeType}:${attachment.data.length}`,
      );
    }
  }
  return hash.digest("hex");
}

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

/** Response shape returned to the HTTP route (and hence to the worker). */
type ImessageResponse = {
  response: string;
  attachments?: Array<{ url: string; filename: string; mimeType: string }>;
  leaveGroup?: boolean;
  chatGuid?: string;
};

function cleanJsonText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

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

async function generateImessageStatusCue(params: {
  messageText: string;
  hasAttachments: boolean;
  userName?: string;
  recentContext?: string;
}): Promise<string | null> {
  try {
    const result = await generateText({
      model: haikuModel,
      maxOutputTokens: 120,
      system: `You decide whether an insurance SMS assistant should send a quick status cue before doing retrieval or tool work.
Return strict JSON only: {"send": boolean, "message": string | null}.

Use recent conversation context to resolve short follow-ups like "yes", "that", "it", or "what about this".
Send only when the user's latest text is a substantive insurance question, document/attachment request, COI request, comparison, lookup, or task likely to require checking policy data/tools.
Do not send for greetings, thanks, acknowledgements, corrections, jokes, spam, or messages that can be answered immediately without checking anything.

If sending, write one warm, natural SMS sentence under 70 characters. Use casual texting language.
Avoid formal punctuation: no em dashes, semicolons, colons, or parentheses.
Do not use stiff phrases like "policy details on that for you".
No markdown, no emoji, no greeting, no sign-off.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            userName: params.userName ?? null,
            messageText: params.messageText,
            hasAttachments: params.hasAttachments,
            recentContext: params.recentContext ?? null,
          }),
        },
      ],
    });

    const parsed = JSON.parse(cleanJsonText(result.text)) as {
      send?: unknown;
      message?: unknown;
    };
    if (parsed.send !== true || typeof parsed.message !== "string") return null;
    const message = parsed.message.trim().replace(/\s+/g, " ");
    if (message.length === 0 || message.length > 90) return null;
    return message;
  } catch (err) {
    console.warn("[imessage] Status cue generation failed:", err);
    return null;
  }
}

function isImessageStatusCue(message: { responseMessageId?: string }): boolean {
  return message.responseMessageId?.endsWith(":status") === true;
}

function buildRecentTextContext(
  messages: Array<{
    role: string;
    content: string;
    status?: string;
    userName?: string;
    responseMessageId?: string;
  }>,
): string {
  return messages
    .filter((msg) => msg.status !== "processing")
    .filter((msg) => !isImessageStatusCue(msg))
    .slice(-8)
    .map((msg) => {
      const speaker = msg.role === "user" ? (msg.userName ?? "User") : "Glass";
      return `${speaker}: ${msg.content}`;
    })
    .join("\n");
}

export function shouldSkipImessageStatusCueForEmailApproval(params: {
  messageText: string;
  recentContext?: string;
}): boolean {
  const recentContext = params.recentContext ?? "";
  if (
    !/Ready to send\?/i.test(recentContext) &&
    !/\bDraft email\b/i.test(recentContext)
  ) {
    return false;
  }

  const normalized = params.messageText
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;

  if (/\b(no|not|don t|dont|hold|wait|cancel|stop)\b/.test(normalized)) {
    return false;
  }

  return /\b(yes|yep|yeah|ok|okay|good|approved|approve|send|go ahead)\b/.test(
    normalized,
  );
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

    const fromPhone = normalizePhone(args.fromPhone);
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
    const eventKey = buildInboundEventKey({
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
      options?: { leaveGroup?: boolean },
    ) => {
      await ctx.runMutation(internal.imessageInboundEvents.complete, {
        eventKey,
        response,
      });
      return {
        response,
        attachments,
        leaveGroup: options?.leaveGroup,
        chatGuid,
      };
    };

    try {
      // ── 1. Resolve group participants and org scope ───────────────────────
      if (isGroup && args.participantsUnavailable) {
        return await finish(
          "I couldn't confirm who is in this group chat yet. Please try again in a moment.",
        );
      }

      const participantInputs = new Map<
        string,
        { address: string; displayName?: string }
      >();
      for (const participant of args.participants ?? []) {
        const address = normalizeImessageAddress(participant.address);
        if (address)
          participantInputs.set(address, {
            address,
            displayName: participant.displayName,
          });
      }
      if (!participantInputs.has(senderAddress)) {
        participantInputs.set(senderAddress, { address: senderAddress });
      }

      const phones = [...participantInputs.keys()].filter(
        (address) => !address.includes("@"),
      );
      const linkedUsers = await ctx.runQuery(internal.users.findManyByPhones, {
        phones,
      }) as Array<Doc<"users"> | null>;
      const usersByPhone = new Map(
        linkedUsers
          .filter((user) => user?.phone)
          .map((user) => [normalizeImessageAddress(user!.phone!), user!]),
      );
      const memberships = await ctx.runQuery(internal.orgs.getUserMemberships, {
        userIds: linkedUsers.map((user) => user!._id),
      }) as Array<Doc<"orgMemberships"> | null>;
      const membershipByUserId = new Map(
        memberships.map((membership) => [
          String(membership!.userId),
          membership!,
        ]),
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
        await ctx.runMutation(internal.imessageChats.markLeft, { chatGuid });
        return await finish(
          `Sign up to use Glass: ${siteUrl}/signup/client`,
          undefined,
          { leaveGroup: isGroup },
        );
      }

      const orgId = scope.primaryOrgId;
      const user = linkedUsers.find(
        (candidate) => candidate?._id === scope.primaryUserId,
      );
      if (!user)
        return await finish(`Sign up to use Glass: ${siteUrl}/signup/client`);
      const currentParticipant = resolvedParticipants.find(
        (participant) =>
          normalizeImessageAddress(participant.address) === senderAddress,
      );
      const currentSenderIsLinked = Boolean(
        currentParticipant?.userId && currentParticipant.orgId,
      );

      // ── 3. Prompt injection guard ─────────────────────────────────────────
      const guardedText = enforceInputLimits(args.messageText);
      const injectionCheck = await classifyPromptInjection(guardedText);
      if (!injectionCheck.safe) {
        console.warn("[security] iMessage prompt injection blocked", {
          fromPhone,
        });
        return await finish("I can't process that request.");
      }

      // ── 4. Thread routing ─────────────────────────────────────────────────
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

      // ── 5. Fetch org context ──────────────────────────────────────────────
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
      if (!org) return await finish("Unable to find your account.");
      const agentScope = (await ctx.runQuery((internal as any).lib.agentScope.resolveForAction, {
        orgId,
        userId: user._id,
        surface: "imessage",
        allowBrokerPortfolio: org.type === "broker" && scope.kind === "single_org",
      })) as AgentScope;
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

      // ── 6. Store attachments in Convex file storage ───────────────────────
      type AttachmentRecord = {
        filename: string;
        contentType: string;
        size: number;
        fileId?: Id<"_storage">;
        buffer?: Buffer;
      };
      const attachmentRecords: AttachmentRecord[] = [];
      for (const att of args.attachments ?? []) {
        if (!SUPPORTED_MIME_TYPES.has(att.mimeType)) continue;
        try {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([new Uint8Array(buffer)], {
            type: att.mimeType,
          });
          const fileId = await ctx.storage.store(blob);
          attachmentRecords.push({
            filename: att.name,
            contentType: att.mimeType,
            size: buffer.byteLength,
            fileId,
            buffer,
          });
        } catch (err) {
          console.warn(
            `[imessage] Failed to store attachment ${att.name}:`,
            err,
          );
        }
      }

      // ── 7. Persist inbound user message ──────────────────────────────────
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

      // ── 8. Build recent thread context ────────────────────────────────────
      const history = await ctx.runQuery(internal.threads.getImessageHistory, {
        threadId,
        limit: 16,
      }) as Array<{
        status?: string;
        role: string;
        content: string;
        userName?: string;
        responseMessageId?: string;
        toolArtifacts?: Array<{ type: string; data: unknown }>;
      }>;
      const historyForContext = history.filter((msg) => {
        if (msg.status === "processing") return false;
        if (isImessageStatusCue(msg)) return false;
        return !(msg.role === "user" && msg.content === args.messageText);
      });
      const recentConversationContext =
        buildRecentTextContext(historyForContext);
      const retrievalQuery = [
        recentConversationContext,
        `User: ${args.messageText}`,
      ]
        .filter((part) => part.trim().length > 0)
        .join("\n");

      const draftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId, orgId },
      ) as Array<Doc<"pendingEmails">>;
      const pendingEmails = await ctx.runQuery(
        internal.pendingEmails.findPendingByThread,
        { threadId },
      ) as Array<{ _id: Id<"pendingEmails"> }>;
      const latestCancelledEmail = await ctx.runQuery(
        internal.pendingEmails.findLatestCancelledByThread,
        { threadId, orgId },
      );
      const isCancelConfirmationContext = isPendingEmailCancelConfirmationPrompt(
        recentConversationContext,
      );
      const shortText = args.messageText.trim().length < 100;
      const replyWithEmailCancelStatus = async (response: string) => {
        await ctx.runMutation(internal.threads.insertImessageMessage, {
          threadId,
          orgId,
          role: "agent",
          content: response,
          responseMessageId: `${eventKey}:response`,
        });
        return await finish(response);
      };

      if (
        latestCancelledEmail &&
        shortText &&
        isPendingEmailRestoreIntent(args.messageText)
      ) {
        const restored = await ctx.runMutation(
          internal.pendingEmails.restoreAsDraftInternal,
          { id: latestCancelledEmail._id },
        );
        return await replyWithEmailCancelStatus(
          restored
            ? "Email restored as a draft."
            : "I couldn't restore that email.",
        );
      }

      if (
        draftEmails.length > 0 &&
        shortText &&
        isCancelConfirmationContext &&
        isPendingEmailCancelConfirmation(args.messageText)
      ) {
        let cancelledCount = 0;
        for (const draftEmail of draftEmails) {
          const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
            id: draftEmail._id,
          });
          if (ok) cancelledCount++;
        }
        return await replyWithEmailCancelStatus(
          cancelledCount === 1
            ? "Email cancelled."
            : `${cancelledCount} draft emails cancelled.`,
        );
      }

      if (draftEmails.length > 0 && shortText && isPendingEmailCancelIntent(args.messageText)) {
        return await replyWithEmailCancelStatus(
          pendingEmailCancelConfirmationMessage("draft", draftEmails.length),
        );
      }

      if (
        draftEmails.length > 0 &&
        shortText &&
        isShowMoreEmailDraftIntent(args.messageText)
      ) {
        return await replyWithEmailCancelStatus(
          buildEmailDraftTextSummary(draftEmails, {
            sampleSize: draftEmails.length,
            commands: "chat",
          }),
        );
      }

      if (
        draftEmails.length > 0 &&
        shortText &&
        isSendAllEmailDraftsIntent(args.messageText)
      ) {
        let sentCount = 0;
        try {
          for (const draftEmail of draftEmails) {
            await ctx.runAction(
              internal.actions.sendPendingEmail.sendDraftInternal,
              { id: draftEmail._id },
            );
            sentCount++;
          }
          return await replyWithEmailCancelStatus(
            sentCount === 1
              ? "Sent the draft email."
              : `Sent ${sentCount} draft emails.`,
          );
        } catch (err) {
          return await replyWithEmailCancelStatus(
            err instanceof Error
              ? `I couldn't send all drafts: ${err.message}`
              : "I couldn't send all drafts.",
          );
        }
      }

      if (
        pendingEmails.length > 0 &&
        shortText &&
        isCancelConfirmationContext &&
        isPendingEmailCancelConfirmation(args.messageText)
      ) {
        let cancelledCount = 0;
        for (const pendingEmail of pendingEmails) {
          const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
            id: pendingEmail._id,
          });
          if (ok) cancelledCount++;
        }
        return await replyWithEmailCancelStatus(
          cancelledCount === 1
            ? "Email cancelled."
            : `${cancelledCount} pending emails cancelled.`,
        );
      }

      if (
        pendingEmails.length > 0 &&
        shortText &&
        isPendingEmailCancelIntent(args.messageText)
      ) {
        return await replyWithEmailCancelStatus(
          pendingEmailCancelConfirmationMessage("pending", pendingEmails.length),
        );
      }

      // Send a model-decided status cue before heavier retrieval/tool work so SMS
      // users get immediate feedback when the agent needs to check policy data.
      const statusCue = shouldSkipImessageStatusCueForEmailApproval({
        messageText: args.messageText,
        recentContext: recentConversationContext || undefined,
      })
        ? null
        : await generateImessageStatusCue({
            messageText: args.messageText,
            hasAttachments: attachmentRecords.length > 0,
            userName,
            recentContext: recentConversationContext || undefined,
          });
      if (statusCue) {
        const sent = await sendImmediateImessage({
          toPhone: fromPhone,
          chatGuid,
          message: statusCue,
        });
        if (sent) {
          await ctx.runMutation(internal.threads.insertImessageMessage, {
            threadId,
            orgId,
            role: "agent",
            content: statusCue,
            responseMessageId: `${eventKey}:status`,
          });
        }
      }

      // ── 9. Build retrieval context ────────────────────────────────────────
      const scopedPolicySets = await Promise.all(
        readOrgIds.map(async (scopedOrgId) => ({
          orgId: scopedOrgId,
          policies: await ctx.runQuery(internal.policies.listAllInternal, {
            orgId: scopedOrgId,
          }),
        })),
      );
      const policies = scopedPolicySets.flatMap((entry) => entry.policies);
      const policyContextParts: string[] = [];
      const relevantPolicyIds: Id<"policies">[] = [];
      for (const entry of scopedPolicySets) {
        const built = await buildDocumentContext(
          ctx,
          entry.orgId,
          entry.policies,
          [],
          retrievalQuery,
        );
        if (built.context.trim().length > 0) {
          const orgName =
            orgNamesById[String(entry.orgId)] ?? "Linked organization";
          policyContextParts.push(
            `\n\nPOLICY CONTEXT FOR ${orgName}\n${built.context}`,
          );
        }
        relevantPolicyIds.push(
          ...(built.relevantPolicyIds as Id<"policies">[]),
        );
      }
      const policyContext = policyContextParts.join("");
      const memoryContext = await buildConversationMemoryContext(
        ctx,
        orgId,
        retrievalQuery,
      );
      const orgMemoryBlocks = await Promise.all(
        readOrgIds.map(async (scopedOrgId) => {
          const orgName =
            orgNamesById[String(scopedOrgId)] ?? "Linked organization";
          const block = await buildIntelligenceContext(
            ctx,
            scopedOrgId,
            retrievalQuery,
            relevantPolicyIds.map(String),
          );
          return block.trim().length > 0
            ? `\n\nORG MEMORY FOR ${orgName}\n${block}`
            : "";
        }),
      );
      const orgMemoryBlock = orgMemoryBlocks.join("");
      const requirementBlocks = await Promise.all(
        readOrgIds.map(async (scopedOrgId) => {
          const orgName =
            orgNamesById[String(scopedOrgId)] ?? "Linked organization";
          const block = await buildComplianceRequirementsContext(
            ctx,
            scopedOrgId,
          );
          return block.trim().length > 0
            ? `\n\nCOMPLIANCE REQUIREMENTS FOR ${orgName}\n${block}`
            : "";
        }),
      );
      const requirementsBlock = requirementBlocks.join("");

      // ── 10. Build message history from thread ─────────────────────────────
      const modelMessages: ModelMessage[] = [];
      for (const msg of history) {
        if (msg.status === "processing") continue;
        // Skip the message we just inserted (the inbound one)
        if (msg.role === "user" && msg.content === args.messageText) continue;
        // Status cues are sent for responsiveness and should not steer the final answer.
        if (isImessageStatusCue(msg)) continue;
        if (msg.role === "user") {
          modelMessages.push({
            role: "user",
            content: msg.userName
              ? `[${msg.userName}]: ${msg.content}`
              : msg.content,
          });
        } else if (msg.role === "agent" && msg.content) {
          const pendingSelections = Array.isArray(msg.toolArtifacts)
            ? msg.toolArtifacts
                .filter(
                  (artifact) =>
                    artifact.type === "certificate_program_selection",
                )
                .map((artifact) => artifact.data)
            : [];
          const selectionContext = pendingSelections
            .map((selection) =>
              formatCertificateProgramSelectionForModel(
                selection as CertificateProgramSelection,
              ),
            )
            .join("\n\n");
          modelMessages.push({
            role: "assistant",
            content: selectionContext
              ? `${msg.content}\n\n${selectionContext}`
              : msg.content,
          });
        }
      }
      // Append current message
      const currentSpeakerLabel =
        currentParticipant?.userName ??
        currentParticipant?.displayName ??
        anonymousParticipantLabel(senderAddress, 1);
      modelMessages.push({
        role: "user",
        content: `[${currentSpeakerLabel}]: ${args.messageText}`,
      });

      // ── 11. Attach PDF/image content for model context ────────────────────
      if (attachmentRecords.length > 0) {
        const lastMsg = modelMessages[modelMessages.length - 1];
        if (lastMsg.role === "user" && typeof lastMsg.content === "string") {
          type ContentPart =
            | { type: "text"; text: string }
            | { type: "file"; data: string; mediaType: string }
            | { type: "image"; image: string; mediaType: string };
          const parts: ContentPart[] = [];
          for (const att of attachmentRecords) {
            if (!att.buffer) continue;
            if (att.contentType === "application/pdf") {
              const doclingText = await tryBuildDoclingPdfText({
                pdfBytes: att.buffer,
                documentId: att.filename,
                sourceKind: "attachment",
                timeoutMs: 20_000,
              });
              if (doclingText) {
                parts.push({
                  type: "text",
                  text: `--- PDF attachment: ${att.filename} (Docling text) ---\n${doclingText}\n--- End PDF attachment ---`,
                });
              } else {
                parts.push({
                  type: "file",
                  data: att.buffer.toString("base64"),
                  mediaType: "application/pdf",
                });
              }
            } else if (att.contentType.startsWith("image/")) {
              parts.push({
                type: "image",
                image: att.buffer.toString("base64"),
                mediaType: att.contentType,
              });
            }
          }
          if (parts.length > 0) {
            parts.push({ type: "text", text: lastMsg.content });
            modelMessages[modelMessages.length - 1] = {
              role: "user",
              content: parts,
            };
          }
        }
      }

      // ── 12. Build system prompt ───────────────────────────────────────────
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
            coiHandling: org.coiHandling,
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

      // ── 13. Wire up tools ─────────────────────────────────────────────────
      const responseFileAttachments: Array<{
        storageId: Id<"_storage">;
        filename: string;
      }> = [];
      const certificateProgramSelectionArtifacts: CertificateProgramSelection[] = [];
      const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, {
        orgId,
      });
      const allowedRecipients = [
        ...new Set(
          [
            user.email,
            brokerIdentity?.contactEmail,
            ...orgMembers.map((member: any) => member?.email),
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
      const emailToolResult: { current: EmailSubagentResult | null } = {
        current: null,
      };

      const imessageTools = {
        lookup_policy: {
          ...lookupPolicy,
          execute: async (params: {
            query: string;
            policyType?: string;
            carrier?: string;
          }) => {
            const scored = (policies as any[])
              .map((p) => ({
                policy: p,
                score: policySearchScore(
                  p,
                  params.query,
                  params.policyType,
                  params.carrier,
                ),
              }))
              .filter((p) => p.score > 0)
              .sort((a, b) => b.score - a.score);
            const matches =
              scored.length > 0
                ? scored.map((s) => s.policy)
                : (policies as any[]).slice(0, 5);
            if (matches.length === 0) return "No policies found.";
            return matches.slice(0, 5).map((p: any) => ({
              id: p._id,
              client: orgNamesById[String(p.orgId)] ?? p.orgId,
              orgId: p.orgId,
              insured: p.insuredName,
              carrier: p.security,
              type: p.policyTypes?.join(", "),
              number: p.policyNumber,
              effective: p.effectiveDate,
              expiration: p.expirationDate,
              premium: p.premium,
              coverages: (p.coverages ?? []).map((c: any) => ({
                name: c.name,
                limit: c.limit,
                deductible: c.deductible,
              })),
            }));
          },
        },
        lookup_policy_section: {
          ...lookupPolicySection,
          execute: async (params: { policyId: string; query: string }) => {
            const policy: any = await ctx.runQuery(
              internal.policies.getInternal,
              {
                id: params.policyId as Id<"policies">,
              },
            );
            if (
              !policy ||
              !readOrgIds.map(String).includes(String(policy.orgId))
            )
              return "Policy not found.";
            return searchPolicyDocumentWithSourceSpans(
              ctx,
              policy,
              params.query,
              8,
            );
          },
        },
        create_policy_change_request: {
          ...createPolicyChangeRequest,
          execute: async (params: {
            requestKind?: PceRequestKind;
            requestText: string;
            policyId?: string;
            evidenceSourceIds?: string[];
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user in this group can create a policy change request.";
            }
            const intake = evaluatePceIntake({
              requestKind: params.requestKind,
              requestText: params.requestText,
            });
            if (!intake.allowed) return intake.message;
            if (scope.kind === "multi_org" && !params.policyId) {
              return "Please specify which organization's policy this change request is for.";
            }
            if (params.policyId) {
              const policy: any = await ctx.runQuery(
                internal.policies.getInternal,
                {
                  id: params.policyId as Id<"policies">,
                },
              );
              if (!policy || String(policy.orgId) !== String(orgId)) {
                return "Please have a linked user from that policy's organization create this change request.";
              }
            }
            const result = await ctx.runAction(
              internal.actions.policyChangeRequests.createFromChatForThread,
              {
                orgId,
                userId: user._id,
                policyId: params.policyId as Id<"policies"> | undefined,
                requestText: params.requestText,
                evidenceSourceIds: params.evidenceSourceIds,
              },
            );
            if (result?.error) return result.error;
            return {
              status: "created",
              caseId: result?.caseId,
              requestKind: intake.kind,
              usedSdkPce: Boolean(result?.usedSdkPce),
            };
          },
        },
        add_policy_change_info: {
          ...addPolicyChangeInfo,
          execute: async (params: {
            caseId: string;
            infoText: string;
            sourceSpanIds?: string[];
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user in this group can update a policy change request.";
            }
            await ctx.runMutation(internal.policyChanges.addInfo, {
              caseId: params.caseId as Id<"policyChangeCases">,
              userId: user._id,
              infoText: params.infoText,
              sourceSpanIds: params.sourceSpanIds,
            });
            return { status: "updated", caseId: params.caseId };
          },
        },
        draft_policy_change_email: {
          ...draftPolicyChangeSubmission,
          execute: async (params: {
            caseId: string;
            recipientEmail?: string;
            recipientName?: string;
            instructions?: string;
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user in this group can draft a policy change email.";
            }
            const draft = await ctx.runMutation(internal.policyChanges.draftSubmission, {
              caseId: params.caseId as Id<"policyChangeCases">,
              userId: user._id,
              recipientEmail: params.recipientEmail,
              recipientName: params.recipientName,
              instructions: params.instructions,
            });
            return {
              status: draft.needsRecipient ? "needs_recipient" : "drafted",
              caseId: params.caseId,
              readyToSend: !draft.needsRecipient,
              nextAction: draft.needsRecipient
                ? "Ask for the broker email address."
                : "Summarize the email briefly and ask for approval before sending.",
              emailDraft: {
                recipientEmail: draft.recipientEmail,
                recipientName: draft.recipientName,
                subject: draft.subject,
                body: draft.body,
              },
            };
          },
        },
        complete_policy_change_from_endorsement: {
          ...completePolicyChangeFromEndorsement,
          execute: async (params: {
            caseId?: string;
            policyId: string;
            files: Array<{ fileId: string; fileName: string }>;
            summary?: string;
            fieldUpdates?: Record<string, unknown>;
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user in this group can complete a policy change request.";
            }
            for (const file of params.files) {
              const matched = availableEmailAttachments.some(
                (attachment) => String(attachment.fileId) === file.fileId,
              );
              if (!matched) {
                return `Storage ID ${file.fileId} does not match any attachment on this message.`;
              }
            }
            const result = await ctx.runMutation(internal.policyChanges.completeFromEndorsement, {
              caseId: params.caseId as Id<"policyChangeCases"> | undefined,
              userId: user._id,
              policyId: params.policyId as Id<"policies">,
              files: params.files.map((file) => ({
                fileId: file.fileId as Id<"_storage">,
                fileName: file.fileName,
              })),
              summary: params.summary,
              fieldUpdates: params.fieldUpdates,
            });
            return { status: "completed", ...result };
          },
        },
        compare_coverages: {
          ...compareCoverages,
          execute: async (params: { policyId1: string; policyId2: string }) => {
            const p1 = (policies as any[]).find(
              (p) => p._id === params.policyId1,
            );
            const p2 = (policies as any[]).find(
              (p) => p._id === params.policyId2,
            );
            if (!p1 || !p2) return "One or both policies not found.";
            const mapP = (p: any) => ({
              id: p._id,
              carrier: p.security,
              type: p.policyTypes,
              limits: p.limits,
              coverages: (p.coverages ?? []).map((c: any) => ({
                name: c.name,
                limit: c.limit,
              })),
            });
            return { policy1: mapP(p1), policy2: mapP(p2) };
          },
        },
        lookup_compliance_requirements: {
          ...lookupComplianceRequirements,
          execute: async (params: {
            query?: string;
            appliesTo?: "vendors" | "own_org" | "both" | "all";
          }) => {
            const allRequirements = (
              await Promise.all(
                readOrgIds.map((scopedOrgId) =>
                  ctx
                    .runQuery(internal.compliance.listRequirementsInternal, {
                      orgId: scopedOrgId,
                    })
                    .catch(() => []),
                ),
              )
            ).flat();
            const matches = filterComplianceRequirements(
              allRequirements,
              params,
            );
            if (matches.length === 0) {
              return "No matching compliance requirements found. Vendor/contractor requirements and internal requirements are stored separately.";
            }
            return matches.map(formatComplianceRequirement).join("\n");
          },
        },
        ...buildVendorComplianceTools(
          ctx,
          readOrgIds.map((scopedOrgId) => String(scopedOrgId)),
        ),
        save_note: {
          ...saveNote,
          execute: async (params: {
            content: string;
            type: string;
            policyId?: string;
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user in this group can save durable notes.";
            }
            const typeMap: Record<
              string,
              "fact" | "preference" | "risk_note" | "observation"
            > = {
              fact: "fact",
              preference: "preference",
              risk_note: "risk_note",
              observation: "observation",
            };
            await ctx.runMutation(internal.orgMemory.upsert, {
              orgId: currentParticipant?.orgId ?? orgId,
              type: typeMap[params.type] ?? "observation",
              content: params.content,
              source: "imessage" as const,
              policyId: params.policyId as Id<"policies"> | undefined,
            });
            return "Note saved.";
          },
        },
        attach_policy_document: {
          ...attachPolicyDocument,
          execute: async (params: { policyId: string }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user in this chat can request the original policy PDF.";
            }
            const resolvedPolicy = await resolvePolicyReferenceForOrg(ctx, {
              orgIds: [orgId],
              reference: params.policyId,
            });
            if (!resolvedPolicy.ok) return resolvedPolicy.message;
            const requestedPolicy: any = resolvedPolicy.policy;
            if (
              !requestedPolicy ||
              String(requestedPolicy.orgId) !== String(orgId)
            ) {
              return "Please have a linked user from that policy's organization request this policy document.";
            }
            if (!requestedPolicy.fileId) {
              return "That policy does not have an original PDF file available.";
            }
            responseFileAttachments.push({
              storageId: requestedPolicy.fileId as Id<"_storage">,
              filename:
                requestedPolicy.fileName ??
                `${requestedPolicy.policyNumber ?? "policy"}.pdf`,
            });
            return "Original policy PDF will be sent as an attachment.";
          },
        },
        confirm_policy_fact: {
          ...confirmPolicyFact,
          execute: async (params: {
            policyId: string;
            fact: string;
            sourceSpanIds: string[];
            fieldUpdates?: Record<string, string | undefined>;
          }) => {
            if (!currentSenderIsLinked || !currentParticipant?.orgId) {
              return "Only a linked Glass user in this group can confirm policy facts.";
            }
            const policy: any = await ctx.runQuery(
              internal.policies.getInternal,
              { id: params.policyId as Id<"policies"> },
            );
            if (
              !policy ||
              String(policy.orgId) !== String(currentParticipant.orgId)
            ) {
              return "Please have a linked user from that policy's organization confirm this fact.";
            }
            try {
              const result = await ctx.runMutation(
                internal.policies.confirmPolicyFactFromSource,
                {
                  id: params.policyId as Id<"policies">,
                  orgId: currentParticipant.orgId,
                  userId: user._id,
                  fact: params.fact,
                  sourceSpanIds: params.sourceSpanIds,
                  source: "imessage",
                  fieldUpdates: params.fieldUpdates,
                },
              );
              return {
                status: "confirmed",
                fact: params.fact,
                updatedFields: result.updatedFields,
                sourceSpanIds: result.sourceSpanIds,
              };
            } catch (err) {
              return err instanceof Error
                ? err.message
                : "Unable to confirm that fact from source evidence.";
            }
          },
        },
        generate_coi: {
          ...generateCoiTool,
          execute: async (params: {
            policyId: string;
            certificateHolder?: string;
            requestText?: string;
            requestedEndorsements?: string[];
            partnerProgramId?: string;
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Glass user in this group can generate a certificate.";
            }
            const requestedPolicy: any = await ctx.runQuery(
              internal.policies.getInternal,
              {
                id: params.policyId as Id<"policies">,
              },
            );
            if (
              !requestedPolicy ||
              String(requestedPolicy.orgId) !== String(orgId)
            ) {
              return "Please have a linked user from that policy's organization generate this certificate.";
            }
            const autoGenerate = org.autoGenerateCoi !== false;
            if (!autoGenerate) {
              const handling = org.coiHandling ?? "ignore";
              if (handling === "broker")
                return "COI auto-generation is off. Contact your broker.";
              if (handling === "member")
                return "COI auto-generation is off. Contact your insurance contact.";
              return "COI auto-generation is disabled for this organization.";
            }
            try {
              // Run COI generation inline so we can attach the PDF to the iMessage reply
              const generated = await ctx.runAction(
                internal.certificates.generateForOrg,
                {
                  policyId: requestedPolicy._id,
                  orgId,
                  holderName:
                    params.certificateHolder?.split(/\r?\n/)[0]?.trim() ||
                    "Certificate holder",
                  certificateHolder: params.certificateHolder,
                  requestText: params.requestText,
                  requestedEndorsements: params.requestedEndorsements,
                  selectedPartnerProgramId: normalizeSelectedPartnerProgramId(
                    params.partnerProgramId,
                  ),
                  source: "imessage",
                  createdByUserId: user._id,
                },
              );
              if (!generated) return COI_GENERATION_FAILED_MESSAGE;
              if (generated.status === "held_policy_change_required") {
                return generated.message ?? "This certificate is on hold because it requires broker review before a COI can be issued.";
              }
              if (generated.status === "pending_approval") {
                return "Certified COI approval requested from the program administrator. I will not send a certificate PDF until it is approved.";
              }
              if (generated.status === "needs_program_selection") {
                const selection = buildCertificateProgramSelection({
                  policyId: String(requestedPolicy._id),
                  holderName:
                    params.certificateHolder?.split(/\r?\n/)[0]?.trim() ||
                    "Certificate holder",
                  certificateHolder: params.certificateHolder,
                  candidates: generated.matchCandidates,
                  source: "imessage",
                });
                if (selection) {
                  certificateProgramSelectionArtifacts.push(selection);
                  return formatCertificateProgramSelectionForUser(selection);
                }
                return "I found multiple possible program administrator programs. Reply with the correct program name before I generate the certified COI.";
              }
              responseFileAttachments.push({
                storageId: generated.fileId as Id<"_storage">,
                filename: generated.fileName,
              });
              return generated.authorityType === "certified"
                ? "Certified COI generated and will be sent as an attachment."
                : "Non-binding COI generated and will be sent as an attachment.";
            } catch (err) {
              console.error("[imessage] COI generation failed:", err);
              return COI_GENERATION_FAILED_MESSAGE;
            }
          },
        },
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
                referencedPolicyIds: relevantPolicyIds as Id<"policies">[],
                autoSendEmails: brokerDirectedEmailRequest
                  ? false
                  : org.autoSendEmails === true,
                emailSendDelay: org.emailSendDelay,
                autoGenerateCoi: org.autoGenerateCoi,
                coiHandling: org.coiHandling,
                conversationContext:
                  recentConversationContext +
                  (draftEmails.length > 0
                    ? `\n\nCURRENT EMAIL DRAFTS:\n${buildEmailDraftTextSummary(draftEmails, {
                        sampleSize: Math.min(3, draftEmails.length),
                        commands: "chat",
                      })}`
                    : ""),
                onResult: (result) => {
                  emailToolResult.current = result;
                },
              }),
            }
          : {}),
      };

      // ── 14. Run model ─────────────────────────────────────────────────────
      const result = await generateText({
        model: await getModelForOrg(ctx, orgId, "chat"),
        providerOptions: getProviderOptionsForTask("chat"),
        // iMessage responses should be short — cap at 512 tokens
        maxOutputTokens: 512,
        system: systemPrompt,
        messages: modelMessages,
        tools: imessageTools,
        stopWhen: stepCountIs(8),
      });

      let responseText = result.text;
      let responseAlreadySent = false;
      const emailResult = emailToolResult.current;
      if (emailResult) {
        responseText = emailResult.responseBody;
        if (
          emailResult.status === "draft" ||
          emailResult.status === "needs_confirmation"
        ) {
          const draftsAfterEmailTool = await ctx.runQuery(
            internal.pendingEmails.listDraftsInternal,
            { threadId, orgId },
          ) as Array<Doc<"pendingEmails">>;
          if (draftsAfterEmailTool.length > 0) {
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
                  ? (relevantPolicyIds as Id<"policies">[])
                  : undefined,
            });
          }
        }
      }

      // ── 15. Resolve response attachment URLs ─────────────────────────────
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

      // ── 16. Persist agent response ────────────────────────────────────────
      const agentAttachments = responseFileAttachments.map((c) => ({
        filename: c.filename,
        contentType: "application/pdf",
        size: 0,
        fileId: c.storageId,
      }));
      if (!responseAlreadySent && responseText.trim()) {
        await ctx.runMutation(internal.threads.insertImessageMessage, {
          threadId,
          orgId,
          role: "agent",
          content: responseText,
          responseMessageId: `${eventKey}:response`,
          referencedPolicyIds:
            relevantPolicyIds.length > 0
              ? (relevantPolicyIds as Id<"policies">[])
              : undefined,
          attachments:
            agentAttachments.length > 0 ? agentAttachments : undefined,
          toolArtifacts:
            certificateProgramSelectionArtifacts.length > 0
              ? certificateProgramSelectionArtifacts.map((selection) => ({
                  type: "certificate_program_selection",
                  data: selection,
                }))
              : undefined,
        });
      }

      // ── 17. Post-exchange orgMemory extraction ────────────────────────────
      if (currentSenderIsLinked)
        try {
          const memoryExtraction = await generateText({
            model: haikuModel,
            maxOutputTokens: 400,
            system: `Extract durable facts, preferences, risk notes, or observations about an organization from a short text exchange.
Output a strict JSON array of up to 3 items: [{"type": "fact"|"preference"|"risk_note"|"observation", "content": string}].
Only include items worth remembering long-term. Skip pleasantries and one-off questions. Output ONLY the JSON array.`,
            messages: [
              {
                role: "user",
                content: `USER: ${args.messageText}\n\nAGENT: ${emailResult?.responseBody ?? responseText}`,
              },
            ],
          });
          let parsed: Array<{ type: string; content: string }> = [];
          try {
            const cleaned = cleanJsonText(memoryExtraction.text);
            const arr = JSON.parse(cleaned);
            if (Array.isArray(arr)) parsed = arr;
          } catch {
            // ignore parse failures
          }
          const allowedTypes = new Set([
            "fact",
            "preference",
            "risk_note",
            "observation",
          ]);
          const items = parsed
            .filter(
              (it) =>
                it &&
                typeof it.content === "string" &&
                allowedTypes.has(it.type),
            )
            .slice(0, 3)
            .map((it) => ({
              orgId: currentParticipant?.orgId ?? orgId,
              type: it.type as
                | "fact"
                | "preference"
                | "risk_note"
                | "observation",
              content: it.content.trim(),
              source: "imessage" as const,
            }))
            .filter((it) => it.content.length > 0);
          if (items.length > 0) {
            await ctx.runMutation(internal.orgMemory.bulkInsert, { items });
          }
        } catch (err) {
          console.warn("[imessage] orgMemory extraction failed:", err);
        }

      return await finish(
        responseAlreadySent ? "" : responseText,
        responseAttachments.length > 0 ? responseAttachments : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[imessage] Agent processing error:", message);
      return await finish(FATAL_ACTION_FAILED_MESSAGE);
    }
  },
});
