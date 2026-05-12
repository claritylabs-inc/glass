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
  saveNote,
  generateCoi as generateCoiTool,
  createPolicyChangeRequest,
} from "../lib/chatTools";
import {
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
import { classifyPromptInjection, enforceInputLimits } from "../lib/security";
import type { Id } from "../_generated/dataModel";
import { getImessageWorkerUrl, isImessageInboundEnabled } from "../lib/imessageConfig";
import {
  anonymousParticipantLabel,
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
import {
  COI_GENERATION_FAILED_MESSAGE,
  FATAL_ACTION_FAILED_MESSAGE,
} from "../lib/actionFailures";

/** Normalize a raw phone string to E.164 (+1XXXXXXXXXX). */
function normalizePhone(raw: string): string {
  if (raw.includes("@")) return raw.trim().toLowerCase();
  const cleaned = raw.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
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
    hash.update(`fallback:${scope}:${args.fromPhone}:${minuteBucket}:${args.messageText}`);
    for (const attachment of args.attachments ?? []) {
      hash.update(`:${attachment.name}:${attachment.mimeType}:${attachment.data.length}`);
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
      console.warn(`[imessage] Status cue send failed ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[imessage] Status cue send failed:", err);
    return false;
  }
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

function buildRecentTextContext(messages: Array<{
  role: string;
  content: string;
  status?: string;
  userName?: string;
  responseMessageId?: string;
}>): string {
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
          data: v.string(),    // base64-encoded bytes
          mimeType: v.string(),
          name: v.string(),
        })
      )
    ),
  },
  handler: async (ctx, args): Promise<ImessageResponse> => {
    if (!isImessageInboundEnabled()) {
      console.warn("[imessage] Inbound message received while iMessage inbound is not enabled");
      return { response: "" };
    }

    const fromPhone = normalizePhone(args.fromPhone);
    const senderAddress = normalizeImessageAddress(args.fromPhone);
    const chatGuid = args.chatGuid?.trim() || fromPhone;
    const isGroup = args.isGroup === true;
    const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.inc";
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
      return { response, attachments, leaveGroup: options?.leaveGroup, chatGuid };
    };

    try {
    // ── 1. Resolve group participants and org scope ───────────────────────
    if (isGroup && args.participantsUnavailable) {
      return await finish("I couldn't confirm who is in this group chat yet. Please try again in a moment.");
    }

    const participantInputs = new Map<string, { address: string; displayName?: string }>();
    for (const participant of args.participants ?? []) {
      const address = normalizeImessageAddress(participant.address);
      if (address) participantInputs.set(address, { address, displayName: participant.displayName });
    }
    if (!participantInputs.has(senderAddress)) {
      participantInputs.set(senderAddress, { address: senderAddress });
    }

    const phones = [...participantInputs.keys()].filter((address) => !address.includes("@"));
    const linkedUsers = await ctx.runQuery(internal.users.findManyByPhones, { phones });
    const usersByPhone = new Map(
      linkedUsers
        .filter((user) => user?.phone)
        .map((user) => [normalizeImessageAddress(user!.phone!), user!]),
    );
    const memberships = await ctx.runQuery(internal.orgs.getUserMemberships, {
      userIds: linkedUsers.map((user) => user!._id),
    });
    const membershipByUserId = new Map(
      memberships.map((membership) => [String(membership!.userId), membership!]),
    );

    const resolvedParticipants: ResolvedImessageParticipant[] = [...participantInputs.values()]
      .map((participant) => {
        const linkedUser = usersByPhone.get(participant.address);
        const membership = linkedUser
          ? membershipByUserId.get(String(linkedUser._id))
          : undefined;
        const role: "linked" | "anonymous" = linkedUser && membership ? "linked" : "anonymous";
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

    await ctx.runMutation(internal.imessageChats.syncChat, {
      chatGuid,
      isGroup,
      primaryOrgId: scope.primaryOrgId,
      title: args.chatTitle,
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
    const user = linkedUsers.find((candidate) => candidate?._id === scope.primaryUserId);
    if (!user) return await finish(`Sign up to use Glass: ${siteUrl}/signup/client`);
    const currentParticipant = resolvedParticipants.find(
      (participant) => normalizeImessageAddress(participant.address) === senderAddress,
    );
    const currentSenderIsLinked = Boolean(currentParticipant?.userId && currentParticipant.orgId);

    // ── 3. Prompt injection guard ─────────────────────────────────────────
    const guardedText = enforceInputLimits(args.messageText);
    const injectionCheck = await classifyPromptInjection(guardedText);
    if (!injectionCheck.safe) {
      console.warn("[security] iMessage prompt injection blocked", { fromPhone });
      return await finish("I can't process that request.");
    }

    // ── 4. Thread routing ─────────────────────────────────────────────────
    const threadId = await ctx.runMutation(internal.threads.findOrCreateByImessageChat, {
      orgId,
      userId: user._id,
      chatGuid,
      isGroup,
      scope: scope.kind === "multi_org" ? "multi_org" : "single_org",
      title: args.chatTitle,
      fallbackPhone: fromPhone.includes("@") ? undefined : fromPhone,
      userName: user.name,
    });

    // ── 5. Fetch org context ──────────────────────────────────────────────
    const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
    if (!org) return await finish("Unable to find your account.");
    const scopedOrgs = await Promise.all(
      scope.orgIds.map((scopedOrgId) =>
        ctx.runQuery(internal.orgs.getInternal, { id: scopedOrgId }),
      ),
    );
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
        const blob = new Blob([new Uint8Array(buffer)], { type: att.mimeType });
        const fileId = await ctx.storage.store(blob);
        attachmentRecords.push({
          filename: att.name,
          contentType: att.mimeType,
          size: buffer.byteLength,
          fileId,
          buffer,
        });
      } catch (err) {
        console.warn(`[imessage] Failed to store attachment ${att.name}:`, err);
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
    });
    const historyForContext = history.filter((msg) => {
      if (msg.status === "processing") return false;
      if (isImessageStatusCue(msg)) return false;
      return !(msg.role === "user" && msg.content === args.messageText);
    });
    const recentConversationContext = buildRecentTextContext(historyForContext);
    const retrievalQuery = [recentConversationContext, `User: ${args.messageText}`]
      .filter((part) => part.trim().length > 0)
      .join("\n");

    // Send a model-decided status cue before heavier retrieval/tool work so SMS
    // users get immediate feedback when the agent needs to check policy data.
    const statusCue = await generateImessageStatusCue({
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
      scope.orgIds.map(async (scopedOrgId) => ({
        orgId: scopedOrgId,
        policies: await ctx.runQuery(internal.policies.listAllInternal, { orgId: scopedOrgId }),
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
        const orgName = orgNamesById[String(entry.orgId)] ?? "Linked organization";
        policyContextParts.push(`\n\nPOLICY CONTEXT FOR ${orgName}\n${built.context}`);
      }
      relevantPolicyIds.push(...(built.relevantPolicyIds as Id<"policies">[]));
    }
    const policyContext = policyContextParts.join("");
    const memoryContext = await buildConversationMemoryContext(ctx, orgId, retrievalQuery);
    const orgMemoryBlocks = await Promise.all(
      scope.orgIds.map(async (scopedOrgId) => {
        const orgName = orgNamesById[String(scopedOrgId)] ?? "Linked organization";
        const block = await buildIntelligenceContext(
          ctx,
          scopedOrgId,
          retrievalQuery,
          relevantPolicyIds.map(String),
        );
        return block.trim().length > 0 ? `\n\nORG MEMORY FOR ${orgName}\n${block}` : "";
      }),
    );
    const orgMemoryBlock = orgMemoryBlocks.join("");

    // ── 10. Build message history from thread ─────────────────────────────
    const modelMessages: ModelMessage[] = [];
    for (const msg of history) {
      if (msg.status === "processing") continue;
      // Skip the message we just inserted (the inbound one)
      if (msg.role === "user" && msg.content === args.messageText) continue;
      // Status cues are sent for responsiveness and should not steer the final answer.
      if (isImessageStatusCue(msg)) continue;
      if (msg.role === "user") {
        modelMessages.push({ role: "user", content: msg.userName ? `[${msg.userName}]: ${msg.content}` : msg.content });
      } else if (msg.role === "agent" && msg.content) {
        modelMessages.push({ role: "assistant", content: msg.content });
      }
    }
    // Append current message
    const currentSpeakerLabel =
      currentParticipant?.userName ??
      currentParticipant?.displayName ??
      anonymousParticipantLabel(senderAddress, 1);
    modelMessages.push({ role: "user", content: `[${currentSpeakerLabel}]: ${args.messageText}` });

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
            parts.push({ type: "file", data: att.buffer.toString("base64"), mediaType: "application/pdf" });
          } else if (att.contentType.startsWith("image/")) {
            parts.push({ type: "image", image: att.buffer.toString("base64"), mediaType: att.contentType });
          }
        }
        if (parts.length > 0) {
          parts.push({ type: "text", text: lastMsg.content });
          modelMessages[modelMessages.length - 1] = { role: "user", content: parts };
        }
      }
    }

    // ── 12. Build system prompt ───────────────────────────────────────────
    let brokerName: string | undefined;
    let brokerContactName: string | undefined;
    let brokerContactEmail: string | undefined;
    if (org.type === "client" && org.brokerOrgId) {
      const brokerRecord = await ctx.runQuery(internal.orgs.getInternal, { id: org.brokerOrgId });
      if (brokerRecord) {
        brokerName = brokerRecord.name;
        if (brokerRecord.primaryInsuranceContactId) {
          const brokerContact = await ctx.runQuery(internal.users.getInternal, {
            id: brokerRecord.primaryInsuranceContactId,
          });
          brokerContactName = brokerContact?.name;
          brokerContactEmail = brokerContact?.email;
        }
      }
    }

    const systemPrompt =
      buildSystemPromptForContext({
        org: {
          name: org.name,
          context: org.context,
          coiHandling: org.coiHandling,
          broker: brokerName
            ? { name: brokerName, contactName: brokerContactName, contactEmail: brokerContactEmail }
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
      orgMemoryBlock;

    // ── 13. Wire up tools ─────────────────────────────────────────────────
    const coiAttachments: Array<{ storageId: Id<"_storage">; filename: string }> = [];
    const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, { orgId });
    const allowedRecipients = [
      ...new Set(
        [
          user.email,
          ...orgMembers.map((member: any) => member?.email),
        ].filter(Boolean).map((email) => String(email).toLowerCase()),
      ),
    ];
    const availableEmailAttachments = attachmentRecords
      .filter((att): att is typeof att & { fileId: Id<"_storage"> } => !!att.fileId)
      .map((att) => ({
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        fileId: att.fileId,
      }));
    const emailToolResult: { current: EmailSubagentResult | null } = { current: null };

    const imessageTools = {
      lookup_policy: {
        ...lookupPolicy,
        execute: async (params: { query: string; policyType?: string; carrier?: string }) => {
          const scored = (policies as any[])
            .map((p) => ({
              policy: p,
              score: policySearchScore(p, params.query, params.policyType, params.carrier),
            }))
            .filter((p) => p.score > 0)
            .sort((a, b) => b.score - a.score);
          const matches = scored.length > 0
            ? scored.map((s) => s.policy)
            : (policies as any[]).slice(0, 5);
          if (matches.length === 0) return "No policies found.";
          return matches.slice(0, 5).map((p: any) => ({
            id: p._id,
            insured: p.insuredName,
            carrier: p.security,
            type: p.policyTypes?.join(", "),
            number: p.policyNumber,
            effective: p.effectiveDate,
            expiration: p.expirationDate,
            premium: p.premium,
            coverages: (p.coverages ?? []).map((c: any) => ({
              name: c.name, limit: c.limit, deductible: c.deductible,
            })),
          }));
        },
      },
      lookup_policy_section: {
        ...lookupPolicySection,
        execute: async (params: { policyId: string; query: string }) => {
          const policy: any = await ctx.runQuery(internal.policies.getInternal, {
            id: params.policyId as Id<"policies">,
          });
          if (!policy || !scope.orgIds.map(String).includes(String(policy.orgId))) return "Policy not found.";
          return searchPolicyDocumentWithSourceSpans(ctx, policy, params.query, 8);
        },
      },
      create_policy_change_request: {
        ...createPolicyChangeRequest,
        execute: async (params: { requestText: string; policyId?: string; evidenceSourceIds?: string[] }) => {
          if (!currentSenderIsLinked) {
            return "Only a linked Glass user in this group can create a policy change request.";
          }
          if (scope.kind === "multi_org" && !params.policyId) {
            return "Please specify which organization's policy this change request is for.";
          }
          if (params.policyId) {
            const policy: any = await ctx.runQuery(internal.policies.getInternal, {
              id: params.policyId as Id<"policies">,
            });
            if (!policy || String(policy.orgId) !== String(orgId)) {
              return "Please have a linked user from that policy's organization create this change request.";
            }
          }
          const result = await ctx.runAction(internal.actions.policyChangeRequests.createFromChatForThread, {
            orgId,
            userId: user._id,
            policyId: params.policyId as Id<"policies"> | undefined,
            requestText: params.requestText,
            evidenceSourceIds: params.evidenceSourceIds,
          });
          if (result?.error) return `Could not create policy change request: ${result.error}`;
          return {
            status: "created",
            caseId: result?.caseId,
            usedSdkPce: Boolean(result?.usedSdkPce),
          };
        },
      },
      compare_coverages: {
        ...compareCoverages,
        execute: async (params: { policyId1: string; policyId2: string }) => {
          const p1 = (policies as any[]).find((p) => p._id === params.policyId1);
          const p2 = (policies as any[]).find((p) => p._id === params.policyId2);
          if (!p1 || !p2) return "One or both policies not found.";
          const mapP = (p: any) => ({
            id: p._id, carrier: p.security, type: p.policyTypes, limits: p.limits,
            coverages: (p.coverages ?? []).map((c: any) => ({ name: c.name, limit: c.limit })),
          });
          return { policy1: mapP(p1), policy2: mapP(p2) };
        },
      },
      save_note: {
        ...saveNote,
        execute: async (params: { content: string; type: string; policyId?: string }) => {
          if (!currentSenderIsLinked) {
            return "Only a linked Glass user in this group can save durable notes.";
          }
          const typeMap: Record<string, "fact" | "preference" | "risk_note" | "observation"> = {
            fact: "fact", preference: "preference", risk_note: "risk_note", observation: "observation",
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
      generate_coi: {
        ...generateCoiTool,
        execute: async (params: { policyId: string; certificateHolder?: string }) => {
          if (!currentSenderIsLinked) {
            return "Only a linked Glass user in this group can generate a certificate.";
          }
          const requestedPolicy: any = await ctx.runQuery(internal.policies.getInternal, {
            id: params.policyId as Id<"policies">,
          });
          if (!requestedPolicy || String(requestedPolicy.orgId) !== String(orgId)) {
            return "Please have a linked user from that policy's organization generate this certificate.";
          }
          const autoGenerate = org.autoGenerateCoi !== false;
          if (!autoGenerate) {
            const handling = org.coiHandling ?? "ignore";
            if (handling === "broker") return "COI auto-generation is off. Contact your broker.";
            if (handling === "member") return "COI auto-generation is off. Contact your insurance contact.";
            return "COI auto-generation is disabled for this organization.";
          }
          try {
            // Run COI generation inline so we can attach the PDF to the iMessage reply
            const generated = await ctx.runAction(internal.actions.generateCoi.run, {
              policyId: params.policyId as Id<"policies">,
              orgId,
              certificateHolder: params.certificateHolder,
              certificateHolderName: params.certificateHolder?.split(/\r?\n/)[0]?.trim() || undefined,
              source: "imessage",
              createdByUserId: user._id,
            });
            if (!generated) return COI_GENERATION_FAILED_MESSAGE;
            coiAttachments.push({
              storageId: generated.storageId as Id<"_storage">,
              filename: "certificate-of-insurance.pdf",
            });
            return "COI generated and will be sent as an attachment.";
          } catch (err) {
            console.error("[imessage] COI generation failed:", err);
            return COI_GENERATION_FAILED_MESSAGE;
          }
        },
      },
      ...(currentSenderIsLinked && emailIdentity.canSend && emailIdentity.agentAddress && emailIdentity.fromHeader
        ? {
            email_expert: buildEmailExpertTool(ctx, {
              orgId,
              threadId,
              channel: "imessage",
              fromHeader: emailIdentity.fromHeader,
              agentAddress: emailIdentity.agentAddress,
              brokerBranding: emailIdentity.brokerBranding,
              senderEmail: user.email,
              defaultTo: user.email,
              defaultRecipientName: user.name,
              defaultBcc:
                org.bccRequesterOnAgentEmails !== false && user.email
                  ? [user.email]
                  : undefined,
              allowedRecipients,
              availableAttachments: availableEmailAttachments,
              referencedPolicyIds: relevantPolicyIds as Id<"policies">[],
              autoSendEmails: org.autoSendEmails === true,
              emailSendDelay: org.emailSendDelay,
              autoGenerateCoi: org.autoGenerateCoi,
              coiHandling: org.coiHandling,
              conversationContext: recentConversationContext,
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
    const emailResult = emailToolResult.current;
    if (emailResult) {
      responseText = emailResult.responseBody;
    }

    // ── 15. Resolve COI attachment URLs ───────────────────────────────────
    const responseAttachments: Array<{ url: string; filename: string; mimeType: string }> = [];
    for (const coi of coiAttachments) {
      try {
        const url = await ctx.storage.getUrl(coi.storageId);
        if (url) {
          responseAttachments.push({ url, filename: coi.filename, mimeType: "application/pdf" });
        }
      } catch (err) {
        console.warn("[imessage] Failed to get COI URL:", err);
      }
    }

    // ── 16. Persist agent response ────────────────────────────────────────
    const agentAttachments = coiAttachments.map((c) => ({
      filename: c.filename,
      contentType: "application/pdf",
      size: 0,
      fileId: c.storageId,
    }));
    await ctx.runMutation(internal.threads.insertImessageMessage, {
      threadId,
      orgId,
      role: "agent",
      content: responseText,
      responseMessageId: `${eventKey}:response`,
      referencedPolicyIds:
        relevantPolicyIds.length > 0 ? (relevantPolicyIds as Id<"policies">[]) : undefined,
      attachments: agentAttachments.length > 0 ? agentAttachments : undefined,
    });

    // ── 17. Post-exchange orgMemory extraction ────────────────────────────
    if (currentSenderIsLinked) try {
      const memoryExtraction = await generateText({
        model: haikuModel,
        maxOutputTokens: 400,
        system: `Extract durable facts, preferences, risk notes, or observations about an organization from a short text exchange.
Output a strict JSON array of up to 3 items: [{"type": "fact"|"preference"|"risk_note"|"observation", "content": string}].
Only include items worth remembering long-term. Skip pleasantries and one-off questions. Output ONLY the JSON array.`,
        messages: [
          {
            role: "user",
            content: `USER: ${args.messageText}\n\nAGENT: ${responseText}`,
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
      const allowedTypes = new Set(["fact", "preference", "risk_note", "observation"]);
      const items = parsed
        .filter((it) => it && typeof it.content === "string" && allowedTypes.has(it.type))
        .slice(0, 3)
        .map((it) => ({
          orgId: currentParticipant?.orgId ?? orgId,
          type: it.type as "fact" | "preference" | "risk_note" | "observation",
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
      responseText,
      responseAttachments.length > 0 ? responseAttachments : undefined,
    );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[imessage] Agent processing error:", message);
      return await finish(FATAL_ACTION_FAILED_MESSAGE);
    }
  },
});
