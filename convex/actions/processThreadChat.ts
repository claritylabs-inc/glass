"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { streamText, stepCountIs, type ModelMessage } from "ai";
import mammoth from "mammoth";
import JSZip from "jszip";
import {
  fallbackRouteForCall,
  generateTextWithFallback,
  getModelAndRouteForOrg,
  getModelForRoute,
  getProviderOptionsForRoute,
} from "../lib/models";
import {
  createImessageGroupChat,
  coordinateMailboxTask,
  webResearch,
  renderEmailPreview,
} from "../lib/chatTools";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import {
  buildConversationMemoryContext,
  buildScopedDocumentContext,
  buildScopedOrgMemoryContext,
  buildScopedRequirementsContext,
  buildScopedVendorComplianceContext,
} from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildBrokerPortfolioSystemPrompt,
  stripMarkdown,
  markdownToHtml,
  buildChannelInstructions,
  buildPolicyToolInstructions,
  buildConfidenceInstructions,
  hasConfidenceMarkers,
  logAiError,
} from "../lib/aiUtils";
import { tryBuildParsedPdfText } from "../lib/liteparsePreprocessor";
import { getNotificationFromAddress, sendResendEmail } from "../lib/resend";
import { buildEmailShell, escapeHtml } from "../lib/emailTemplate";
import { getPortalUrlForOrg } from "../lib/domains";
import {
  formatWebChatAgentMirrorText,
  getImessageOutboundRoute,
  sendIdempotentOutboundImessage,
  storedAttachmentsToImessageOutbound,
} from "../lib/imessageOutbound";
import {
  buildEmailPayload,
  buildEmailSignature,
  buildEmailExpertTool,
  resolveEmailAgentIdentity,
  upsertEmailDraftArtifact,
  type EmailSubagentResult,
} from "../lib/emailSubagent";
import { isBrokerDirectedEmailRequest } from "../lib/emailIntentGuards";
import { isCoiAttachmentFilename } from "../lib/coiAttachmentGuards";
import { type AgentScope } from "../lib/agentScope";
import {
  classifyPromptInjection,
  collectAllowedRecipients,
  enforceInputLimits,
} from "../lib/security";
import { FATAL_ACTION_FAILED_MESSAGE } from "../lib/actionFailures";
import {
  formatCertificateProgramSelectionForModel,
  type CertificateProgramSelection,
} from "../lib/certificateProgramSelection";
import { runWebRetrieval, type WebRetrievalInput } from "../lib/webRetrieval";
import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelConfirmationPrompt,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
  pendingEmailCancelConfirmationMessage,
} from "../lib/emailCancelIntent";
import {
  requirementEvaluationTargetLabel,
  requirementSemantics,
} from "../lib/requirementSemantics";
import {
  isUnsupportedSpreadsheetAttachment,
  isXlsxSpreadsheetAttachment,
  spreadsheetBufferToText,
} from "../lib/spreadsheetText";

function normalizeConfidenceRepair(text: string, fallback: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  const repaired = fenced ? fenced[1].trim() : trimmed;
  return hasConfidenceMarkers(repaired) ? repaired : fallback;
}

function restoreSentenceBoundarySpacing(text: string): string {
  return text
    .replace(/([a-z0-9)\]][.!?])(?=[A-Z])/g, "$1 ")
    .replace(/([a-z0-9)\]][.!?])(?=\[\[(?:g|i|u):[A-Z])/g, "$1 ")
    .replace(/([a-z0-9)\]][.!?]\]\])(?=[A-Z])/g, "$1 ")
    .replace(/([a-z0-9)\]][.!?]\]\])(?=\[\[(?:g|i|u):[A-Z])/g, "$1 ");
}

async function repairMissingConfidenceMarkers({
  content,
  model,
  route,
}: {
  content: string;
  model: Parameters<typeof generateTextWithFallback>[0]["model"];
  route: Awaited<ReturnType<typeof getModelAndRouteForOrg>>["route"];
}): Promise<string> {
  if (!content.trim() || hasConfidenceMarkers(content)) return content;

  const result = await generateTextWithFallback(
    {
      model,
      providerOptions: getProviderOptionsForRoute(route),
      maxOutputTokens: 4096,
      system: `You are a precise Markdown editor for Glass chat answers.

Rewrite the assistant answer by adding confidence markers to factual phrases.
Preserve the original wording, order, Markdown structure, table pipes, headings, numbers, and punctuation. Do not add claims. Do not remove claims.

Use exactly these inline markers:
- [[g:phrase]] for facts directly supported by policy data, retrieved source text, tool results, or provided context.
- [[i:phrase]] for reasonable calculations, deductions, or synthesis from the available information.
- [[u:phrase]] for assumptions, general knowledge, or claims not backed by provided context.

Wrap factual table cell contents too, while preserving the table shape.
Leave purely conversational filler and user-facing questions unwrapped.
Return only the rewritten Markdown. Do not use a code fence.
The rewritten answer is invalid unless it contains at least one confidence marker.`,
      prompt: `Assistant answer to annotate:\n\n${content}`,
    },
    {
      task: "chat",
      taskKind: "query_reason",
      primaryRoute: route,
    },
  );

  return normalizeConfidenceRepair(result.text, content);
}

type DraftEmailForBatchRevision = {
  _id: Id<"pendingEmails">;
  recipientEmail: string;
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject: string;
  emailBody: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    fileId: Id<"_storage">;
  }>;
  referencedPolicyIds?: Id<"policies">[];
  referencedQuoteIds?: Id<"policies">[];
  threadMessageId?: Id<"threadMessages">;
};

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

function normalizeDraftMatchText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@.+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCoiAttachmentName(filename: string): {
  holder?: string;
  policyRef?: string;
} {
  const match = filename.match(
    /^COI\s+-\s+(.+?)\s+-\s+([A-Z0-9][A-Z0-9-]{5,})\.pdf$/i,
  );
  if (!match) return {};
  return {
    holder: match[1]?.trim(),
    policyRef: match[2]?.trim(),
  };
}

function draftRecipientTokens(recipientEmail: string): string[] {
  const normalized = recipientEmail.toLowerCase().trim();
  const localPart = normalized.split("@")[0] ?? "";
  const plusTag = localPart.includes("+")
    ? localPart.split("+").at(-1)
    : localPart;
  return [normalized, localPart, plusTag ?? ""]
    .map((token) => normalizeDraftMatchText(token).replace(/\d+$/g, ""))
    .filter((token) => token.length >= 4);
}

function selectSafeDraftAttachments(
  draft: DraftEmailForBatchRevision,
): DraftEmailForBatchRevision["attachments"] {
  const attachments = draft.attachments ?? [];
  const coiAttachments = attachments.filter((attachment) =>
    isCoiAttachmentFilename(attachment.filename),
  );
  if (coiAttachments.length <= 1) return attachments;

  const tokens = [
    ...draftRecipientTokens(draft.recipientEmail),
    normalizeDraftMatchText(draft.emailBody),
  ].filter((token) => token.length >= 4);
  const matches = coiAttachments.filter((attachment) => {
    const { holder } = parseCoiAttachmentName(attachment.filename);
    const searchable = normalizeDraftMatchText(
      `${attachment.filename} ${holder ?? ""}`,
    );
    return tokens.some((token) => searchable.includes(token));
  });

  return matches.length === 1 ? [matches[0]] : [];
}

function buildElaboratedCoiDraftBody(params: {
  draft: DraftEmailForBatchRevision;
  attachments: DraftEmailForBatchRevision["attachments"];
  coveredName: string;
}) {
  const attachment = params.attachments?.find((candidate) =>
    isCoiAttachmentFilename(candidate.filename),
  );
  const parsed = attachment ? parseCoiAttachmentName(attachment.filename) : {};
  const holder =
    parsed.holder ??
    params.draft.emailBody
      .match(/for\s+(.+?)\s+for\s+Sentinel/i)?.[1]
      ?.trim() ??
    "the listed certificate holder";
  const policyRef =
    parsed.policyRef ??
    params.draft.emailBody.match(/#([A-Z0-9][A-Z0-9-]{5,})/i)?.[1]?.trim() ??
    "the referenced policy";

  return [
    `Attached is the Certificate of Insurance for ${holder}.`,
    "",
    `The certificate is for Sentinel Pacific Specialty Insurance Company policy #${policyRef} and reflects coverage for ${params.coveredName}.`,
  ].join("\n");
}

function isMultiDraftElaborationRequest(text: string): boolean {
  return (
    /\b(email|draft)s?\b/i.test(text) &&
    /\b(elaborate|revise|update|edit|change|mention|include|add)\b/i.test(
      text,
    ) &&
    /\b(holder|certificate|coi|covering|covers|policy)\b/i.test(text) &&
    !/\b(send|cancel|delete|remove)\b/i.test(text)
  );
}

function isTextLikeAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("csv") ||
    type.includes("json") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".tsv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".json")
  );
}

function isPdfAttachment(filename: string, contentType: string) {
  return (
    contentType.toLowerCase().includes("pdf") ||
    filename.toLowerCase().endsWith(".pdf")
  );
}

function isImageAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type.startsWith("image/") ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".gif") ||
    lowerName.endsWith(".webp")
  );
}

function isDocxAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return type.includes("wordprocessingml") || lowerName.endsWith(".docx");
}

function isPresentationAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return type.includes("presentationml") || lowerName.endsWith(".pptx");
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

async function docxBufferToText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({
    arrayBuffer: bufferToArrayBuffer(buffer),
  });
  return result.value.trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function pptxBufferToText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => {
      const aNum = Number(a.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      const bNum = Number(b.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      return aNum - bNum;
    });
  const slides: string[] = [];
  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("text");
    const texts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlEntities(match[1] ?? "").trim())
      .filter(Boolean);
    if (!texts.length) continue;
    const slideNumber =
      path.match(/slide(\d+)\.xml$/i)?.[1] ?? String(slides.length + 1);
    slides.push(`Slide ${slideNumber}\n${texts.join("\n")}`);
  }
  return slides.join("\n\n");
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

      if (isPdfAttachment(att.filename, att.contentType)) {
        if (!options.includeRichParts) continue;
        const parsedPdfText = await tryBuildParsedPdfText({
          pdfBytes: buffer,
          documentId: att.fileId,
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
            data: buffer.toString("base64"),
            mediaType: "application/pdf",
          });
        }
        names.push(att.filename);
      } else if (isImageAttachment(att.filename, att.contentType)) {
        if (!options.includeRichParts) continue;
        const mediaType = att.contentType.startsWith("image/")
          ? att.contentType
          : att.filename.toLowerCase().endsWith(".png")
            ? "image/png"
            : att.filename.toLowerCase().endsWith(".gif")
              ? "image/gif"
              : att.filename.toLowerCase().endsWith(".webp")
                ? "image/webp"
                : "image/jpeg";
        parts.push({
          type: "image",
          image: buffer.toString("base64"),
          mediaType,
        });
        names.push(att.filename);
      } else if (isXlsxSpreadsheetAttachment(att.filename, att.contentType)) {
        const text = await spreadsheetBufferToText(buffer);
        const remaining = options.remainingTextChars.value;
        if (remaining <= 0 || !text.trim()) continue;
        const clipped =
          text.length > remaining ? text.slice(0, remaining) : text;
        options.remainingTextChars.value -= clipped.length;
        const suffix =
          clipped.length < text.length
            ? "\n--- Spreadsheet attachment truncated for context ---"
            : "";
        parts.push({
          type: "text",
          text: `--- Spreadsheet attachment: ${att.filename} ---\n${clipped}${suffix}\n--- End spreadsheet attachment ---`,
        });
        names.push(att.filename);
      } else if (
        isUnsupportedSpreadsheetAttachment(att.filename, att.contentType)
      ) {
        parts.push({
          type: "text",
          text: `--- Unsupported spreadsheet attachment: ${att.filename} ---\nThis spreadsheet was not read. Glass currently reads .xlsx and text-based CSV/TSV attachments for chat context; please re-upload this file as .xlsx, .csv, or .tsv.\n--- End unsupported spreadsheet attachment ---`,
        });
        names.push(att.filename);
      } else if (isDocxAttachment(att.filename, att.contentType)) {
        const text = await docxBufferToText(buffer);
        const remaining = options.remainingTextChars.value;
        if (remaining <= 0 || !text.trim()) continue;
        const clipped =
          text.length > remaining ? text.slice(0, remaining) : text;
        options.remainingTextChars.value -= clipped.length;
        const suffix =
          clipped.length < text.length
            ? "\n--- DOCX attachment truncated for context ---"
            : "";
        parts.push({
          type: "text",
          text: `--- DOCX attachment: ${att.filename} ---\n${clipped}${suffix}\n--- End DOCX attachment ---`,
        });
        names.push(att.filename);
      } else if (isPresentationAttachment(att.filename, att.contentType)) {
        const text = await pptxBufferToText(buffer);
        const remaining = options.remainingTextChars.value;
        if (remaining <= 0 || !text.trim()) continue;
        const clipped =
          text.length > remaining ? text.slice(0, remaining) : text;
        options.remainingTextChars.value -= clipped.length;
        const suffix =
          clipped.length < text.length
            ? "\n--- PPTX attachment truncated for context ---"
            : "";
        parts.push({
          type: "text",
          text: `--- PPTX attachment: ${att.filename} ---\n${clipped}${suffix}\n--- End PPTX attachment ---`,
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
      const pendingSelections = Array.isArray(msg.toolArtifacts)
        ? (msg.toolArtifacts as Array<{ type?: string; data?: unknown }>)
            .filter(
              (artifact) => artifact.type === "certificate_program_selection",
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
      history.push({
        role: "assistant",
        content: selectionContext
          ? `${content}\n\n${selectionContext}`
          : content,
      });
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
    /\b(done|sent|sending|emailing|delivering|generated|attached)\b/i.test(text)
  );
}

function claimsEmailDraftCompletion(text: string): boolean {
  return /\b(drafted|prepared)\b[\s\S]{0,80}\bemail\b/i.test(text);
}

export const run = internalAction({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userMessageId: v.id("threadMessages"),
    agentMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const startingMessages = await ctx.runQuery(
      internal.threads.messagesInternal,
      { threadId: args.threadId },
    );
    const latestUserMessage = startingMessages
      .filter((message: Record<string, unknown>) => message.role === "user")
      .at(-1);
    if (String(latestUserMessage?._id ?? "") !== String(args.userMessageId))
      return;

    // Claim one agent response for this user message before any model calls.
    // This prevents duplicate scheduled actions from producing two assistant replies.
    const claim = await ctx.runMutation(internal.threads.claimAgentResponse, {
      threadId: args.threadId,
      orgId: args.orgId,
      userMessageId: args.userMessageId,
      agentMessageId: args.agentMessageId,
    });
    if (!claim.claimed) return;
    const agentMsgId = claim.messageId;
    let lastCancellationCheck = 0;
    const isAgentResponseCancelled = async (force = false) => {
      const now = dayjs().valueOf();
      if (!force && now - lastCancellationCheck < 500) return false;
      lastCancellationCheck = now;
      const agentMessage = await ctx.runQuery(
        internal.threads.getMessageInternal,
        {
          id: agentMsgId,
        },
      );
      return agentMessage?.status === "cancelled";
    };

    try {
      // ── Check for cancel/undo intent targeting a pending email ──
      // First check if there are any pending emails in this thread
      const pendingEmails = await ctx.runQuery(
        internal.pendingEmails.findPendingByThread,
        { threadId: args.threadId },
      );
      const draftEmails = (await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId: args.threadId, orgId: args.orgId },
      )) as Array<{ _id: Id<"pendingEmails"> }>;
      const latestCancelledEmail = await ctx.runQuery(
        internal.pendingEmails.findLatestCancelledByThread,
        { threadId: args.threadId, orgId: args.orgId },
      );
      const userMsg = await ctx.runQuery(internal.threads.getMessageInternal, {
        id: args.userMessageId,
      });
      const text = userMsg?.content.trim() ?? "";
      const threadMessagesForIntent = (await ctx.runQuery(
        internal.threads.messagesInternal,
        { threadId: args.threadId },
      )) as Array<{
        _id: Id<"threadMessages">;
        role: string;
        content: string;
        status?: string;
      }>;
      const previousAgentMessage = threadMessagesForIntent
        .filter(
          (message) =>
            message._id !== agentMsgId && message._id !== args.userMessageId,
        )
        .filter((message) => message.role === "agent" && message.content)
        .at(-1);
      const isCancelConfirmationContext =
        isPendingEmailCancelConfirmationPrompt(previousAgentMessage?.content);
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

      if (
        draftEmails.length > 0 &&
        text.length < 100 &&
        isPendingEmailCancelIntent(text)
      ) {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content: pendingEmailCancelConfirmationMessage(
            "draft",
            draftEmails.length,
          ),
        });
        return;
      }

      if (
        draftEmails.length > 0 &&
        text.length < 100 &&
        approvalWords.test(text)
      ) {
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
            content:
              draftEmails.length === 1
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

      const selectedPolicyIds = new Set<string>(
        (userMsgForGuard?.referencedPolicyIds as string[] | undefined) ?? [],
      );
      const selectedQuoteIds = new Set<string>(
        (userMsgForGuard?.referencedQuoteIds as string[] | undefined) ?? [],
      );
      const selectedRequirementIds = new Set<string>(
        (userMsgForGuard?.referencedRequirementIds as string[] | undefined) ??
          [],
      );
      const referencedMailboxIds =
        (userMsgForGuard?.referencedMailboxIds as
          | Id<"connectedEmailAccounts">[]
          | undefined) ?? [];

      // Get sender name
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: args.userId,
      });
      const userName = user?.name?.split(/\s+/)[0];

      const siteUrl = getPortalUrlForOrg(org);
      const brokerIdentity =
        org.type === "client"
          ? await ctx.runQuery(internal.orgs.resolveBrokerIdentityInternal, {
              clientOrgId: args.orgId,
            })
          : null;
      const brokerContext = brokerIdentity?.brokerCompanyName
        ? {
            name: brokerIdentity.brokerCompanyName,
            contactName: brokerIdentity.contactName,
            contactEmail: brokerIdentity.contactEmail,
            contactPhone: brokerIdentity.contactPhone,
          }
        : undefined;

      const scope = (await ctx.runQuery(
        (internal as any).lib.agentScope.resolveForAction,
        {
          orgId: args.orgId,
          userId: args.userId,
          surface: "web",
          operatorInitiatedUserMessageId: args.userMessageId,
        },
      )) as AgentScope;
      const operatorCopyUser = scope.operatorInitiated
        ? await ctx.runQuery(internal.users.getPrimaryOrgAdminInternal, {
            orgId: args.orgId,
          })
        : null;
      const requesterCopyEmail = scope.operatorInitiated
        ? operatorCopyUser?.email
        : user?.email;
      const requesterCopyName = scope.operatorInitiated
        ? operatorCopyUser?.name
        : user?.name;
      const requesterCopyLabel = requesterCopyEmail
        ? requesterCopyName
          ? `${requesterCopyName} <${requesterCopyEmail}>`
          : requesterCopyEmail
        : undefined;

      // Build system prompt. Broker orgs use an internal portfolio prompt.
      const systemPrompt =
        scope.mode === "broker_portfolio"
          ? buildBrokerPortfolioSystemPrompt({
              brokerName: typeof org.name === "string" ? org.name : undefined,
              brokerContext:
                typeof org.context === "string" ? org.context : undefined,
              userName,
              siteUrl,
            })
          : buildSystemPromptForContext({
              org: {
                ...org,
                broker: brokerContext,
              },
              mode: "direct",
              userName,
              siteUrl,
            });

      const policiesByOrg = new Map<
        string,
        { policies: any[]; quotes: any[] }
      >();
      await Promise.all(
        scope.readOrgIds.map(async (readOrgId) => {
          const docs = await ctx.runQuery(internal.policies.listAllPreviewReadableInternal, {
            orgId: readOrgId,
          });
          policiesByOrg.set(String(readOrgId), {
            policies: (docs as any[]).filter(
              (policy) => policy.documentType !== "quote",
            ),
            quotes: (docs as any[]).filter(
              (policy) => policy.documentType === "quote",
            ),
          });
        }),
      );

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
      const primaryDocs = policiesByOrg.get(String(args.orgId)) ?? {
        policies: [],
        quotes: [],
      };
      const focusedPolicyDocs =
        selectedPolicyIds.size > 0
          ? Array.from(policiesByOrg.values())
              .flatMap((entry) => entry.policies)
              .filter((policy) => selectedPolicyIds.has(String(policy._id)))
          : primaryDocs.policies;
      const focusedQuoteDocs =
        selectedQuoteIds.size > 0
          ? Array.from(policiesByOrg.values())
              .flatMap((entry) => entry.quotes)
              .filter((quote) => selectedQuoteIds.has(String(quote._id)))
          : primaryDocs.quotes;
      if (selectedPolicyIds.size > 0 || selectedQuoteIds.size > 0) {
        policiesByOrg.set(String(args.orgId), {
          policies: focusedPolicyDocs,
          quotes: focusedQuoteDocs,
        });
      }

      // Build document context (isolated per org in broker portfolio mode)
      const {
        context: docContext,
        relevantPolicyIds,
        relevantQuoteIds,
      } = await buildScopedDocumentContext(
        ctx,
        scope,
        policiesByOrg,
        latestUserContent,
      );

      // Cross-thread conversation memory (vector search)
      const memoryContext = await buildConversationMemoryContext(
        ctx,
        args.orgId,
        latestUserContent,
      );

      // Load business intelligence (vector search, deduped against policy context)
      const orgMemoryBlock = await buildScopedOrgMemoryContext(
        ctx,
        scope,
        latestUserContent,
        relevantPolicyIds.map((id: string) => id),
      );
      const requirementsBlock = await buildScopedRequirementsContext(
        ctx,
        scope,
      );
      const selectedRequirements =
        selectedRequirementIds.size > 0
          ? (
              (await ctx.runQuery(
                internal.compliance.listRequirementsInternal,
                {
                  orgId: args.orgId,
                },
              )) as Array<Record<string, unknown>>
            ).filter((requirement) =>
              selectedRequirementIds.has(String(requirement._id)),
            )
          : [];
      const selectedMailboxes =
        referencedMailboxIds.length > 0
          ? ((
              await Promise.all(
                referencedMailboxIds.map((accountId) =>
                  ctx.runQuery(internal.connectedEmail.getAccessibleInternal, {
                    accountId,
                    orgId: args.orgId,
                    userId: args.userId,
                  }),
                ),
              )
            ).filter(Boolean) as Array<Record<string, unknown>>)
          : [];
      const selectedSteeringBlock =
        selectedPolicyIds.size > 0 ||
        selectedQuoteIds.size > 0 ||
        selectedRequirements.length > 0 ||
        selectedMailboxes.length > 0
          ? `\n\nUSER-SELECTED CONTEXT TARGETS:\n${[
              focusedPolicyDocs.length
                ? `Policies:\n${focusedPolicyDocs
                    .map(
                      (policy: any) =>
                        `- ${policy.carrier || policy.security || "Unknown carrier"} #${policy.policyNumber} (ID:${policy._id})`,
                    )
                    .join("\n")}`
                : "",
              focusedQuoteDocs.length
                ? `Quotes:\n${focusedQuoteDocs
                    .map(
                      (quote: any) =>
                        `- ${quote.carrier || quote.security || "Unknown carrier"} #${quote.quoteNumber || quote.policyNumber} (ID:${quote._id})`,
                    )
                    .join("\n")}`
                : "",
              selectedRequirements.length
                ? `Requirements:\n${selectedRequirements
                    .map((requirement: any) => {
                      const semantics = requirementSemantics({
                        appliesTo: requirement.appliesTo ?? "vendors",
                        title: requirement.title,
                        category: requirement.category,
                        requirementText: requirement.requirementText,
                        originalContent: requirement.originalContent,
                        sourceExcerpt: requirement.sourceExcerpt,
                        sourceType: requirement.sourceType,
                        evaluationTarget: requirement.evaluationTarget,
                        evaluationReason: requirement.evaluationReason,
                        semanticReviewStatus:
                          requirement.semanticReviewStatus,
                      });
                      return `- ${requirement.title} (obligationOwner:${requirement.appliesTo ?? "vendors"}, evaluationTarget:${semantics.evaluationTarget} ${requirementEvaluationTargetLabel(semantics.evaluationTarget)}, ID:${requirement._id}): ${String(requirement.requirementText ?? "").slice(0, 500)}`;
                    })
                    .join("\n")}`
                : "",
              selectedMailboxes.length
                ? `Mailboxes:\n${selectedMailboxes
                    .map(
                      (mailbox: any) =>
                        `- ${mailbox.label || mailbox.emailAddress} (${mailbox.emailAddress}, ID:${mailbox._id})`,
                    )
                    .join("\n")}`
                : "",
            ]
              .filter(Boolean)
              .join(
                "\n\n",
              )}\nTreat these as explicit user steering. Prioritize them over generic retrieval. If mailbox work is needed and mailboxes are selected, keep the mailbox coordinator scoped to those accounts unless the user asks to broaden the search.`
          : "";

      const complianceBlock = await buildScopedVendorComplianceContext(
        ctx,
        scope,
      );

      const { history: messageHistory, latestAttachmentNames } =
        await buildMessageHistoryWithAttachmentContext(
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
      const operatorInitiatedBlock = scope.operatorInitiated
        ? `\n\nOPERATOR IMPERSONATION CONTEXT: This web chat message was initiated by ${scope.operatorInitiated.displayLabel} under an audited operator support/testing session. Treat the request as coming from that operator on behalf of the organization; do not imply that an end customer personally sent it. When drafting or sending email from this chat, copy the primary org admin${requesterCopyLabel ? ` (${requesterCopyLabel})` : ""}; do not CC or BCC the operator email unless the user explicitly asks for it.`
        : "";

      // Attachment context note
      let attachmentNote = "";
      if (latestUserMsg?.attachments?.length) {
        const filenames = (
          latestAttachmentNames.length > 0
            ? latestAttachmentNames
            : (latestUserMsg.attachments as Array<{ filename: string }>).map(
                (a) => a.filename,
              )
        ).join(", ");
        attachmentNote = `\n\nATTACHMENTS: The user's message includes ${latestUserMsg.attachments.length} attachment(s): ${filenames}. The content has been provided to you as file, image, or text content parts. Reference relevant information from attachments in your response when applicable.`;
      }

      const fullSystemPrompt =
        systemPrompt +
        webChatAddendum +
        pageContextBlock +
        "\n\n" +
        docContext +
        toolInstructions +
        operatorInitiatedBlock +
        memoryContext +
        orgMemoryBlock +
        requirementsBlock +
        selectedSteeringBlock +
        complianceBlock +
        attachmentNote +
        buildConfidenceInstructions();

      const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, {
        orgId: args.orgId,
      });
      const orgMemberEmails = orgMembers
        .map((m: any) => m?.email)
        .filter(Boolean) as string[];
      const baseAllowedRecipients = collectAllowedRecipients(
        allMessages as Parameters<typeof collectAllowedRecipients>[0],
        orgMemberEmails,
      );
      const allowedRecipients = brokerIdentity?.contactEmail
        ? [...new Set([...baseAllowedRecipients, brokerIdentity.contactEmail])]
        : baseAllowedRecipients;
      const brokerDirectedEmailRequest = isBrokerDirectedEmailRequest(
        String(latestUserContent ?? ""),
      );
      const brokerRecipientEmail = brokerDirectedEmailRequest
        ? brokerIdentity?.contactEmail
        : undefined;
      const brokerRecipientName = brokerDirectedEmailRequest
        ? (brokerIdentity?.contactName ?? brokerIdentity?.brokerCompanyName)
        : undefined;
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
                m.role !== "agent" || !isCoiAttachmentFilename(att.filename),
            )
            .map((att) => ({
              filename: att.filename,
              contentType: att.contentType,
              size: att.size,
              fileId: att.fileId!,
            })),
      );
      const currentDraftEmails = (await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId: args.threadId, orgId: args.orgId },
      )) as Array<{
        recipientEmail?: string;
        ccAddresses?: string[];
        bccAddresses?: string[];
        subject?: string;
        body?: string;
        emailBody?: string;
        attachments?: Array<{ filename: string }>;
      }>;
      const currentDraftContext =
        currentDraftEmails.length > 0
          ? [
              currentDraftEmails.length === 1
                ? "CURRENT EMAIL DRAFT ARTIFACT:"
                : `CURRENT EMAIL DRAFT ARTIFACTS (${currentDraftEmails.length}):`,
              ...currentDraftEmails.map((draft, index) =>
                [
                  currentDraftEmails.length === 1
                    ? null
                    : `Draft ${index + 1}:`,
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
                  .join("\n"),
              ),
            ].join("\n\n")
          : "";
      if (
        currentDraftEmails.length > 1 &&
        isMultiDraftElaborationRequest(text) &&
        emailIdentity.canSend &&
        emailIdentity.agentAddress &&
        emailIdentity.fromHeader
      ) {
        const agentAddress = emailIdentity.agentAddress;
        const fromHeader = emailIdentity.fromHeader;
        const signature = buildEmailSignature(
          agentAddress,
          emailIdentity.brokerBranding,
        );
        let revisedCount = 0;
        let repairedAttachmentCount = 0;

        for (const draft of currentDraftEmails as DraftEmailForBatchRevision[]) {
          const attachments = selectSafeDraftAttachments(draft);
          if ((draft.attachments?.length ?? 0) > (attachments?.length ?? 0)) {
            repairedAttachmentCount += 1;
          }
          const body = buildElaboratedCoiDraftBody({
            draft,
            attachments,
            coveredName:
              typeof org.name === "string" && org.name.trim() ? org.name : "us",
          });
          const emailPayload = buildEmailPayload({
            fromHeader,
            to: draft.recipientEmail,
            cc: draft.ccAddresses ?? [],
            bcc: draft.bccAddresses ?? [],
            subject: draft.subject,
            body,
            signature,
          });

          await ctx.runMutation(internal.pendingEmails.updateDraftInternal, {
            id: draft._id,
            emailPayload: JSON.stringify(emailPayload),
            recipientEmail: draft.recipientEmail,
            ccAddresses: draft.ccAddresses,
            bccAddresses: draft.bccAddresses,
            subject: draft.subject,
            emailBody: body,
            attachments:
              attachments && attachments.length > 0 ? attachments : undefined,
            referencedPolicyIds: draft.referencedPolicyIds,
            referencedQuoteIds: draft.referencedQuoteIds,
            chatMessageId: agentMsgId,
          });

          if (draft.threadMessageId) {
            await ctx.runMutation(internal.threads.updateEmailMessage, {
              id: draft.threadMessageId,
              content: body,
              toAddresses: [draft.recipientEmail],
              ccAddresses: draft.ccAddresses,
              bccAddresses: draft.bccAddresses,
              subject: draft.subject,
              attachments:
                attachments && attachments.length > 0 ? attachments : undefined,
              referencedPolicyIds: draft.referencedPolicyIds,
              referencedQuoteIds: draft.referencedQuoteIds,
              pendingEmailId: draft._id,
              status: "draft_email",
            });
          }
          revisedCount += 1;
        }

        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content: [
            `Done — I revised all ${revisedCount} email drafts with the holder, policy, and coverage details.`,
            repairedAttachmentCount > 0
              ? `I also repaired ${repairedAttachmentCount} draft${repairedAttachmentCount === 1 ? "" : "s"} so each email only has that recipient's COI attached.`
              : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
        return;
      }
      const emailToolResult: { current: EmailSubagentResult | null } = {
        current: null,
      };
      let content = "";
      let lastFlush = dayjs().valueOf();
      const FLUSH_INTERVAL = 150;
      let reasoning = "";
      let hasStartedReasoning = false;
      let lastReasoningFlush = dayjs().valueOf();
      const citedSections = new Set<string>(); // source/outline titles from lookup_policy_section results
      const citedCoverageNames = new Set<string>(); // structured coverage names surfaced by tool results
      const citedSourceSpanIds = new Set<string>(); // stable raw evidence IDs surfaced by tool results
      const citedPolicyIds = new Set<string>(); // policy IDs actually looked up or acted on by tools
      const usedTools: string[] = [];
      const toolCalls: Array<{
        name: string;
        input?: string;
        output?: string;
      }> = [];
      const toolArtifacts: Array<{ type: string; data: unknown }> = [];
      const responseAttachments: Array<{
        filename: string;
        contentType: string;
        size: number;
        fileId?: Id<"_storage">;
      }> = [];
      let policyChangeCaseId: Id<"policyChangeCases"> | undefined;
      let lastToolName = "";

      // streamText with tools — supports both streaming Q&A and tool calls
      const tools = {
        ...buildAgentToolExecutors(ctx, {
          surface: "web",
          orgId: args.orgId,
          userId: args.userId,
          scope,
          threadId: args.threadId,
          getCurrentPolicyChangeCaseId: () => policyChangeCaseId,
          operatorInitiatedUserMessageId: scope.operatorInitiated
            ? args.userMessageId
            : undefined,
          org,
          onPolicyReferenced: (policyId) => {
            citedPolicyIds.add(String(policyId));
          },
          onResponseAttachment: (attachment) => {
            responseAttachments.push(attachment);
          },
          onToolArtifact: (artifact) => {
            toolArtifacts.push(artifact);
          },
          onPolicyChangeCase: (caseId) => {
            policyChangeCaseId = caseId;
          },
          onPolicyChangeEmailDraft: async ({ caseId, draft }) => {
            if (
              !draft.needsRecipient &&
              draft.recipientEmail &&
              draft.subject &&
              draft.body
            ) {
              const emailIdentityForDraft =
                emailIdentity.canSend &&
                emailIdentity.agentAddress &&
                emailIdentity.fromHeader
                  ? emailIdentity
                  : await resolveEmailAgentIdentity(ctx, org);
              if (
                emailIdentityForDraft.canSend &&
                emailIdentityForDraft.agentAddress &&
                emailIdentityForDraft.fromHeader
              ) {
                const pendingEmailId = await upsertEmailDraftArtifact(
                  ctx,
                  {
                    orgId: args.orgId,
                    threadId: args.threadId,
                    chatMessageId: agentMsgId,
                    channel: "web",
                    fromHeader: emailIdentityForDraft.fromHeader,
                    agentAddress: emailIdentityForDraft.agentAddress,
                    brokerBranding: emailIdentityForDraft.brokerBranding,
                  },
                  {
                    to: draft.recipientEmail,
                    cc: [],
                    bcc:
                      org.bccRequesterOnAgentEmails !== false &&
                      requesterCopyEmail
                        ? [requesterCopyEmail]
                        : [],
                    subject: draft.subject,
                    body: draft.body,
                    attachments: [],
                    policyChangeCaseId: caseId,
                  },
                );
                return { pendingEmailId };
              }
            }
          },
        }),
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
              internal.actions.createOutboundImessageGroup
                .createOutboundImessageGroupInternal,
              {
                orgId: args.orgId,
                userId: args.userId,
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
            return await ctx.runAction(
              internal.actions.mailboxCoordinator.runInternal,
              {
                orgId: args.orgId,
                userId: args.userId,
                task: input.task,
                accountIds: referencedMailboxIds,
                chatMessageId: agentMsgId,
                threadId: args.threadId,
              },
            );
          },
        },
        web_research: {
          ...webResearch,
          execute: async (input: WebRetrievalInput) => {
            const result = await runWebRetrieval(ctx, args.orgId, input);
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
        render_email_preview: {
          ...renderEmailPreview,
          execute: async (input: {
            draftId?: string;
            format?: "png" | "pdf";
          }) => {
            return await ctx.runAction(
              internal.actions.renderEmailPreview.run,
              {
                orgId: args.orgId,
                threadId: args.threadId,
                userId: args.userId,
                draftId: input.draftId as Id<"pendingEmails"> | undefined,
                format: input.format,
              },
            );
          },
        },
        ...(emailIdentity.canSend &&
        emailIdentity.agentAddress &&
        emailIdentity.fromHeader
          ? {
              email_expert: buildEmailExpertTool(ctx, {
                orgId: args.orgId,
                userId: args.userId,
                threadId: args.threadId,
                chatMessageId: agentMsgId,
                channel: "web",
                fromHeader: emailIdentity.fromHeader,
                agentAddress: emailIdentity.agentAddress,
                brokerBranding: emailIdentity.brokerBranding,
                senderEmail: user?.email,
                defaultTo: brokerDirectedEmailRequest
                  ? brokerRecipientEmail
                  : user?.email,
                defaultRecipientName: brokerDirectedEmailRequest
                  ? brokerRecipientName
                  : user?.name,
                requireKnownRecipient: brokerDirectedEmailRequest,
                missingRecipientMessage:
                  "No broker contact email is set for this organization. Add the broker contact in Settings, or provide the broker's email address before I draft or send this.",
                unknownRecipientMessage:
                  "I cannot use that broker recipient because it is not the configured broker contact in Glass. Add the broker contact in Settings, or provide the correct broker email address explicitly.",
                defaultBcc:
                  org.bccRequesterOnAgentEmails !== false && requesterCopyEmail
                    ? [requesterCopyEmail]
                    : undefined,
                blockedCopyEmails: scope.operatorInitiated?.operatorEmail
                  ? [scope.operatorInitiated.operatorEmail]
                  : undefined,
                subjectHint:
                  thread?.title && thread.title !== "New chat"
                    ? thread.title
                    : undefined,
                allowedRecipients,
                availableAttachments,
                referencedPolicyIds: relevantPolicyIds as Id<"policies">[],
                referencedQuoteIds: relevantQuoteIds as Id<"policies">[],
                autoSendEmails: brokerDirectedEmailRequest
                  ? false
                  : org.autoSendEmails === true,
                emailSendDelay: org.emailSendDelay,
                autoGenerateCoi: org.autoGenerateCoi,
                coiHandling: org.coiHandling,
                conversationContext:
                  allMessages
                    .filter(
                      (m: Record<string, unknown>) =>
                        m.status !== "processing" && m.status !== "cancelled",
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

      // Immediately show "Thinking..." by ensuring processing message is visible
      await ctx.runMutation(internal.threads.streamAgentMessage, {
        id: agentMsgId,
        content: "",
      });
      if (await isAgentResponseCancelled(true)) return;

      // Tool call display names for the "thinking" UI
      const TOOL_LABELS: Record<string, string> = {
        lookup_policy: "Searching policies...",
        lookup_policy_section: "Reading policy sources...",
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
        start_application_intake: "Starting application intake...",
        answer_application_questions: "Saving application answers...",
        check_application_status: "Checking application status...",
        prepare_application_packet: "Preparing application packet...",
        create_policy_change_request: "Creating policy change request...",
        add_policy_change_info: "Updating policy change request...",
        check_policy_change_status: "Checking policy change status...",
        draft_policy_change_email: "Drafting policy change email...",
        complete_policy_change_from_endorsement:
          "Completing policy change request...",
        create_imessage_group_chat: "Starting iMessage group...",
        coordinate_mailbox_task: "Coordinating mailbox task...",
        web_research: "Searching the web...",
        render_email_preview: "Rendering email preview...",
      };
      const SUBAGENT_TOOL_NAMES = new Set([
        "email_expert",
        "coordinate_mailbox_task",
      ]);

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
                content: restoreSentenceBoundarySpacing(content),
              });
            }
          } else if (part.type === "tool-call") {
            lastToolName = part.toolName;
            const input =
              ((part as Record<string, unknown>).input as
                | Record<string, unknown>
                | undefined) ?? undefined;
            usedTools.push(part.toolName);
            toolCalls.push({
              name: part.toolName,
              input: input ? JSON.stringify(input).slice(0, 500) : undefined,
            });
            const label =
              TOOL_LABELS[part.toolName] ?? `Using ${part.toolName}...`;
            await ctx.runMutation(internal.threads.streamAgentMessage, {
              id: agentMsgId,
              content: content
                ? restoreSentenceBoundarySpacing(content) + `\n\n*${label}*`
                : `*${label}*`,
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
            if (lastToolName === "render_email_preview" && output) {
              if (
                output &&
                typeof output === "object" &&
                "attachment" in output
              ) {
                const attachment = (output as Record<string, unknown>)
                  .attachment;
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
            // Capture cited source/outline titles and policy IDs from lookup_policy_section results
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
                  } else {
                    citedSections.add(
                      String((r as Record<string, unknown>).title),
                    );
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
              content: restoreSentenceBoundarySpacing(content || ""),
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
        const completed = await consumeChatStream(
          startChatStream(retryModel, retryRoute).fullStream,
        );
        if (!completed) return;
      }

      if (await isAgentResponseCancelled(true)) return;

      // Final update — save content, reasoning, and cited sections
      content = restoreSentenceBoundarySpacing(content);
      const completedCoiEmailSideEffect =
        usedTools.includes("email_expert") ||
        usedTools.includes("generate_coi") ||
        responseAttachments.some((attachment) =>
          /certificate[-_\s]?of[-_\s]?insurance|coi/i.test(attachment.filename),
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
      const emailResult = emailToolResult.current;
      if (!emailResult && !completedCoiEmailSideEffect) {
        content = await repairMissingConfidenceMarkers({
          content,
          model: chatModel.model,
          route: chatModel.route,
        });
        content = restoreSentenceBoundarySpacing(content);
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
        thread?.originChannel === "imessage" &&
        latestUserMsg?.channel === "chat" &&
        String(latestUserMsg._id ?? "") === String(args.userMessageId)
      ) {
        const route = getImessageOutboundRoute(thread);
        if (route) {
          const imessageAttachments = await storedAttachmentsToImessageOutbound(
            ctx,
            responseAttachments,
          );
          await sendIdempotentOutboundImessage(ctx, {
            ...route,
            idempotencyKey: `web-agent:${agentMsgId}`,
            orgId: args.orgId,
            threadId: args.threadId,
            threadMessageId: agentMsgId,
            message: formatWebChatAgentMirrorText({
              content: stripMarkdown(content),
              hasAttachments: imessageAttachments.length > 0,
            }),
            attachments: imessageAttachments,
            logPrefix: "processThreadChat",
          });
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
