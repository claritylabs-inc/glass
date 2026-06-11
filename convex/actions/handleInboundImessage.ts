"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";
import { haikuModel } from "../lib/ai";
import {
  createImessageGroupChat,
  coordinateMailboxTask,
  webResearch,
} from "../lib/chatTools";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
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
} from "../lib/aiUtils";
import { tryBuildParsedPdfText } from "../lib/liteparsePreprocessor";
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
import { FATAL_ACTION_FAILED_MESSAGE } from "../lib/actionFailures";
import {
  formatCertificateProgramSelectionForModel,
  type CertificateProgramSelection,
} from "../lib/certificateProgramSelection";
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

function normalizeStatusCueText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isShortImessageConfirmation(text: string): boolean {
  const normalized = normalizeStatusCueText(text);
  if (!normalized) return true;
  if (normalized.length > 80) return false;
  return /^(y|yes|yep|yeah|correct|right|ok|okay|sure|confirmed?|approved?|approve|go ahead|do it|please do|that works|sounds good|no additional wording|no addl wording|standard only|no special wording|no extra wording)$/.test(
    normalized,
  );
}

function generateImessageStatusCue(params: {
  messageText: string;
  hasAttachments: boolean;
}): string | null {
  if (isShortImessageConfirmation(params.messageText)) return null;
  const normalized = normalizeStatusCueText(params.messageText);
  if (!normalized) return null;
  if (/^(hi|hello|hey|thanks|thank you|thx|ok thanks|got it)$/.test(normalized)) {
    return null;
  }
  if (
    /\b(coi|certificate|cert|holder|additional insured|waiver|subrogation|endorsement)\b/.test(
      normalized,
    )
  ) {
    return "I'll check the policy and certificate details.";
  }
  if (
    /\b(policy|coverage|coverages|limit|limits|deductible|premium|carrier|insured|expiration|section|change request|broker|requirement|compliance|vendor)\b/.test(
      normalized,
    )
  ) {
    return "I'll check the policy record.";
  }
  if (params.hasAttachments) return "I'll check the attachment.";
  return null;
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

function hasCoiRequestIntent(messageText: string, recentContext?: string): boolean {
  const normalized = normalizeStatusCueText(
    `${messageText}\n${recentContext ?? ""}`,
  );
  return /\b(coi|certificate of insurance|certificate holder|cert holder|generate (a )?certificate|issue (a )?certificate)\b/.test(
    normalized,
  );
}

function claimsCoiCompletion(messageText: string): boolean {
  const normalized = normalizeStatusCueText(messageText);
  if (!/\b(coi|certificate|cert)\b/.test(normalized)) return false;
  return /\b(generated|created|issued|attached|sent|ready|completed|done|found an existing)\b/.test(
    normalized,
  );
}

function asksForInternalPolicyRecordId(messageText: string): boolean {
  return /\b(internal policy id|policy record id|internal record id|convex id|string of characters)\b/i.test(
    messageText,
  );
}

function serializeToolAuditValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function collectToolAudit(result: unknown): {
  usedTools: string[];
  toolCalls: Array<{ name: string; input?: string; output?: string }>;
} {
  const usedTools: string[] = [];
  const toolCalls: Array<{ name: string; input?: string; output?: string }> = [];
  const seen = new Set<string>();

  const addUsedTool = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      usedTools.push(name);
    }
  };

  const addToolCall = (call: Record<string, unknown>) => {
    const name = call.toolName ?? call.name;
    if (typeof name !== "string" || !name) return;
    addUsedTool(name);
    const input = call.input ?? call.args ?? call.parameters;
    toolCalls.push({
      name,
      input: serializeToolAuditValue(input),
    });
  };

  const addToolResult = (resultPart: Record<string, unknown>) => {
    const name = resultPart.toolName ?? resultPart.name;
    if (typeof name !== "string" || !name) return;
    addUsedTool(name);
    const output =
      resultPart.output ?? resultPart.result ?? resultPart.value ?? undefined;
    const target = [...toolCalls]
      .reverse()
      .find((candidate) => candidate.name === name && !candidate.output);
    if (target) {
      target.output = serializeToolAuditValue(output);
    }
  };

  const root = result as Record<string, unknown>;
  const rootCalls = Array.isArray(root.toolCalls) ? root.toolCalls : [];
  for (const call of rootCalls) {
    if (call && typeof call === "object") {
      addToolCall(call as Record<string, unknown>);
    }
  }

  const rootResults = Array.isArray(root.toolResults) ? root.toolResults : [];
  for (const toolResult of rootResults) {
    if (toolResult && typeof toolResult === "object") {
      addToolResult(toolResult as Record<string, unknown>);
    }
  }

  const steps = Array.isArray(root.steps) ? root.steps : [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const stepRecord = step as Record<string, unknown>;
    const calls = Array.isArray(stepRecord.toolCalls)
      ? stepRecord.toolCalls
      : [];
    for (const call of calls) {
      if (call && typeof call === "object") {
        addToolCall(call as Record<string, unknown>);
      }
    }
    const results = Array.isArray(stepRecord.toolResults)
      ? stepRecord.toolResults
      : [];
    for (const toolResult of results) {
      if (toolResult && typeof toolResult === "object") {
        addToolResult(toolResult as Record<string, unknown>);
      }
    }
  }

  return { usedTools, toolCalls };
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
        : generateImessageStatusCue({
            messageText: args.messageText,
            hasAttachments: attachmentRecords.length > 0,
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
          policies: await ctx.runQuery(internal.policies.listAllPreviewReadableInternal, {
            orgId: scopedOrgId,
          }),
        })),
      );
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
              const parsedPdfText = await tryBuildParsedPdfText({
                pdfBytes: att.buffer,
                documentId: att.filename,
                sourceKind: "attachment",
                timeoutMs: 20_000,
              });
              if (parsedPdfText) {
                parts.push({
                  type: "text",
                  text: `--- PDF attachment: ${att.filename} (LiteParse text) ---\n${parsedPdfText}\n--- End PDF attachment ---`,
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
      const imessageToolArtifacts: Array<{ type: string; data: unknown }> = [];
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
          org,
          canWrite: currentSenderIsLinked,
          writeUnavailableMessage:
            "Only a linked Glass user in this chat can do that.",
          availableFileIds,
          onPolicyReferenced: (policyId) => {
            if (!relevantPolicyIds.some((id) => String(id) === String(policyId))) {
              relevantPolicyIds.push(policyId);
            }
          },
          onResponseAttachment: (attachment) => {
            if (attachment.fileId) {
              responseFileAttachments.push({
                storageId: attachment.fileId,
                filename: attachment.filename,
              });
            }
          },
          onToolArtifact: (artifact) => {
            imessageToolArtifacts.push(artifact);
            if (artifact.type === "certificate_program_selection") {
              certificateProgramSelectionArtifacts.push(
                artifact.data as CertificateProgramSelection,
              );
            }
          },
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

      const { usedTools, toolCalls } = collectToolAudit(result);
      let responseText = result.text;
      let responseAlreadySent = false;
      let pendingEmailIdForResponse: Id<"pendingEmails"> | undefined;
      const emailResult = emailToolResult.current;
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
                  ? (relevantPolicyIds as Id<"policies">[])
                  : undefined,
              usedTools: usedTools.length > 0 ? usedTools : undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      }

      const completedCoiSideEffect =
        usedTools.includes("generate_coi") ||
        responseFileAttachments.some((attachment) =>
          /certificate[-_\s]?of[-_\s]?insurance|coi/i.test(
            attachment.filename,
          ),
        );
      if (
        hasCoiRequestIntent(args.messageText, recentConversationContext) &&
        claimsCoiCompletion(responseText) &&
        !completedCoiSideEffect
      ) {
        responseText =
          "I haven't generated that COI yet. I need to resolve the policy and create the certificate first.";
      }
      if (asksForInternalPolicyRecordId(responseText)) {
        responseText =
          "I can use the policy number, named insured, carrier, or a policy list result instead.";
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
          pendingEmailId: pendingEmailIdForResponse,
          attachments:
            agentAttachments.length > 0 ? agentAttachments : undefined,
          usedTools: usedTools.length > 0 ? usedTools : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolArtifacts:
            imessageToolArtifacts.length > 0
              ? imessageToolArtifacts
              : certificateProgramSelectionArtifacts.length > 0
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
