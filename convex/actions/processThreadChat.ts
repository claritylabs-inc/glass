"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { streamText, stepCountIs, type ModelMessage } from "ai";
import {
  fallbackRouteForCall,
  getModelAndRouteForOrg,
  getModelForRoute,
  getProviderOptionsForRoute,
} from "../lib/models";
import {
  lookupPolicy,
  lookupPolicySection,
  compareCoverages,
  lookupComplianceRequirements,
  saveNote,
  attachPolicyDocument,
  confirmPolicyFact,
  generateCoi,
  createPolicyChangeRequest,
  createImessageGroupChat,
  coordinateMailboxTask,
  renderEmailPreview,
} from "../lib/chatTools";
import {
  buildComplianceRequirementsContext,
  buildDocumentContext,
  buildConversationMemoryContext,
} from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  stripMarkdown,
  markdownToHtml,
  buildChannelInstructions,
  buildPolicyToolInstructions,
  policySearchScore,
  logAiError,
} from "../lib/aiUtils";
import { searchPolicyDocumentWithSourceSpans } from "../lib/policyLookup";
import { tryBuildDoclingPdfText } from "../lib/doclingPreprocessor";
import { getNotificationFromAddress, sendResendEmail } from "../lib/resend";
import { buildEmailShell, escapeHtml } from "../lib/emailTemplate";
import { getPortalUrlForOrg } from "../lib/domains";
import {
  buildEmailExpertTool,
  getEmailAgentFromName,
  resolveEmailAgentIdentity,
  type EmailSubagentResult,
} from "../lib/emailSubagent";
import { buildIntelligenceContext } from "../lib/agentPrompts";
import {
  classifyPromptInjection,
  collectAllowedRecipients,
  assertOrgOwnership,
  enforceInputLimits,
} from "../lib/security";
import {
  COI_GENERATION_FAILED_MESSAGE,
  FATAL_ACTION_FAILED_MESSAGE,
} from "../lib/actionFailures";
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

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const nestedCode = (nested as Record<string, unknown>).code;
    if (typeof nestedCode === "string") return nestedCode;
  }
  return typeof record.code === "string" ? record.code : "";
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const status =
    record.statusCode ??
    record.status ??
    (record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>).status
      : undefined);
  return typeof status === "number" ? status : undefined;
}

function isTransientChatStreamError(error: unknown): boolean {
  const code = errorCode(error);
  const status = errorStatus(error);
  const text = errorText(error);
  return (
    code === "server_error" ||
    (typeof status === "number" && status >= 500 && status < 600) ||
    /server_error|internal server error|temporarily unavailable|overloaded|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
      text,
    )
  );
}

function isTextLikeAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("csv") ||
    type.includes("json") ||
    type === "application/vnd.ms-excel" ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".tsv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".json")
  );
}

type ChatAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: string;
};

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string }
  | { type: "file"; data: string; mediaType: string };

const MAX_ATTACHMENT_TEXT_CHARS = 80_000;
const RECENT_ATTACHMENT_MESSAGE_LIMIT = 6;

async function buildAttachmentParts(
  ctx: ActionCtx,
  attachments: ChatAttachment[],
  options: {
    includeRichParts: boolean;
    remainingTextChars: { value: number };
  },
): Promise<{ parts: ChatContentPart[]; names: string[] }> {
  const parts: ChatContentPart[] = [];
  const names: string[] = [];

  for (const att of attachments) {
    if (!att.fileId) continue;
    try {
      const blob = await ctx.storage.get(att.fileId);
      if (!blob) continue;
      const buffer = Buffer.from(await blob.arrayBuffer());

      if (att.contentType === "application/pdf") {
        if (!options.includeRichParts) continue;
        const doclingText = await tryBuildDoclingPdfText({
          pdfBytes: buffer,
          documentId: att.fileId,
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
            data: buffer.toString("base64"),
            mediaType: "application/pdf",
          });
        }
        names.push(att.filename);
      } else if (att.contentType.startsWith("image/")) {
        if (!options.includeRichParts) continue;
        parts.push({
          type: "image",
          image: buffer.toString("base64"),
          mediaType: att.contentType,
        });
        names.push(att.filename);
      } else if (isTextLikeAttachment(att.filename, att.contentType)) {
        const text = buffer.toString("utf-8");
        const remaining = options.remainingTextChars.value;
        if (remaining <= 0) continue;
        const clipped =
          text.length > remaining ? text.slice(0, remaining) : text;
        options.remainingTextChars.value -= clipped.length;
        const suffix =
          clipped.length < text.length
            ? "\n--- Attachment truncated for context ---"
            : "";
        parts.push({
          type: "text",
          text: `--- Attachment: ${att.filename} ---\n${clipped}${suffix}\n--- End attachment ---`,
        });
        names.push(att.filename);
      }
    } catch (err) {
      console.warn(`Failed to read attachment ${att.filename}:`, err);
    }
  }

  return { parts, names };
}

async function buildMessageHistoryWithAttachmentContext(
  ctx: ActionCtx,
  messages: Array<Record<string, unknown>>,
  latestUserMessageId?: string,
): Promise<{ history: ModelMessage[]; latestAttachmentNames: string[] }> {
  const history: ModelMessage[] = [];
  const remainingTextChars = { value: MAX_ATTACHMENT_TEXT_CHARS };
  const recentUserAttachmentIds = new Set(
    messages
      .filter(
        (msg) =>
          msg.role === "user" &&
          msg.status !== "processing" &&
          msg.status !== "cancelled" &&
          Array.isArray(msg.attachments) &&
          msg.attachments.length > 0,
      )
      .slice(-RECENT_ATTACHMENT_MESSAGE_LIMIT)
      .map((msg) => String(msg._id)),
  );
  let latestAttachmentNames: string[] = [];

  for (const msg of messages) {
    if (msg.status === "processing" || msg.status === "cancelled") continue;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (msg.role === "user") {
      const text = msg.userName
        ? `[${String(msg.userName)}]: ${content}`
        : content;
      const attachments = Array.isArray(msg.attachments)
        ? (msg.attachments as ChatAttachment[])
        : [];
      const isLatestUser = latestUserMessageId === String(msg._id);
      const includeAttachmentContext =
        attachments.length > 0 &&
        (isLatestUser || recentUserAttachmentIds.has(String(msg._id)));

      if (includeAttachmentContext) {
        const attachmentContext = await buildAttachmentParts(ctx, attachments, {
          includeRichParts: isLatestUser,
          remainingTextChars,
        });
        if (isLatestUser) {
          latestAttachmentNames = attachmentContext.names;
        }
        if (attachmentContext.parts.length > 0) {
          history.push({
            role: "user",
            content: [...attachmentContext.parts, { type: "text", text }],
          });
          continue;
        }
      }

      history.push({ role: "user", content: text });
    } else if (msg.role === "agent" && content) {
      history.push({ role: "assistant", content });
    }
  }

  return { history, latestAttachmentNames };
}

function hasCoiEmailIntent(text: string): boolean {
  return (
    /\b(coi|certificate(?:\s+of\s+insurance)?)\b/i.test(text) &&
    /\b(send|email|forward|deliver)\b/i.test(text)
  );
}

function claimsCoiEmailCompletion(text: string): boolean {
  return (
    /\b(coi|certificate(?:\s+of\s+insurance)?)\b/i.test(text) &&
    /\b(done|sent|sending|emailing|delivering|generated|attached)\b/i.test(
      text,
    )
  );
}

function claimsEmailDraftCompletion(text: string): boolean {
  return /\b(drafted|prepared)\b[\s\S]{0,80}\bemail\b/i.test(text);
}

function isCoiAttachmentFilename(filename: string): boolean {
  return /\b(coi|certificate[-_\s]?of[-_\s]?insurance)\b/i.test(filename);
}

/** Build executable tools with Convex context wired in. */

function buildTools(
  ctx: any,
  args: {
    orgId: string;
    threadId: string;
    userId: string;
    chatMessageId?: Id<"threadMessages">;
    referencedMailboxIds?: Id<"connectedEmailAccounts">[];
  },
  org?: Record<string, unknown>,
) {
  return {
    lookup_policy: {
      ...lookupPolicy,
      execute: async (params: {
        query: string;
        policyType?: string;
        carrier?: string;
      }) => {
        const policies = await ctx.runQuery(internal.policies.listAllInternal, {
          orgId: args.orgId,
        });
        const scored = policies
          .map((p: Record<string, unknown>) => ({
            policy: p,
            score: policySearchScore(
              p,
              params.query,
              params.policyType,
              params.carrier,
            ),
          }))
          .filter((p: { score: number }) => p.score > 0)
          .sort(
            (a: { score: number }, b: { score: number }) => b.score - a.score,
          );
        const matches =
          scored.length > 0
            ? scored.map((s: { policy: Record<string, unknown> }) => s.policy)
            : policies.slice(0, 5);
        if (matches.length === 0)
          return "No policies found for this organization.";

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
            name: c.name,
            limit: c.limit,
            deductible: c.deductible,
          })),
        }));
      },
    },
    compare_coverages: {
      ...compareCoverages,
      execute: async (params: { policyId1: string; policyId2: string }) => {
        const policies = await ctx.runQuery(internal.policies.listAllInternal, {
          orgId: args.orgId,
        });
        const p1 = policies.find(
          (p: Record<string, unknown>) => p._id === params.policyId1,
        );
        const p2 = policies.find(
          (p: Record<string, unknown>) => p._id === params.policyId2,
        );
        if (!p1 || !p2) return "One or both policies not found.";
        const mapPolicy = (p: any) => ({
          id: p._id,
          carrier: p.security,
          type: p.policyTypes,
          limits: p.limits,
          deductibles: p.deductibles,
          premium: p.premium,
          coverages: (p.coverages ?? []).map((c: any) => ({
            name: c.name,
            limit: c.limit,
            deductible: c.deductible,
          })),
        });
        return { policy1: mapPolicy(p1), policy2: mapPolicy(p2) };
      },
    },
    lookup_compliance_requirements: {
      ...lookupComplianceRequirements,
      execute: async (params: {
        query?: string;
        appliesTo?: "vendors" | "own_org" | "both" | "all";
      }) => {
        const requirements = await ctx.runQuery(
          internal.compliance.listRequirementsInternal,
          { orgId: args.orgId },
        );
        const matches = filterComplianceRequirements(requirements, params);
        if (matches.length === 0) {
          return "No matching compliance requirements found. Vendor/contractor requirements and internal requirements are stored separately.";
        }
        return matches.map(formatComplianceRequirement).join("\n");
      },
    },
    ...buildVendorComplianceTools(ctx, [args.orgId]),
    lookup_policy_section: {
      ...lookupPolicySection,
      execute: async (params: { policyId: string; query: string }) => {
        const policy: any = await ctx.runQuery(internal.policies.getInternal, {
          id: params.policyId,
        });
        // Enforce org ownership — prevent cross-org policy access
        try {
          assertOrgOwnership(policy, args.orgId, "Policy");
        } catch {
          return "Policy not found.";
        }
        return searchPolicyDocumentWithSourceSpans(
          ctx,
          policy,
          params.query,
          8,
        );
      },
    },
    save_note: {
      ...saveNote,
      execute: async (params: {
        content: string;
        type: string;
        policyId?: string;
      }) => {
        const typeMap: Record<
          string,
          "fact" | "preference" | "risk_note" | "observation"
        > = {
          fact: "fact",
          preference: "preference",
          risk_note: "risk_note",
          observation: "observation",
        };
        const memoryType = typeMap[params.type] ?? "observation";
        await ctx.runMutation(internal.orgMemory.upsert, {
          orgId: args.orgId,
          type: memoryType,
          content: params.content,
          source: "chat" as const,
          policyId: params.policyId as Id<"policies"> | undefined,
        });
        return "Note saved to organization memory.";
      },
    },
    attach_policy_document: {
      ...attachPolicyDocument,
      execute: async (input: { policyId: string }) => {
        const policy: any = await ctx.runQuery(internal.policies.getInternal, {
          id: input.policyId as Id<"policies">,
        });
        try {
          assertOrgOwnership(policy, args.orgId, "Policy");
        } catch {
          return "Policy not found.";
        }
        if (!policy.fileId) {
          return "That policy does not have an original PDF file available.";
        }
        return {
          message: "Original policy PDF attached to this response.",
          policyId: policy._id,
          attachment: {
            filename: policy.fileName ?? `${policy.policyNumber ?? "policy"}.pdf`,
            contentType: "application/pdf",
            size: 0,
            fileId: policy.fileId as Id<"_storage">,
          },
        };
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
        const policy: any = await ctx.runQuery(internal.policies.getInternal, {
          id: params.policyId as Id<"policies">,
        });
        try {
          assertOrgOwnership(policy, args.orgId, "Policy");
        } catch {
          return "Policy not found.";
        }
        try {
          const result = await ctx.runMutation(
            internal.policies.confirmPolicyFactFromSource,
            {
              id: params.policyId as Id<"policies">,
              orgId: args.orgId as Id<"organizations">,
              userId: args.userId as Id<"users">,
              fact: params.fact,
              sourceSpanIds: params.sourceSpanIds,
              source: "chat",
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
      ...generateCoi,
      execute: async (input: {
        policyId: string;
        certificateHolder?: string;
      }) => {
        // Check org settings — autoGenerateCoi defaults to true if not set
        const autoGenerate = org?.autoGenerateCoi !== false;
        if (!autoGenerate) {
          const handling = org?.coiHandling ?? "ignore";
          if (handling === "broker") {
            return `COI auto-generation is off. Please contact your broker to obtain this certificate.`;
          }
          if (handling === "member") {
            return `COI auto-generation is off. Please route this COI request to your primary insurance contact.`;
          }
          return `COI auto-generation is disabled for this organization.`;
        }
        try {
          const generated = await ctx.runAction(
            internal.actions.generateCoi.run,
            {
              policyId: input.policyId as Id<"policies">,
              orgId: args.orgId,
              certificateHolder: input.certificateHolder,
              certificateHolderName:
                input.certificateHolder?.split(/\r?\n/)[0]?.trim() || undefined,
              source: "chat",
              createdByUserId: args.userId as Id<"users">,
            },
          );
          if (!generated) return COI_GENERATION_FAILED_MESSAGE;
          return {
            message: "COI generated and attached to this response.",
            attachment: {
              filename: generated.fileName,
              contentType: "application/pdf",
              size: generated.size,
              fileId: generated.storageId as Id<"_storage">,
            },
          };
        } catch (err) {
          logAiError("processThreadChat.generateCoi", err, {
            threadId: args.threadId,
            orgId: args.orgId,
            policyId: input.policyId,
          });
          return COI_GENERATION_FAILED_MESSAGE;
        }
      },
    },
    create_policy_change_request: {
      ...createPolicyChangeRequest,
      execute: async (input: {
        requestKind?: PceRequestKind;
        requestText: string;
        policyId?: string;
        evidenceSourceIds?: string[];
      }) => {
        try {
          const intake = evaluatePceIntake({
            requestKind: input.requestKind,
            requestText: input.requestText,
          });
          if (!intake.allowed) return intake.message;

          const result = await ctx.runAction(
            internal.actions.policyChangeRequests.createFromChatForThread,
            {
              orgId: args.orgId as Id<"organizations">,
              userId: args.userId as Id<"users">,
              policyId: input.policyId as Id<"policies"> | undefined,
              requestText: input.requestText,
              evidenceSourceIds: input.evidenceSourceIds,
            },
          );
          if (result?.error) return result.error;
          return {
            message: "Policy change request created.",
            caseId: result.caseId,
            requestKind: intake.kind,
            usedSdkPce: result.usedSdkPce,
          };
        } catch (err) {
          return `Failed to create policy change request: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    create_imessage_group_chat: {
      ...createImessageGroupChat,
      execute: async (input: {
        recipients: string[];
        openingMessage: string;
        title?: string;
        confirmed: boolean;
      }) => {
        if (!input.confirmed) {
          return "Ask the user to confirm before creating a new iMessage group chat.";
        }
        return await ctx.runAction(
          internal.actions.createOutboundImessageGroup.createOutboundImessageGroupInternal,
          {
            orgId: args.orgId as Id<"organizations">,
            userId: args.userId as Id<"users">,
            recipients: input.recipients,
            openingMessage: input.openingMessage,
            title: input.title,
          },
        );
      },
    },
    coordinate_mailbox_task: {
      ...coordinateMailboxTask,
      execute: async (input: { task: string }) => {
        return await ctx.runAction(internal.actions.mailboxCoordinator.runInternal, {
          orgId: args.orgId as Id<"organizations">,
          userId: args.userId as Id<"users">,
          task: input.task,
          accountIds: args.referencedMailboxIds,
          chatMessageId: args.chatMessageId,
          threadId: args.threadId as Id<"threads">,
        });
      },
    },
    render_email_preview: {
      ...renderEmailPreview,
      execute: async (input: { draftId?: string; format?: "png" | "pdf" }) => {
        return await ctx.runAction(internal.actions.renderEmailPreview.run, {
          orgId: args.orgId as Id<"organizations">,
          threadId: args.threadId as Id<"threads">,
          userId: args.userId as Id<"users">,
          draftId: input.draftId as Id<"pendingEmails"> | undefined,
          format: input.format,
        });
      },
    },
  };
}

export const run = internalAction({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userMessageId: v.id("threadMessages"),
  },
  handler: async (ctx, args) => {
    const startingMessages = await ctx.runQuery(
      internal.threads.messagesInternal,
      { threadId: args.threadId },
    );
    const latestUserMessage = startingMessages
      .filter((message: Record<string, unknown>) => message.role === "user")
      .at(-1);
    if (String(latestUserMessage?._id ?? "") !== String(args.userMessageId)) return;

    // Claim one agent response for this user message before any model calls.
    // This prevents duplicate scheduled actions from producing two assistant replies.
    const claim = await ctx.runMutation(internal.threads.claimAgentResponse, {
      threadId: args.threadId,
      orgId: args.orgId,
      userMessageId: args.userMessageId,
    });
    if (!claim.claimed) return;
    const agentMsgId = claim.messageId;
    let lastCancellationCheck = 0;
    const isAgentResponseCancelled = async (force = false) => {
      const now = dayjs().valueOf();
      if (!force && now - lastCancellationCheck < 500) return false;
      lastCancellationCheck = now;
      const agentMessage = await ctx.runQuery(internal.threads.getMessageInternal, {
        id: agentMsgId,
      });
      return agentMessage?.status === "cancelled";
    };

    try {
      // ── Check for cancel/undo intent targeting a pending email ──
      // First check if there are any pending emails in this thread
      const pendingEmails = await ctx.runQuery(
        internal.pendingEmails.findPendingByThread,
        { threadId: args.threadId },
      );
      const draftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId: args.threadId, orgId: args.orgId },
      ) as Array<{ _id: Id<"pendingEmails"> }>;
      const latestCancelledEmail = await ctx.runQuery(
        internal.pendingEmails.findLatestCancelledByThread,
        { threadId: args.threadId, orgId: args.orgId },
      );
      const userMsg = await ctx.runQuery(internal.threads.getMessageInternal, {
        id: args.userMessageId,
      });
      const text = userMsg?.content.trim() ?? "";
      const threadMessagesForIntent = await ctx.runQuery(
        internal.threads.messagesInternal,
        { threadId: args.threadId },
      ) as Array<{ _id: Id<"threadMessages">; role: string; content: string; status?: string }>;
      const previousAgentMessage = threadMessagesForIntent
        .filter((message) => message._id !== agentMsgId && message._id !== args.userMessageId)
        .filter((message) => message.role === "agent" && message.content)
        .at(-1);
      const isCancelConfirmationContext = isPendingEmailCancelConfirmationPrompt(
        previousAgentMessage?.content,
      );
      const approvalWords =
        /^(yes|yep|yeah|ok|okay|approved|approve|confirmed|confirm|send|send it|looks good|this is good|go ahead|do it|please send)\.?!?$/i;

      if (
        latestCancelledEmail &&
        text.length < 100 &&
        isPendingEmailRestoreIntent(text)
      ) {
        const restored = await ctx.runMutation(
          internal.pendingEmails.restoreAsDraftInternal,
          { id: latestCancelledEmail._id },
        );
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content: restored
            ? "Email restored as a draft. Review it in the email draft card."
            : "I couldn't restore that email.",
          pendingEmailId: restored?.id,
        });
        return;
      }

      if (
        draftEmails.length > 0 &&
        text.length < 100 &&
        isCancelConfirmationContext &&
        isPendingEmailCancelConfirmation(text)
      ) {
        for (const draftEmail of draftEmails) {
          await ctx.runMutation(internal.pendingEmails.cancelInternal, {
            id: draftEmail._id,
          });
        }
        await ctx.runMutation(internal.threads.deleteMessageInternal, {
          id: agentMsgId,
        });
        return;
      }

      if (draftEmails.length > 0 && text.length < 100 && isPendingEmailCancelIntent(text)) {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content: pendingEmailCancelConfirmationMessage("draft", draftEmails.length),
        });
        return;
      }

      if (draftEmails.length > 0 && text.length < 100 && approvalWords.test(text)) {
        try {
          for (const draftEmail of draftEmails) {
            await ctx.runAction(
              internal.actions.sendPendingEmail.sendDraftInternal,
              { id: draftEmail._id },
            );
          }
          await ctx.runMutation(internal.threads.deleteMessageInternal, {
            id: agentMsgId,
          });
          return;
        } catch (err) {
          await ctx.runMutation(internal.threads.updateAgentError, {
            id: agentMsgId,
            error: err instanceof Error ? err.message : String(err),
            content: draftEmails.length === 1
              ? "Failed to send the draft email."
              : "Failed to send one or more draft emails.",
          });
          return;
        }
      }

      if (pendingEmails.length > 0) {
        if (
          text.length < 100 &&
          isCancelConfirmationContext &&
          isPendingEmailCancelConfirmation(text)
        ) {
          let cancelledCount = 0;
          for (const pe of pendingEmails) {
            const ok = await ctx.runMutation(
              internal.pendingEmails.cancelInternal,
              { id: pe._id },
            );
            if (ok) cancelledCount++;
          }
          if (cancelledCount > 0) {
            await ctx.runMutation(internal.threads.updateAgentMessage, {
              id: agentMsgId,
              content:
                cancelledCount === 1
                  ? "Done - email cancelled."
                  : `Done - ${cancelledCount} pending emails cancelled.`,
            });
            return;
          }
        }
        if (text.length < 100 && isPendingEmailCancelIntent(text)) {
          await ctx.runMutation(internal.threads.updateAgentMessage, {
            id: agentMsgId,
            content: pendingEmailCancelConfirmationMessage(
              "pending",
              pendingEmails.length,
            ),
          });
          return;
        }
      }

      // Load org
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: args.orgId,
      });
      if (!org) throw new Error("Organization not found");

      // ── Prompt injection guard ──
      const userMsgForGuard = await ctx.runQuery(
        internal.threads.getMessageInternal,
        {
          id: args.userMessageId,
        },
      );
      if (userMsgForGuard?.content) {
        const sanitizedContent = enforceInputLimits(userMsgForGuard.content);
        const injectionCheck = await classifyPromptInjection(sanitizedContent);
        if (!injectionCheck.safe) {
          await ctx.runMutation(internal.threads.updateAgentMessage, {
            id: agentMsgId,
            content:
              "I can't process this request. Please rephrase your question about insurance policies or coverage.",
          });
          console.warn("[security] Prompt injection blocked", {
            threadId: args.threadId,
            reason: injectionCheck.reason,
          });
          return;
        }
      }

      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: args.orgId,
      });
      const selectedPolicyIds = new Set<string>(
        ((userMsgForGuard?.referencedPolicyIds as string[] | undefined) ?? []),
      );
      const selectedQuoteIds = new Set<string>(
        ((userMsgForGuard?.referencedQuoteIds as string[] | undefined) ?? []),
      );
      const selectedRequirementIds = new Set<string>(
        ((userMsgForGuard?.referencedRequirementIds as string[] | undefined) ?? []),
      );
      const referencedMailboxIds = ((userMsgForGuard?.referencedMailboxIds as
        | Id<"connectedEmailAccounts">[]
        | undefined) ?? []);

      // Get sender name
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: args.userId,
      });
      const userName = user?.name?.split(/\s+/)[0];

      const siteUrl = getPortalUrlForOrg(org);

      // Build system prompt (reuse direct mode)
      const systemPrompt = buildSystemPromptForContext({
        org,
        mode: "direct",
        userName,
        siteUrl,
      });

      // Load thread messages for history
      const allMessages = await ctx.runQuery(
        internal.threads.messagesInternal,
        { threadId: args.threadId },
      );

      // Find the latest user message for context
      const latestUserMsg = allMessages
        .filter((m: Record<string, unknown>) => m.role === "user")
        .pop();
      const latestUserContent = latestUserMsg?.content ?? "";
      const policyDocs = (policies as any[]).filter((policy) => policy.documentType !== "quote");
      const quoteDocs = (policies as any[]).filter((policy) => policy.documentType === "quote");
      const focusedPolicyDocs = selectedPolicyIds.size > 0
        ? policyDocs.filter((policy) => selectedPolicyIds.has(String(policy._id)))
        : policyDocs;
      const focusedQuoteDocs = selectedQuoteIds.size > 0
        ? quoteDocs.filter((quote) => selectedQuoteIds.has(String(quote._id)))
        : quoteDocs;

      // Build document context (vector search with fallback)
      const {
        context: docContext,
        relevantPolicyIds,
        relevantQuoteIds,
      } = await buildDocumentContext(
        ctx,
        args.orgId,
        focusedPolicyDocs,
        focusedQuoteDocs,
        latestUserContent,
      );

      // Cross-thread conversation memory (vector search)
      const memoryContext = await buildConversationMemoryContext(
        ctx,
        args.orgId,
        latestUserContent,
      );

      // Load business intelligence (vector search, deduped against policy context)
      const orgMemoryBlock = await buildIntelligenceContext(
        ctx,
        args.orgId,
        latestUserContent,
        relevantPolicyIds.map((id: string) => id),
      );
      const requirementsBlock = await buildComplianceRequirementsContext(
        ctx,
        args.orgId,
      );
      const selectedRequirements = selectedRequirementIds.size > 0
        ? (await ctx.runQuery(internal.compliance.listRequirementsInternal, {
            orgId: args.orgId,
          }) as Array<Record<string, unknown>>).filter((requirement) =>
            selectedRequirementIds.has(String(requirement._id)),
          )
        : [];
      const selectedMailboxes = referencedMailboxIds.length > 0
        ? (
            await Promise.all(
              referencedMailboxIds.map((accountId) =>
                ctx.runQuery(internal.connectedEmail.getAccessibleInternal, {
                  accountId,
                  orgId: args.orgId,
                  userId: args.userId,
                }),
              ),
            )
          ).filter(Boolean) as Array<Record<string, unknown>>
        : [];
      const selectedSteeringBlock =
        selectedPolicyIds.size > 0 ||
        selectedQuoteIds.size > 0 ||
        selectedRequirements.length > 0 ||
        selectedMailboxes.length > 0
          ? `\n\nUSER-SELECTED CONTEXT TARGETS:\n${[
              focusedPolicyDocs.length
                ? `Policies:\n${focusedPolicyDocs
                    .map((policy: any) => `- ${policy.carrier || policy.security || "Unknown carrier"} #${policy.policyNumber} (ID:${policy._id})`)
                    .join("\n")}`
                : "",
              focusedQuoteDocs.length
                ? `Quotes:\n${focusedQuoteDocs
                    .map((quote: any) => `- ${quote.carrier || quote.security || "Unknown carrier"} #${quote.quoteNumber || quote.policyNumber} (ID:${quote._id})`)
                    .join("\n")}`
                : "",
              selectedRequirements.length
                ? `Requirements:\n${selectedRequirements
                    .map((requirement: any) => `- ${requirement.title} (${requirement.appliesTo ?? "vendors"}, ID:${requirement._id}): ${String(requirement.requirementText ?? "").slice(0, 500)}`)
                    .join("\n")}`
                : "",
              selectedMailboxes.length
                ? `Mailboxes:\n${selectedMailboxes
                    .map((mailbox: any) => `- ${mailbox.label || mailbox.emailAddress} (${mailbox.emailAddress}, ID:${mailbox._id})`)
                    .join("\n")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n\n")}\nTreat these as explicit user steering. Prioritize them over generic retrieval. If mailbox work is needed and mailboxes are selected, keep the mailbox coordinator scoped to those accounts unless the user asks to broaden the search.`
          : "";

      const complianceRows = await ctx
        .runQuery((internal as any).compliance.listVendorComplianceInternal, {
          clientOrgId: args.orgId,
        })
        .catch(() => []);
      const complianceBlock =
        Array.isArray(complianceRows) && complianceRows.length > 0
          ? `\n\nVENDOR COMPLIANCE SNAPSHOT:\n${complianceRows
              .map((row: any) => {
                const failed = (row.checks ?? []).filter(
                  (check: any) => check.status !== "met",
                );
                return `- ${row.vendorOrg?.name ?? row.vendorOrgId}: ${failed.length === 0 ? "compliant" : `${failed.length} open issue(s)`}`;
              })
              .join("\n")}`
          : "";

      const {
        history: messageHistory,
        latestAttachmentNames,
      } = await buildMessageHistoryWithAttachmentContext(
        ctx,
        allMessages as Array<Record<string, unknown>>,
        latestUserMsg?._id ? String(latestUserMsg._id) : undefined,
      );

      // Detect thread type
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId,
      });
      const hasEmailMessages = allMessages.some(
        (m: Record<string, unknown>) => m.channel === "email",
      );
      const isMixedThread =
        hasEmailMessages || thread?.originChannel === "email";
      const emailIdentity = await resolveEmailAgentIdentity(ctx, org);
      const canSendEmail = emailIdentity.canSend;

      // Web chat addendum — adjust email flow based on autoSendEmails setting
      const autoSend = org.autoSendEmails === true; // default false (require confirmation)
      const webChatAddendum = buildChannelInstructions({
        platform: "web",
        isMixedThread,
        canSendEmail,
        autoSendEmails: autoSend,
      });

      // Page context
      let pageContextBlock = "";
      if (thread?.initialContext) {
        const ic = thread.initialContext;
        if (ic.summary) {
          pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} detail page:\n- ${ic.summary}\n- Prioritize answering questions about this specific ${ic.pageType}. Reference it directly without the user needing to specify which one.\n`;
        } else if (ic.pageType) {
          pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} page.\n`;
        }
      }

      const toolInstructions = buildPolicyToolInstructions(25);

      // Attachment context note
      let attachmentNote = "";
      if (latestUserMsg?.attachments?.length) {
        const filenames = (latestAttachmentNames.length > 0
          ? latestAttachmentNames
          : (latestUserMsg.attachments as Array<{ filename: string }>)
          .map((a) => a.filename)
        )
          .join(", ");
        attachmentNote = `\n\nATTACHMENTS: The user's message includes ${latestUserMsg.attachments.length} attachment(s): ${filenames}. The content has been provided to you as file, image, or text content parts. Reference relevant information from attachments in your response when applicable.`;
      }

      const fullSystemPrompt =
        systemPrompt +
        webChatAddendum +
        pageContextBlock +
        "\n\n" +
        docContext +
        toolInstructions +
        memoryContext +
        orgMemoryBlock +
        requirementsBlock +
        selectedSteeringBlock +
        complianceBlock +
        attachmentNote;

      const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, {
        orgId: args.orgId,
      });
      const orgMemberEmails = orgMembers
        .map((m: any) => m?.email)
        .filter(Boolean) as string[];
      const allowedRecipients = collectAllowedRecipients(
        allMessages as Parameters<typeof collectAllowedRecipients>[0],
        orgMemberEmails,
      );
      const availableAttachments = allMessages.flatMap(
        (m: Record<string, unknown>) =>
          (
            (m.attachments as
              | Array<{
                  filename: string;
                  contentType: string;
                  size: number;
                  fileId?: Id<"_storage">;
                }>
              | undefined) ?? []
          )
            .filter((att) => att.fileId)
            .filter(
              (att) =>
                m.role !== "agent" ||
                !isCoiAttachmentFilename(att.filename),
            )
            .map((att) => ({
              filename: att.filename,
              contentType: att.contentType,
              size: att.size,
              fileId: att.fileId!,
            })),
      );
      const currentDraftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId: args.threadId, orgId: args.orgId },
      );
      const currentDraftContext = currentDraftEmails.length > 0
        ? [
            currentDraftEmails.length === 1
              ? "CURRENT EMAIL DRAFT ARTIFACT:"
              : `CURRENT EMAIL DRAFT ARTIFACTS (${currentDraftEmails.length}):`,
            ...currentDraftEmails.map((draft, index) => [
              currentDraftEmails.length === 1 ? null : `Draft ${index + 1}:`,
              `To: ${draft.recipientEmail}`,
              draft.ccAddresses?.length
                ? `Cc: ${draft.ccAddresses.join(", ")}`
                : null,
              draft.bccAddresses?.length
                ? `Bcc: ${draft.bccAddresses.join(", ")}`
                : null,
              `Subject: ${draft.subject}`,
              draft.attachments?.length
                ? `Attachments: ${draft.attachments.map((a: { filename: string }) => a.filename).join(", ")}`
                : null,
              "",
              draft.emailBody,
            ]
              .filter((line) => line !== null)
              .join("\n")),
          ].join("\n\n")
        : "";
      const emailToolResult: { current: EmailSubagentResult | null } = {
        current: null,
      };

      // streamText with tools — supports both streaming Q&A and tool calls
      const tools = {
        ...buildTools(
          ctx,
          {
            orgId: args.orgId,
            threadId: args.threadId,
            userId: args.userId,
            chatMessageId: agentMsgId,
            referencedMailboxIds,
          },
          org,
        ),
        ...(emailIdentity.canSend &&
        emailIdentity.agentAddress &&
        emailIdentity.fromHeader
          ? {
              email_expert: buildEmailExpertTool(ctx, {
                orgId: args.orgId,
                threadId: args.threadId,
                chatMessageId: agentMsgId,
                channel: "web",
                fromHeader: `${getEmailAgentFromName(emailIdentity.brokerBranding)} <${thread?.threadEmail ?? emailIdentity.agentAddress}>`,
                agentAddress: thread?.threadEmail ?? emailIdentity.agentAddress,
                brokerBranding: emailIdentity.brokerBranding,
                senderEmail: user?.email,
                defaultTo: user?.email,
                defaultRecipientName: user?.name,
                defaultBcc:
                  org.bccRequesterOnAgentEmails !== false && user?.email
                    ? [user.email]
                    : undefined,
                subjectHint:
                  thread?.title && thread.title !== "New chat"
                    ? thread.title
                    : undefined,
                allowedRecipients,
                availableAttachments,
                referencedPolicyIds: relevantPolicyIds as Id<"policies">[],
                referencedQuoteIds: relevantQuoteIds as Id<"policies">[],
                autoSendEmails: org.autoSendEmails === true,
                emailSendDelay: org.emailSendDelay,
                autoGenerateCoi: org.autoGenerateCoi,
                coiHandling: org.coiHandling,
                conversationContext:
                  allMessages
                    .filter(
                      (m: Record<string, unknown>) =>
                        m.status !== "processing" &&
                        m.status !== "cancelled",
                    )
                    .slice(-12)
                    .map(
                      (m: Record<string, unknown>) => `${m.role}: ${m.content}`,
                    )
                    .join("\n") +
                  (currentDraftContext ? `\n\n${currentDraftContext}` : ""),
                onResult: (result) => {
                  emailToolResult.current = result;
                },
              }),
            }
          : {}),
      };
      let content = "";
      let lastFlush = dayjs().valueOf();
      const FLUSH_INTERVAL = 150;

      // Immediately show "Thinking..." by ensuring processing message is visible
      await ctx.runMutation(internal.threads.streamAgentMessage, {
        id: agentMsgId,
        content: "",
      });
      if (await isAgentResponseCancelled(true)) return;

      // Tool call display names for the "thinking" UI
      const TOOL_LABELS: Record<string, string> = {
        lookup_policy: "Searching policies...",
        lookup_policy_section: "Reading policy sections...",
        attach_policy_document: "Attaching policy PDF...",
        compare_coverages: "Comparing coverages...",
        lookup_compliance_requirements: "Checking requirements...",
        lookup_connected_vendors: "Checking vendors...",
        lookup_vendor_policies: "Reading vendor policies...",
        lookup_vendor_compliance: "Checking vendor compliance...",
        send_email: "Drafting email...",
        email_expert: "Preparing email...",
        save_note: "Saving note...",
        confirm_policy_fact: "Confirming policy facts...",
        generate_coi: "Generating COI...",
        create_policy_change_request: "Creating policy change request...",
        create_imessage_group_chat: "Starting iMessage group...",
        coordinate_mailbox_task: "Coordinating mailbox task...",
        render_email_preview: "Rendering email preview...",
      };
      const SUBAGENT_TOOL_NAMES = new Set(["email_expert", "coordinate_mailbox_task"]);

      const chatModel = await getModelAndRouteForOrg(ctx, args.orgId, "chat");
      const startChatStream = (
        model: typeof chatModel.model,
        route: typeof chatModel.route,
      ) =>
        streamText({
          model,
          providerOptions: getProviderOptionsForRoute(route),
          maxOutputTokens: 4096,
          system: fullSystemPrompt,
          messages: messageHistory,
          tools,
          stopWhen: stepCountIs(25),
        });

      let reasoning = "";
      let hasStartedReasoning = false;
      let lastReasoningFlush = dayjs().valueOf();
      const citedSections = new Set<string>(); // titles from lookup_policy_section results
      const citedCoverageNames = new Set<string>(); // structured coverage names surfaced by tool results
      const citedSourceSpanIds = new Set<string>(); // stable raw evidence IDs surfaced by tool results
      const citedPolicyIds = new Set<string>(); // policy IDs actually looked up via lookup_policy_section
      const usedTools: string[] = [];
      const toolCalls: Array<{ name: string; input?: string; output?: string }> = [];
      const toolArtifacts: Array<{ type: string; data: unknown }> = [];
      const responseAttachments: Array<{
        filename: string;
        contentType: string;
        size: number;
        fileId?: Id<"_storage">;
      }> = [];
      let policyChangeCaseId: Id<"policyChangeCases"> | undefined;
      let lastToolName = "";
      let lastToolPolicyId = "";

      const resetStreamStateForRetry = async () => {
        content = "";
        reasoning = "";
        hasStartedReasoning = false;
        lastFlush = dayjs().valueOf();
        lastReasoningFlush = dayjs().valueOf();
        await ctx.runMutation(internal.threads.streamAgentMessage, {
          id: agentMsgId,
          content: "",
        });
        await ctx.runMutation(internal.threads.streamReasoning, {
          id: agentMsgId,
          reasoning: "",
        });
      };

      const serializeToolOutput = (output: unknown) => {
        if (typeof output === "string") return output.slice(0, 4000);
        try {
          return JSON.stringify(output, null, 2).slice(0, 4000);
        } catch {
          return String(output).slice(0, 4000);
        }
      };

      const consumeChatStream = async (fullStream: AsyncIterable<any>) => {
        for await (const part of fullStream) {
          if (await isAgentResponseCancelled()) return false;
          if (part.type === "error") {
            throw part;
          } else if (part.type === "reasoning-delta") {
            // Stream reasoning separately from content
            reasoning +=
              ((part as Record<string, unknown>).text as string) ??
              ((part as Record<string, unknown>).delta as string) ??
              "";
            if (!hasStartedReasoning) {
              hasStartedReasoning = true;
            }
            // Flush reasoning periodically
            const now = dayjs().valueOf();
            if (now - lastReasoningFlush >= FLUSH_INTERVAL) {
              lastReasoningFlush = now;
              await ctx.runMutation(internal.threads.streamReasoning, {
                id: agentMsgId,
                reasoning,
              });
            }
          } else if (part.type === "text-delta") {
            content += part.text;
            const now = dayjs().valueOf();
            if (now - lastFlush >= FLUSH_INTERVAL) {
              lastFlush = now;
              await ctx.runMutation(internal.threads.streamAgentMessage, {
                id: agentMsgId,
                content,
              });
            }
          } else if (part.type === "tool-call") {
            lastToolName = part.toolName;
            const input =
              ((part as Record<string, unknown>).input as
                | Record<string, unknown>
                | undefined) ?? undefined;
            lastToolPolicyId =
              part.toolName === "lookup_policy_section"
                ? ((input?.policyId as string) ?? "")
                : "";
            usedTools.push(part.toolName);
            toolCalls.push({
              name: part.toolName,
              input: input ? JSON.stringify(input).slice(0, 500) : undefined,
            });
            const label =
              TOOL_LABELS[part.toolName] ?? `Using ${part.toolName}...`;
            await ctx.runMutation(internal.threads.streamAgentMessage, {
              id: agentMsgId,
              content: content ? content + `\n\n*${label}*` : `*${label}*`,
            });
          } else if (part.type === "tool-result") {
            const output = (part as Record<string, unknown>).output;
            let lastToolCall:
              | { name: string; input?: string; output?: string }
              | undefined;
            for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
              const candidate = toolCalls[i];
              if (candidate.name === lastToolName && !candidate.output) {
                lastToolCall = candidate;
                break;
              }
            }
            if (lastToolCall && SUBAGENT_TOOL_NAMES.has(lastToolName)) {
              lastToolCall.output = serializeToolOutput(output);
            }
            if (
              (lastToolName === "generate_coi" ||
                lastToolName === "attach_policy_document" ||
                lastToolName === "render_email_preview") &&
              output
            ) {
              if (
                output &&
                typeof output === "object" &&
                "attachment" in output
              ) {
                const attachment = (output as Record<string, unknown>).attachment;
                if (attachment && typeof attachment === "object") {
                  responseAttachments.push(
                    attachment as {
                      filename: string;
                      contentType: string;
                      size: number;
                      fileId?: Id<"_storage">;
                    },
                  );
                }
              }
            }
            if (
              lastToolName === "create_policy_change_request" &&
              (part as Record<string, unknown>).output
            ) {
              const output = (part as Record<string, unknown>).output;
              if (output && typeof output === "object" && "caseId" in output) {
                const caseId = (output as Record<string, unknown>).caseId;
                if (typeof caseId === "string" && caseId) {
                  policyChangeCaseId = caseId as Id<"policyChangeCases">;
                }
              }
            }
          if (
            lastToolName === "lookup_vendor_compliance" &&
            (part as Record<string, unknown>).output
          ) {
            toolArtifacts.push({
              type: "vendor_compliance",
              data: (part as Record<string, unknown>).output,
            });
          }
            if (
              lastToolName === "coordinate_mailbox_task" &&
              (part as Record<string, unknown>).output
            ) {
              toolArtifacts.push({
                type: "mailbox_task",
                data: (part as Record<string, unknown>).output,
              });
            }
            // Capture cited section titles and policy IDs from lookup_policy_section results
            if (
              lastToolName === "lookup_policy_section" &&
              (part as Record<string, unknown>).output
            ) {
              const output = (part as Record<string, unknown>).output;
              const results = Array.isArray(output) ? output : [output];
              for (const r of results) {
                if (r && typeof r === "object" && r.title) {
                  const resultType = (r as Record<string, unknown>).type;
                  if (resultType === "coverage") {
                    citedCoverageNames.add(
                      String((r as Record<string, unknown>).title),
                    );
                    if (lastToolPolicyId) citedPolicyIds.add(lastToolPolicyId);
                  } else {
                    citedSections.add(
                      String((r as Record<string, unknown>).title),
                    );
                    if (lastToolPolicyId) citedPolicyIds.add(lastToolPolicyId);
                  }
                  const sourceSpanIds = (r as Record<string, unknown>)
                    .sourceSpanIds;
                  if (Array.isArray(sourceSpanIds)) {
                    for (const id of sourceSpanIds) {
                      if (typeof id === "string" && id)
                        citedSourceSpanIds.add(id);
                    }
                  }
                }
              }
            }
            // Clear the tool label but keep accumulated content
            await ctx.runMutation(internal.threads.streamAgentMessage, {
              id: agentMsgId,
              content: content || "",
            });
          }
        }
        return true;
      };

      try {
        const completed = await consumeChatStream(
          startChatStream(chatModel.model, chatModel.route).fullStream,
        );
        if (!completed) return;
      } catch (streamError) {
        const hasStartedSideEffectfulWork =
          usedTools.length > 0 ||
          toolCalls.length > 0 ||
          toolArtifacts.length > 0 ||
          responseAttachments.length > 0 ||
          !!policyChangeCaseId;
        if (
          !isTransientChatStreamError(streamError) ||
          hasStartedSideEffectfulWork
        ) {
          throw streamError;
        }

        const fallbackRoute = fallbackRouteForCall({
          task: "chat",
          taskKind: "query_reason",
          primaryRoute: chatModel.route,
        });
        const retryRoute = fallbackRoute ?? chatModel.route;
        const retryModel = fallbackRoute
          ? getModelForRoute(fallbackRoute)
          : chatModel.model;
        console.warn(
          `[processThreadChat] Retrying chat stream after transient provider error on ${chatModel.route.provider}:${chatModel.route.model}; retrying with ${retryRoute.provider}:${retryRoute.model}. ${errorText(streamError)}`,
        );
        await resetStreamStateForRetry();
        const completed = await consumeChatStream(startChatStream(retryModel, retryRoute).fullStream);
        if (!completed) return;
      }

      if (await isAgentResponseCancelled(true)) return;

      // Final update — save content, reasoning, and cited sections
      const completedCoiEmailSideEffect =
        usedTools.includes("email_expert") ||
        usedTools.includes("generate_coi") ||
        responseAttachments.some((attachment) =>
          /certificate[-_\s]?of[-_\s]?insurance|coi/i.test(
            attachment.filename,
          ),
        );
      if (
        hasCoiEmailIntent(latestUserContent) &&
        claimsCoiEmailCompletion(content) &&
        !completedCoiEmailSideEffect
      ) {
        content =
          "I haven't generated or emailed those COIs yet. I need to create the certificates and send the emails before marking this done.";
      }
      if (
        claimsEmailDraftCompletion(content) &&
        !usedTools.includes("email_expert")
      ) {
        content =
          "I haven't created an email draft yet. I can prepare one once the recipient, policy, and attachments are confirmed.";
      }
      const finalReferencedPolicyIds = new Set<string>([
        ...selectedPolicyIds,
        ...citedPolicyIds,
      ]);
      const finalReferencedQuoteIds = new Set<string>([
        ...selectedQuoteIds,
        ...relevantQuoteIds.filter((qid: string) => citedPolicyIds.has(qid)),
      ]);
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: agentMsgId,
        content,
        referencedPolicyIds:
          finalReferencedPolicyIds.size > 0
            ? ([...finalReferencedPolicyIds] as Id<"policies">[])
            : undefined,
        referencedQuoteIds:
          finalReferencedQuoteIds.size > 0
            ? ([...finalReferencedQuoteIds] as Id<"policies">[])
            : undefined,
        citedSections: citedSections.size > 0 ? [...citedSections] : undefined,
        citedCoverageNames:
          citedCoverageNames.size > 0 ? [...citedCoverageNames] : undefined,
        citedSourceSpanIds:
          citedSourceSpanIds.size > 0 ? [...citedSourceSpanIds] : undefined,
        usedTools: usedTools.length > 0 ? usedTools : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolArtifacts: toolArtifacts.length > 0 ? toolArtifacts : undefined,
        attachments:
          responseAttachments.length > 0 ? responseAttachments : undefined,
        policyChangeCaseId,
      });
      const emailResult = emailToolResult.current;
      if (emailResult) {
        if (
          emailResult.pendingEmailId &&
          (emailResult.status === "draft" ||
            emailResult.status === "needs_confirmation")
        ) {
          const recipientText = emailResult.responseTo
            ? ` to ${emailResult.responseTo}`
            : "";
          const draftedCoi = emailResult.attachments?.some((attachment) =>
            /certificate[-_\s]?of[-_\s]?insurance|coi/i.test(
              attachment.filename,
            ),
          );
          const draftNotice = draftedCoi
            ? `I drafted the certificate of insurance email${recipientText}. Review it in the email draft card.`
            : `I drafted the email${recipientText}. Review it in the email draft card.`;
          const nextContent = content.trim()
            ? `${content.trim()}\n\n${draftNotice}`
            : draftNotice;
          await ctx.runMutation(internal.threads.updateAgentMessage, {
            id: agentMsgId,
            content: nextContent,
            pendingEmailId: emailResult.pendingEmailId,
          });
          content = nextContent;
        } else {
          await ctx.runMutation(internal.threads.updateAgentMessage, {
            id: agentMsgId,
            content: emailResult.responseBody,
            pendingEmailId: emailResult.pendingEmailId,
            status:
              emailResult.status === "pending" ? "pending_send" : undefined,
          });
          content = emailResult.responseBody;
        }
      }
      if (
        !emailResult &&
        org.chatEmailNotifications === true &&
        user?.email &&
        content.trim()
      ) {
        try {
          const siteUrl = getPortalUrlForOrg(org);
          const threadUrl = `${siteUrl}/agent/thread/${args.threadId}`;
          const threadLabel =
            thread?.title && thread.title !== "New chat"
              ? thread.title
              : "New chat";
          const subject =
            threadLabel !== "New chat"
              ? `Glass reply: ${threadLabel}`
              : "Glass reply";
          const plainText = `Thread: ${threadLabel}\n\n${stripMarkdown(content)}\n\nView thread: ${threadUrl}`;
          const htmlBody = content
            .split("\n\n")
            .map(
              (p: string) =>
                `<p style="margin:0 0 12px;line-height:1.5">${markdownToHtml(p.replace(/\n/g, "<br>"))}</p>`,
            )
            .join("\n");
          const html = buildEmailShell({
            title: escapeHtml(subject),
            siteUrl,
            bodyHtml: `
<tr><td align="left" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.4;">${escapeHtml(threadLabel)}</p>
</td></tr>
<tr><td style="padding:22px 40px 0 40px;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${htmlBody}</div>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapeHtml(threadUrl)}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;border-radius:999px;padding:11px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;">View thread</a>
</td></tr>`,
          });

          const notification = await sendResendEmail({
            from: getNotificationFromAddress("Glass Notifications"),
            to: user.email,
            subject,
            text: plainText,
            html,
          });
          if (!notification.ok) {
            console.warn(
              "[processThreadChat] Chat email notification failed:",
              notification.error,
            );
          }
        } catch (err) {
          console.warn(
            "[processThreadChat] Chat email notification failed:",
            err,
          );
        }
      }
      // Save final reasoning if any
      if (reasoning) {
        await ctx.runMutation(internal.threads.streamReasoning, {
          id: agentMsgId,
          reasoning,
        });
      }

      await ctx.runMutation(internal.threads.touchThread, {
        threadId: args.threadId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logAiError("processThreadChat", error, {
        threadId: args.threadId,
        orgId: args.orgId,
      });
      await ctx.runMutation(internal.threads.updateAgentError, {
        id: agentMsgId,
        error: message,
        content: FATAL_ACTION_FAILED_MESSAGE,
      });
    }
  },
});
