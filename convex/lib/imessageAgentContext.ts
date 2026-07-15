"use node";

import type { ModelMessage } from "ai";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  buildComplianceRequirementsContext,
  buildDocumentContext,
  buildIntelligenceContext,
} from "./agentPrompts";
import { buildAssistantMessageContentWithArtifacts } from "./agentMessageHistory";
import {
  MAX_IMESSAGE_AUDIO_BYTES,
  isImessageAudioAttachment,
  normalizeImessageAttachmentMimeType,
  type RawImessageAttachment,
  type StoredImessageAttachmentRecord,
} from "./imessageIngress";
import { tryBuildParsedPdfText } from "./liteparsePreprocessor";
import {
  transcribeAudioForOrg,
  transcribeAudioForPublicTask,
} from "./models";

export type ImessageHistoryMessage = {
  status?: string;
  role: string;
  content: string;
  userName?: string;
  responseMessageId?: string;
  toolArtifacts?: Array<{ type: string; data: unknown }>;
  usedTools?: string[];
  attachments?: Array<{ filename: string }>;
};

type ImessageContentPart =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mediaType: string }
  | { type: "image"; image: string; mediaType: string };

const VOICE_MEMO_TRANSCRIPTION_PROMPT =
  "This voice memo is addressed to Glass, an insurance intelligence assistant. Preserve names, email addresses, policy numbers, dates, insurance terminology, and explicit user instructions verbatim.";

export type ImessageVoiceMemoInput = {
  messageText: string;
  hasVoiceMemos: boolean;
  transcripts: Array<{ filename: string; text: string }>;
  failures: Array<{ filename: string; error: string }>;
};

function explicitImessageText(messageText: string): string {
  const trimmed = messageText.trim();
  return trimmed === "(attachment)" ? "" : trimmed;
}

export async function transcribeImessageVoiceMemos(
  ctx: ActionCtx,
  args: {
    orgId?: Id<"organizations">;
    messageText: string;
    attachments?: RawImessageAttachment[];
  },
): Promise<ImessageVoiceMemoInput> {
  const voiceMemos = (args.attachments ?? []).filter(
    isImessageAudioAttachment,
  );
  if (voiceMemos.length === 0) {
    return {
      messageText: args.messageText,
      hasVoiceMemos: false,
      transcripts: [],
      failures: [],
    };
  }

  const transcripts: ImessageVoiceMemoInput["transcripts"] = [];
  const failures: ImessageVoiceMemoInput["failures"] = [];
  for (const voiceMemo of voiceMemos) {
    const filename = voiceMemo.name.trim() || "voice-memo.m4a";
    const data = Buffer.from(voiceMemo.data, "base64");
    if (data.byteLength === 0) {
      failures.push({ filename, error: "The voice memo was empty." });
      continue;
    }
    if (data.byteLength > MAX_IMESSAGE_AUDIO_BYTES) {
      failures.push({
        filename,
        error: "The voice memo exceeded the 20 MB attachment limit.",
      });
      continue;
    }

    try {
      const input = {
        data,
        filename,
        mediaType: normalizeImessageAttachmentMimeType(voiceMemo.mimeType),
        prompt: VOICE_MEMO_TRANSCRIPTION_PROMPT,
      };
      const result = args.orgId
        ? await transcribeAudioForOrg(ctx, args.orgId, input)
        : await transcribeAudioForPublicTask(ctx, input);
      transcripts.push({ filename, text: result.text });
      console.log("[imessage] Voice memo transcribed", {
        filename,
        model: result.route.model,
        routeSource: result.routeSource,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[imessage] Voice memo transcription failed", {
        filename,
        error: message,
      });
      failures.push({ filename, error: message });
    }
  }

  const messageParts = [explicitImessageText(args.messageText)];
  messageParts.push(
    ...transcripts.map(
      (transcript) =>
        `[Voice memo transcript: ${transcript.filename}]\n${transcript.text}`,
    ),
  );

  return {
    messageText: messageParts.filter(Boolean).join("\n\n") || args.messageText,
    hasVoiceMemos: true,
    transcripts,
    failures,
  };
}

export function isImessageStatusCue(message: {
  responseMessageId?: string;
}): boolean {
  return message.responseMessageId?.endsWith(":status") === true;
}

export function buildRecentImessageTextContext(
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

export function buildImessageRetrievalQuery(args: {
  recentConversationContext: string;
  messageText: string;
}): string {
  return [args.recentConversationContext, `User: ${args.messageText}`]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

export async function buildImessageKnowledgeContext(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    readOrgIds: Id<"organizations">[];
    orgNamesById: Record<string, string>;
    retrievalQuery: string;
  },
): Promise<{
  policyContext: string;
  memoryContext: string;
  orgMemoryBlock: string;
  requirementsBlock: string;
  relevantPolicyIds: Id<"policies">[];
}> {
  const scopedPolicySets = await Promise.all(
    args.readOrgIds.map(async (orgId) => ({
      orgId,
      policies: await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      ),
    })),
  );
  const policyContextParts: string[] = [];
  const relevantPolicyIds: Id<"policies">[] = [];

  for (const entry of scopedPolicySets) {
    const built = await buildDocumentContext(
      ctx,
      entry.orgId,
      entry.policies,
      args.retrievalQuery,
    );
    if (built.context.trim().length > 0) {
      const orgName =
        args.orgNamesById[String(entry.orgId)] ?? "Linked organization";
      policyContextParts.push(
        `\n\nPOLICY CONTEXT FOR ${orgName}\n${built.context}`,
      );
    }
    relevantPolicyIds.push(...(built.relevantPolicyIds as Id<"policies">[]));
  }

  const memoryContext = "";
  const orgMemoryBlocks = await Promise.all(
    args.readOrgIds.map(async (orgId) => {
      const orgName = args.orgNamesById[String(orgId)] ?? "Linked organization";
      const block = await buildIntelligenceContext(
        ctx,
        orgId,
        args.retrievalQuery,
        relevantPolicyIds.map(String),
      );
      return block.trim().length > 0
        ? `\n\nORG MEMORY FOR ${orgName}\n${block}`
        : "";
    }),
  );
  const requirementBlocks = await Promise.all(
    args.readOrgIds.map(async (orgId) => {
      const orgName = args.orgNamesById[String(orgId)] ?? "Linked organization";
      const block = await buildComplianceRequirementsContext(ctx, orgId);
      return block.trim().length > 0
        ? `\n\nCOMPLIANCE REQUIREMENTS FOR ${orgName}\n${block}`
        : "";
    }),
  );

  return {
    policyContext: policyContextParts.join(""),
    memoryContext,
    orgMemoryBlock: orgMemoryBlocks.join(""),
    requirementsBlock: requirementBlocks.join(""),
    relevantPolicyIds,
  };
}

export async function buildImessageModelMessages(
  args: {
    history: ImessageHistoryMessage[];
    messageText: string;
    currentSpeakerLabel: string;
    attachmentRecords: StoredImessageAttachmentRecord[];
  },
): Promise<ModelMessage[]> {
  const modelMessages: ModelMessage[] = [];

  for (const msg of args.history) {
    if (msg.status === "processing") continue;
    if (msg.role === "user" && msg.content === args.messageText) continue;
    if (isImessageStatusCue(msg)) continue;

    if (msg.role === "user") {
      modelMessages.push({
        role: "user",
        content: msg.userName ? `[${msg.userName}]: ${msg.content}` : msg.content,
      });
    } else if (msg.role === "agent" && msg.content) {
      modelMessages.push({
        role: "assistant",
        content: buildAssistantMessageContentWithArtifacts({
          content: msg.content,
          toolArtifacts: msg.toolArtifacts,
          usedTools: msg.usedTools,
          attachments: msg.attachments,
        }),
      });
    }
  }

  modelMessages.push({
    role: "user",
    content: `[${args.currentSpeakerLabel}]: ${args.messageText}`,
  });

  if (args.attachmentRecords.length === 0) return modelMessages;

  const lastMsg = modelMessages[modelMessages.length - 1];
  if (lastMsg.role !== "user" || typeof lastMsg.content !== "string") {
    return modelMessages;
  }

  const parts: ImessageContentPart[] = [];
  for (const attachment of args.attachmentRecords) {
    if (!attachment.buffer) continue;
    if (attachment.contentType === "application/pdf") {
      const parsedPdfText = await tryBuildParsedPdfText({
        pdfBytes: attachment.buffer,
        documentId: attachment.filename,
        sourceKind: "attachment",
        timeoutMs: 20_000,
      });
      if (parsedPdfText) {
        parts.push({
          type: "text",
          text: `--- PDF attachment: ${attachment.filename} (LiteParse text) ---\n${parsedPdfText}\n--- End PDF attachment ---`,
        });
      } else {
        parts.push({
          type: "file",
          data: attachment.buffer.toString("base64"),
          mediaType: "application/pdf",
        });
      }
    } else if (attachment.contentType.startsWith("image/")) {
      parts.push({
        type: "image",
        image: attachment.buffer.toString("base64"),
        mediaType: attachment.contentType,
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

  return modelMessages;
}
