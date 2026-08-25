"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import mammoth from "mammoth";
import JSZip from "jszip";
import {
  createImessageGroupChat,
  coordinateMailboxTask,
  webResearch,
  renderEmailPreview,
} from "../lib/chatTools";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import { agentToolStepsFromAudit } from "../lib/agentSteps";
import {
  AGENT_MAX_OUTPUT_TOKENS,
  runAgentTurn,
} from "../lib/channelAgentRunner";
import {
  formatPolicyFocusHints,
  selectPolicyFocusIds,
  validatePolicyFocusIds,
} from "../lib/agentPolicyFocus";
import {
  buildSystemPromptForContext,
  buildBrokerPortfolioSystemPrompt,
  stripConfidenceMarkers,
  stripMarkdown,
  markdownToHtml,
  buildChannelInstructions,
  buildPolicyToolInstructions,
  buildUnsupportedOutputInstructions,
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
  buildEmailExpertTool,
  resolveEmailAgentIdentity,
  type EmailSubagentResult,
} from "../lib/emailSubagent";
import {
  classifyPromptInjection,
  collectAllowedRecipients,
  enforceInputLimits,
} from "../lib/security";
import { FATAL_ACTION_FAILED_MESSAGE } from "../lib/actionFailures";
import { buildPendingEmailConfirmation } from "../lib/actionConfirmationFingerprint";
import {
  buildPrivateAgentHistoryMetadata,
  buildRecentAgentConversationContext,
  buildThreadContinuityPrompt,
  buildThreadHistoryToolInstructions,
  stripInternalAgentActivity,
} from "../lib/agentMessageHistory";
import {
  loadBoundedAgentHistory,
  scheduleThreadHistoryCompaction,
} from "../lib/agentHistoryLoader";
import { runWebRetrieval, type WebRetrievalInput } from "../lib/webRetrieval";
import {
  loadWebChatDeterministicControlState,
  runWebChatEmailControls,
  runWebChatTaskControl,
} from "../lib/webChatDeterministicControls";
import { lobLabel } from "../lib/linesOfBusiness";
import {
  isUnsupportedSpreadsheetAttachment,
  isXlsxSpreadsheetAttachment,
  spreadsheetBufferToText,
} from "../lib/spreadsheetText";
import {
  buildRequirementImportConfirmation,
  decideRequirementAttachmentImport,
  requiredRequirementImportStep,
} from "../lib/requirementAttachmentIntent";
import {
  SLACK_PROCESSING_REACTIONS,
  SLACK_REACTION_TOOL_NAME,
} from "../lib/slackBlocks";

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
  fileId?: Id<"_storage">;
  kind?: "coi" | "original_policy" | "uploaded_file" | "generated_document";
};

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string }
  | { type: "file"; data: string; mediaType: string };

const MAX_ATTACHMENT_TEXT_CHARS = 80_000;
const RECENT_ATTACHMENT_MESSAGE_LIMIT = 6;

export function messageHistoryHasImageInput(history: ModelMessage[]) {
  return history.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image"),
  );
}

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
  messages: Doc<"threadMessages">[],
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
      const attachments = msg.attachments ?? [];
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
      const privateHistory = buildPrivateAgentHistoryMetadata({
        toolArtifacts: msg.toolArtifacts,
        usedTools: msg.usedTools,
        attachments: msg.attachments,
      });
      history.push({
        role: "assistant",
        content: stripConfidenceMarkers(content),
        ...(privateHistory
          ? { providerOptions: { glass: { privateHistory } } }
          : {}),
      });
    }
  }

  return { history, latestAttachmentNames };
}

export const run = internalAction({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userMessageId: v.id("threadMessages"),
    agentMessageId: v.optional(v.id("threadMessages")),
    surface: v.optional(v.union(v.literal("web"), v.literal("slack"))),
    slackActorId: v.optional(v.id("slackActors")),
  },
  handler: async (ctx, args) => {
    const surface = args.surface ?? "web";
    const latestUserMessage = await ctx.runQuery(
      internal.agentHistory.getLatestUserMessage,
      { threadId: args.threadId },
    );
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
      const boundedHistory = await loadBoundedAgentHistory(ctx, {
        threadId: args.threadId,
        currentMessageId: args.userMessageId,
        surface,
      });
      const controlState = await loadWebChatDeterministicControlState(ctx, {
        threadId: args.threadId,
        orgId: args.orgId,
        userMessageId: args.userMessageId,
      });
      const text = controlState.messageText;
      if (
        await runWebChatEmailControls(ctx, {
          ...controlState,
          agentMessageId: agentMsgId,
          userMessageId: args.userMessageId,
          userId: args.userId,
          threadId: args.threadId,
          orgId: args.orgId,
        })
      ) {
        await scheduleThreadHistoryCompaction(ctx, args.threadId);
        return;
      }

      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: args.orgId,
      });
      if (!org) throw new Error("Organization not found");

      const userMsgForGuard = await ctx.runQuery(
        internal.threads.getMessageInternal,
        {
          id: args.userMessageId,
        },
      );
      if (userMsgForGuard?.content) {
        const sanitizedContent = enforceInputLimits(userMsgForGuard.content);
        const injectionCheck = await classifyPromptInjection(
          ctx,
          sanitizedContent,
          args.orgId,
        );
        if (!injectionCheck.safe) {
          await ctx.runMutation(internal.threads.updateAgentMessage, {
            id: agentMsgId,
            content:
              "I can't process this request. Please rephrase your question about insurance policies or coverage.",
          });
          console.warn("[security] Prompt injection blocked", {
            threadId: args.threadId,
            audit: injectionCheck.audit,
          });
          await scheduleThreadHistoryCompaction(ctx, args.threadId);
          return;
        }
      }

      if (
        await runWebChatTaskControl(ctx, {
          threadId: args.threadId,
          agentMessageId: agentMsgId,
          userMessageId: args.userMessageId,
          messageText: text,
        })
      ) {
        await scheduleThreadHistoryCompaction(ctx, args.threadId);
        return;
      }

      const requestedPolicyIds = new Set(
        userMsgForGuard?.referencedPolicyIds ?? [],
      );
      const selectedRequirementIds = new Set(
        userMsgForGuard?.referencedRequirementIds ?? [],
      );
      const referencedMailboxIds = userMsgForGuard?.referencedMailboxIds ?? [];

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

      const scope = await ctx.runQuery(
        internal.lib.agentScope.resolveForAction,
        {
          orgId: args.orgId,
          userId: args.userId,
          surface,
          operatorInitiatedUserMessageId: args.userMessageId,
          slackActorId: args.slackActorId,
        },
      );
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

      const allMessages = boundedHistory.messages;

      const latestUserMsg = allMessages
        .filter((message) => message.role === "user")
        .pop();
      const latestUserContent = latestUserMsg?.content ?? "";
      const latestUserAttachments = (latestUserMsg?.attachments ?? []).filter(
        (
          attachment,
        ): attachment is typeof attachment & {
          fileId: Id<"_storage">;
        } => Boolean(attachment.fileId),
      );
      const requirementImportResolution =
        await decideRequirementAttachmentImport(ctx, {
          orgId: args.orgId,
          messageText: String(latestUserContent),
          attachments: latestUserAttachments,
        });
      const requirementImportAttachments =
        requirementImportResolution.authorization === "auto"
          ? requirementImportResolution.attachments
          : [];
      const requirementImportDefaultScope =
        requirementImportResolution.authorization === "none"
          ? undefined
          : requirementImportResolution.scope;
      const policyFocusIds = await validatePolicyFocusIds(
        ctx,
        scope,
        selectPolicyFocusIds(
          allMessages.filter(
            (message) =>
              message._id !== agentMsgId && message._id !== args.userMessageId,
          ),
          [...requestedPolicyIds],
        ),
      );
      const explicitSelectedPolicyIds = new Set(
        policyFocusIds.filter((policyId) => requestedPolicyIds.has(policyId)),
      );
      const policyFocusBlock = formatPolicyFocusHints(policyFocusIds);
      const selectedRequirements =
        selectedRequirementIds.size > 0
          ? (
              await ctx.runQuery(
                internal.compliance.listRequirementsInternal,
                { orgId: args.orgId },
              )
            ).filter((requirement) =>
              selectedRequirementIds.has(requirement._id),
            )
          : [];
      const selectedMailboxes =
        referencedMailboxIds.length > 0
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
            ).filter((mailbox) => mailbox !== null)
          : [];
      const selectedSteeringBlock =
        selectedRequirements.length > 0 || selectedMailboxes.length > 0
          ? `\n\nUSER-SELECTED CONTEXT TARGETS:\n${[
              selectedRequirements.length
                ? `Requirements:\n${selectedRequirements
                    .map(
                      (requirement) =>
                        `- ${requirement.title} (scope:${requirement.scope ?? "vendors"}, kind:${requirement.kind ?? "coverage"}${requirement.lineOfBusiness ? `, line:${requirement.lineOfBusiness} ${lobLabel(requirement.lineOfBusiness)}` : ""}, ID:${requirement._id}): ${String(requirement.requirementText ?? "").slice(0, 500)}`,
                    )
                    .join("\n")}`
                : "",
              selectedMailboxes.length
                ? `Mailboxes:\n${selectedMailboxes
                    .map(
                      (mailbox) =>
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

      const { history: messageHistory, latestAttachmentNames } =
        await buildMessageHistoryWithAttachmentContext(
          ctx,
          allMessages,
          latestUserMsg?._id ? String(latestUserMsg._id) : undefined,
        );
      const hasImageInput = messageHistoryHasImageInput(messageHistory);

      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId,
      });
      const hasEmailMessages = allMessages.some(
        (message) => message.channel === "email",
      );
      const isMixedThread =
        hasEmailMessages || thread?.originChannel === "email";
      const emailIdentity = await resolveEmailAgentIdentity(ctx, org);
      const canSendEmail = emailIdentity.canSend;

      const autoSend = org.autoSendEmails === true;
      const webChatAddendum = buildChannelInstructions({
        platform: surface,
        isMixedThread,
        canSendEmail,
        autoSendEmails: autoSend,
      });

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

      let attachmentNote = "";
      if (latestUserMsg?.attachments?.length) {
        const filenames = (
          latestAttachmentNames.length > 0
            ? latestAttachmentNames
            : latestUserMsg.attachments.map(({ filename }) => filename)
        ).join(", ");
        attachmentNote = `\n\nATTACHMENTS: The user's message includes ${latestUserMsg.attachments.length} attachment(s): ${filenames}. The content has been provided to you as file, image, or text content parts. Reference relevant information from attachments in your response when applicable.`;
      }

      const fullSystemPrompt =
        systemPrompt +
        webChatAddendum +
        pageContextBlock +
        toolInstructions +
        operatorInitiatedBlock +
        (policyFocusBlock ? `\n\n${policyFocusBlock}` : "") +
        selectedSteeringBlock +
        attachmentNote +
        buildUnsupportedOutputInstructions() +
        buildThreadHistoryToolInstructions() +
        buildThreadContinuityPrompt(boundedHistory.summary);

      const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, {
        orgId: args.orgId,
      });
      const orgMemberEmails = orgMembers
        .filter((member) => member !== null)
        .map((member) => member.email)
        .filter((email): email is string => Boolean(email));
      const baseAllowedRecipients = collectAllowedRecipients(
        allMessages,
        orgMemberEmails,
      );
      const allowedRecipients = brokerIdentity?.contactEmail
        ? [...new Set([...baseAllowedRecipients, brokerIdentity.contactEmail])]
        : baseAllowedRecipients;
      const availableAttachments = allMessages.flatMap(
        (message) =>
          (message.attachments ?? []).flatMap((attachment) =>
            attachment.fileId &&
            (message.role !== "agent" || attachment.kind !== "coi")
              ? [{ ...attachment, fileId: attachment.fileId }]
              : [],
          ),
      );
      const currentDraftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId: args.threadId, orgId: args.orgId },
      );
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
                    ? `Attachments: ${draft.attachments.map(({ filename }) => filename).join(", ")}`
                    : null,
                  "",
                  draft.emailBody,
                ]
                  .filter((line) => line !== null)
                  .join("\n"),
              ),
            ].join("\n\n")
          : "";
      const emailToolResult: { current: EmailSubagentResult | null } = {
        current: null,
      };
      let content = "";
      const citedSections = new Set<string>();
      const citedCoverageNames = new Set<string>();
      const citedSourceSpanIds = new Set<string>();
      const presentedPolicyIds = new Set<Id<"policies">>();
      const emailReferencedPolicyIds = policyFocusIds.filter((policyId) =>
        explicitSelectedPolicyIds.has(policyId),
      );
      const toolArtifacts: Array<{ type: string; data: unknown }> = [];
      const responseAttachments: Array<{
        filename: string;
        contentType: string;
        size: number;
        fileId?: Id<"_storage">;
      }> = [];
      const recentConversationContext = buildRecentAgentConversationContext(
        boundedHistory.messages,
        String(args.userMessageId),
      );

      const slackActorId = args.slackActorId;
      const tools = {
        ...buildAgentToolExecutors(ctx, {
          surface,
          orgId: args.orgId,
          userId: args.userId,
          scope,
          threadId: args.threadId,
          requirementImportAttachments,
          requirementImportDefaultScope,
          operatorInitiatedUserMessageId: scope.operatorInitiated
            ? args.userMessageId
            : undefined,
          onPolicyPresented: (policyId) => {
            presentedPolicyIds.add(policyId);
          },
          onPolicyReferenced: (policyId) => {
            if (!emailReferencedPolicyIds.some((id) => id === policyId)) {
              emailReferencedPolicyIds.push(policyId);
            }
          },
          onPolicySourceEvidence: (evidence) => {
            for (const result of Array.isArray(evidence)
              ? evidence
              : [evidence]) {
              if (!result || typeof result !== "object") continue;
              const record = result as Record<string, unknown>;
              if (!record.title) continue;
              const collection =
                record.type === "coverage" ? citedCoverageNames : citedSections;
              collection.add(String(record.title));
              if (Array.isArray(record.sourceSpanIds)) {
                for (const id of record.sourceSpanIds) {
                  if (typeof id === "string" && id) citedSourceSpanIds.add(id);
                }
              }
            }
          },
          onResponseAttachment: (attachment) => {
            responseAttachments.push(attachment);
          },
          onToolArtifact: (artifact) => {
            toolArtifacts.push(artifact);
          },
        }),
        ...(surface === "slack"
          ? {
              [SLACK_REACTION_TOOL_NAME]: {
                description:
                  "Choose the temporary Slack reaction shown on the user's message while you work. Pick the built-in emoji name that best matches the request; use eyes when no option is clearly better. This reaction is removed when the answer is ready.",
                inputSchema: z.object({
                  name: z
                    .enum(SLACK_PROCESSING_REACTIONS)
                    .describe(
                      "A built-in Slack emoji name without surrounding colons.",
                    ),
                }),
                execute: async (input: {
                  name: (typeof SLACK_PROCESSING_REACTIONS)[number];
                }) =>
                  await ctx.runAction(
                    internal.actions.slackPresentation.setReaction,
                    {
                      threadMessageId: agentMsgId,
                      name: input.name,
                    },
                  ),
              },
            }
          : {}),
        ...(surface === "web"
          ? {
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
                  return ctx.runAction(
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
            }
          : {}),
        ...(surface === "slack" && slackActorId
          ? {
              request_human_service: {
                description:
                  "Pause the Slack AI thread and request help from a Glass human operator. Use when the customer explicitly asks for a human or the task requires human service.",
                inputSchema: z.object({
                  reason: z
                    .string()
                    .describe(
                      "A compact internal reason. It remains in the canonical source thread and is not copied into the primary-channel notice.",
                    ),
                }),
                execute: async () =>
                  await ctx.runMutation(
                    internal.slack.requestHandoffFromAgent,
                    {
                      threadId: args.threadId,
                      slackActorId,
                    },
                  ),
              },
            }
          : {}),
        coordinate_mailbox_task: {
          ...coordinateMailboxTask,
          execute: async (input: { task: string }) => {
            const result = await ctx.runAction(
              internal.actions.mailboxCoordinator.runInternal,
              {
                orgId: args.orgId,
                userId: args.userId,
                task: input.task,
                accountIds: referencedMailboxIds,
                chatMessageId: agentMsgId,
                threadId: args.threadId,
                routingParentId: String(agentMsgId),
              },
            );
            toolArtifacts.push({ type: "mailbox_task", data: result });
            return result;
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
            const result = await ctx.runAction(
              internal.actions.renderEmailPreview.run,
              {
                orgId: args.orgId,
                threadId: args.threadId,
                userId: args.userId,
                draftId: input.draftId as Id<"pendingEmails"> | undefined,
                format: input.format,
              },
            );
            if ("attachment" in result && result.attachment) {
              responseAttachments.push(result.attachment);
            }
            return result;
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
                routingParentId: String(agentMsgId),
                channel: surface,
                fromHeader: emailIdentity.fromHeader,
                agentAddress: emailIdentity.agentAddress,
                brokerBranding: emailIdentity.brokerBranding,
                senderEmail: user?.email,
                defaultTo: user?.email,
                defaultRecipientName: user?.name,
                brokerRecipientEmail: brokerIdentity?.contactEmail,
                brokerRecipientName:
                  brokerIdentity?.contactName ??
                  brokerIdentity?.brokerCompanyName,
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
                referencedPolicyIds: emailReferencedPolicyIds,
                autoSendEmails: org.autoSendEmails === true,
                emailSendDelay: org.emailSendDelay,
                conversationContext:
                  recentConversationContext +
                  (currentDraftContext ? `\n\n${currentDraftContext}` : ""),
                onResult: (result) => {
                  emailToolResult.current = result;
                },
              }),
            }
          : {}),
      };

      if (await isAgentResponseCancelled(true)) return;
      const SUBAGENT_TOOL_NAMES = new Set([
        "email_expert",
        "coordinate_mailbox_task",
      ]);
      const chatTask = hasImageInput ? "chat_vision" : "chat";
      const turn = await runAgentTurn(ctx, {
        orgId: args.orgId,
        task: chatTask,
        messageText: text,
        recentConversationContext,
        currentAttachmentNames: latestAttachmentNames,
        auditExcludedTools:
          surface === "slack" ? new Set([SLACK_REACTION_TOOL_NAME]) : undefined,
        options: {
          maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
          system: fullSystemPrompt,
          messages: messageHistory,
          tools,
          stopWhen: stepCountIs(25),
          prepareStep: ({ stepNumber }) => {
            if (surface === "slack" && stepNumber === 0) {
              return {
                toolChoice: {
                  type: "tool" as const,
                  toolName: SLACK_REACTION_TOOL_NAME,
                },
              };
            }
            return requiredRequirementImportStep(
              stepNumber - (surface === "slack" ? 1 : 0),
              requirementImportAttachments.length > 0,
            );
          },
        },
        run: {
          taskKind: "query_reason",
          sessionKey: String(args.threadId),
          trace: {
            traceId: String(agentMsgId),
            parentRequestId: String(args.userMessageId),
            label: "convex.processThreadChat",
            phase: "query_reason",
            channel: surface,
          },
        },
      });
      const { usedTools } = turn.audit;
      const toolCalls = turn.audit.toolCalls.map((call) =>
        SUBAGENT_TOOL_NAMES.has(call.name)
          ? call
          : { name: call.name, input: call.input },
      );
      const agentSteps = agentToolStepsFromAudit(
        turn.audit,
        SUBAGENT_TOOL_NAMES,
      );
      for (const workflowOutcome of turn.audit.workflowOutcomes) {
        toolArtifacts.push({ type: "workflow_outcome", data: workflowOutcome });
      }
      content = turn.text;

      if (await isAgentResponseCancelled(true)) return;

      content = stripInternalAgentActivity(content);
      const emailResult = emailToolResult.current;
      if (!content && !emailResult) {
        content =
          "I couldn't format that response. Please try again in a moment.";
      }
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: agentMsgId,
        content,
        referencedPolicyIds:
          presentedPolicyIds.size > 0
            ? [...presentedPolicyIds]
            : undefined,
        citedSections: citedSections.size > 0 ? [...citedSections] : undefined,
        citedCoverageNames:
          citedCoverageNames.size > 0 ? [...citedCoverageNames] : undefined,
        citedSourceSpanIds:
          citedSourceSpanIds.size > 0 ? [...citedSourceSpanIds] : undefined,
        usedTools: usedTools.length > 0 ? usedTools : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        agentSteps: agentSteps.length > 0 ? agentSteps : undefined,
        toolArtifacts: toolArtifacts.length > 0 ? toolArtifacts : undefined,
        attachments:
          responseAttachments.length > 0 ? responseAttachments : undefined,
      });
      if (emailResult) {
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content,
          pendingEmailId: emailResult.pendingEmailId,
          status: emailResult.status === "pending" ? "pending_send" : undefined,
        });
        if (
          emailResult.pendingEmailId &&
          (emailResult.status === "draft" ||
            emailResult.status === "needs_confirmation")
        ) {
          const draft = await ctx.runQuery(internal.pendingEmails.getInternal, {
            id: emailResult.pendingEmailId,
          });
          if (draft?.status === "draft") {
            const confirmation = await buildPendingEmailConfirmation(draft);
            const statusMessageId = await ctx.runMutation(
              internal.threads.insertWorkflowStatusMessage,
              {
                orgId: args.orgId,
                threadId: args.threadId,
                sourceThreadMessageId: agentMsgId,
                pendingEmailId: draft._id,
                dedupeKey: `email-confirmation:${String(draft._id)}:${confirmation.fingerprint}`,
                content:
                  confirmation.payload.kind === "coi_batch_delivery"
                    ? `Confirm this exact COI batch for ${draft.recipientEmail}: ${(draft.attachments ?? []).map((attachment) => attachment.filename).join(", ")}. This authorizes the attachment set; use Send after authorization.`
                    : `Confirm this exact draft to ${draft.recipientEmail} with subject “${draft.subject}” to send it.`,
              },
            );
            await ctx.runMutation(
              internal.threadActionConfirmations.createInternal,
              {
                orgId: args.orgId,
                threadId: args.threadId,
                actor: { kind: "user", userId: args.userId },
                promptMessageId: statusMessageId,
                payload: confirmation.payload,
              },
            );
          }
        }
      }

      if (!emailResult) {
        const confirmation = buildRequirementImportConfirmation(
          requirementImportResolution,
        );
        if (confirmation) {
          const statusMessageId = await ctx.runMutation(
            internal.threads.insertWorkflowStatusMessage,
            {
              orgId: args.orgId,
              threadId: args.threadId,
              sourceThreadMessageId: agentMsgId,
              dedupeKey: `requirement-import-confirmation:${String(args.userMessageId)}`,
              content: confirmation.message,
            },
          );
          await ctx.runMutation(
            internal.threadActionConfirmations.createInternal,
            {
              orgId: args.orgId,
              threadId: args.threadId,
              actor: { kind: "user", userId: args.userId },
              promptMessageId: statusMessageId,
              payload: confirmation.payload,
            },
          );
        }
      }

      await scheduleThreadHistoryCompaction(ctx, args.threadId);

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
          const htmlBody = markdownToHtml(content);
          const html = buildEmailShell({
            title: escapeHtml(subject),
            siteUrl,
            bodyHtml: `
<tr><td align="left" style="padding:28px 40px 0 40px;">
  <p class="glass-email-text-primary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.4;">${escapeHtml(threadLabel)}</p>
</td></tr>
<tr><td style="padding:22px 40px 0 40px;">
  <div class="glass-email-text-secondary" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${htmlBody}</div>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapeHtml(threadUrl)}" class="glass-email-button" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;border-radius:999px;padding:11px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;">View thread</a>
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
