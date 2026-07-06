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
import type { StoredImessageAttachmentRecord } from "./imessageIngress";
import { tryBuildParsedPdfText } from "./liteparsePreprocessor";

export type ImessageHistoryMessage = {
  status?: string;
  role: string;
  content: string;
  userName?: string;
  responseMessageId?: string;
  toolArtifacts?: Array<{ type: string; data: unknown }>;
};

type ImessageContentPart =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mediaType: string }
  | { type: "image"; image: string; mediaType: string };

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
