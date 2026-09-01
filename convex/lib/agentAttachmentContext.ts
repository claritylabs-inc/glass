"use node";

import type { ModelMessage } from "ai";
import JSZip from "jszip";
import mammoth from "mammoth";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { MAX_AGENT_ATTACHMENT_BYTES } from "./agentAttachmentLimits";
import {
  preparePdfTextWithPdfJs,
  tryBuildParsedPdfText,
} from "./liteparsePreprocessor";
import {
  isUnsupportedSpreadsheetAttachment,
  isXlsxSpreadsheetAttachment,
  spreadsheetBufferToText,
} from "./spreadsheetText";

export type AgentAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
};

export type AgentAttachmentContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string }
  | { type: "file"; data: string; mediaType: string };

export { MAX_AGENT_ATTACHMENT_TEXT_CHARS } from "./agentAttachmentLimits";

function isTextLikeAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("csv") ||
    type.includes("json") ||
    type.includes("xml") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".tsv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".xml")
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

function inferredImageMediaType(filename: string, contentType: string) {
  if (contentType.startsWith("image/")) return contentType;
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function boundedTextPart(args: {
  filename: string;
  label: string;
  endLabel: string;
  text: string;
  truncationLabel: string;
  remainingTextChars: { value: number };
}): AgentAttachmentContentPart | null {
  const text = args.text.trim();
  const remaining = args.remainingTextChars.value;
  if (!text || remaining <= 0) return null;
  const clipped = text.length > remaining ? text.slice(0, remaining) : text;
  args.remainingTextChars.value -= clipped.length;
  const suffix =
    clipped.length < text.length ? `\n--- ${args.truncationLabel} ---` : "";
  return {
    type: "text",
    text: `--- ${args.label}: ${args.filename} ---\n${clipped}${suffix}\n--- ${args.endLabel} ---`,
  };
}

export function modelMessagesHaveImageInput(history: ModelMessage[]) {
  return history.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image"),
  );
}

export function withLatestUserAttachmentParts(
  history: ModelMessage[],
  parts: AgentAttachmentContentPart[],
): ModelMessage[] {
  if (parts.length === 0) return history;
  let currentIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") {
      currentIndex = index;
      break;
    }
  }
  if (currentIndex < 0) return history;
  const current = history[currentIndex];
  if (current.role !== "user") return history;
  const text =
    typeof current.content === "string"
      ? current.content
      : current.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  const next = [...history];
  next[currentIndex] = {
    role: "user",
    content: [...parts, { type: "text", text }],
  };
  return next;
}

export async function buildAgentAttachmentParts(
  ctx: Pick<ActionCtx, "storage">,
  attachments: AgentAttachment[],
  options: {
    includeRichParts: boolean;
    remainingTextChars: { value: number };
  },
): Promise<{ parts: AgentAttachmentContentPart[]; names: string[] }> {
  const parts: AgentAttachmentContentPart[] = [];
  const names: string[] = [];

  for (const attachment of attachments) {
    if (!attachment.fileId) continue;
    try {
      const blob = await ctx.storage.get(attachment.fileId);
      if (!blob) continue;
      if (
        attachment.size > MAX_AGENT_ATTACHMENT_BYTES ||
        blob.size > MAX_AGENT_ATTACHMENT_BYTES
      ) {
        parts.push({
          type: "text",
          text: `--- Attachment unavailable: ${attachment.filename} ---\nThis file is larger than the 25 MB model-input limit.\n--- End unavailable attachment ---`,
        });
        names.push(attachment.filename);
        continue;
      }
      const buffer = Buffer.from(await blob.arrayBuffer());

      if (isPdfAttachment(attachment.filename, attachment.contentType)) {
        if (!options.includeRichParts) continue;
        let parsedPdfText = await tryBuildParsedPdfText({
          pdfBytes: buffer,
          documentId: attachment.fileId,
          sourceKind: "attachment",
          timeoutMs: 20_000,
        });
        let parserLabel = "LiteParse text";
        if (!parsedPdfText) {
          try {
            const fallback = await preparePdfTextWithPdfJs({
              pdfBytes: buffer,
              documentId: attachment.fileId,
              sourceKind: "attachment",
            });
            parsedPdfText = fallback.text.trim() || null;
            parserLabel = "PDF.js text";
          } catch (error) {
            console.warn(
              `[agent-attachment] PDF text fallback failed for ${attachment.filename}`,
              error,
            );
          }
        }
        if (parsedPdfText) {
          const part = boundedTextPart({
            filename: attachment.filename,
            label: `PDF attachment (${parserLabel})`,
            endLabel: "End PDF attachment",
            text: parsedPdfText,
            truncationLabel: "PDF attachment truncated for context",
            remainingTextChars: options.remainingTextChars,
          });
          if (part) parts.push(part);
        } else {
          parts.push({
            type: "file",
            data: buffer.toString("base64"),
            mediaType: "application/pdf",
          });
        }
        names.push(attachment.filename);
      } else if (
        isImageAttachment(attachment.filename, attachment.contentType)
      ) {
        if (!options.includeRichParts) continue;
        parts.push({
          type: "image",
          image: buffer.toString("base64"),
          mediaType: inferredImageMediaType(
            attachment.filename,
            attachment.contentType,
          ),
        });
        names.push(attachment.filename);
      } else if (
        isXlsxSpreadsheetAttachment(attachment.filename, attachment.contentType)
      ) {
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "Spreadsheet attachment",
          endLabel: "End spreadsheet attachment",
          text: await spreadsheetBufferToText(buffer),
          truncationLabel: "Spreadsheet attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else if (
        isUnsupportedSpreadsheetAttachment(
          attachment.filename,
          attachment.contentType,
        )
      ) {
        parts.push({
          type: "text",
          text: `--- Unsupported spreadsheet attachment: ${attachment.filename} ---\nThis spreadsheet was not read. Spot currently reads .xlsx and text-based CSV/TSV attachments; ask for .xlsx, .csv, or .tsv instead.\n--- End unsupported spreadsheet attachment ---`,
        });
        names.push(attachment.filename);
      } else if (
        isDocxAttachment(attachment.filename, attachment.contentType)
      ) {
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "DOCX attachment",
          endLabel: "End DOCX attachment",
          text: await docxBufferToText(buffer),
          truncationLabel: "DOCX attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else if (
        isPresentationAttachment(attachment.filename, attachment.contentType)
      ) {
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "PPTX attachment",
          endLabel: "End PPTX attachment",
          text: await pptxBufferToText(buffer),
          truncationLabel: "PPTX attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else if (
        isTextLikeAttachment(attachment.filename, attachment.contentType)
      ) {
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "Attachment",
          endLabel: "End attachment",
          text: buffer.toString("utf8"),
          truncationLabel: "Attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else {
        parts.push({
          type: "text",
          text: `--- Unsupported attachment: ${attachment.filename} ---\nThis file type could not be read. Use PDF, image, XLSX, CSV/TSV, text, JSON/XML, DOCX, or PPTX.\n--- End unsupported attachment ---`,
        });
        names.push(attachment.filename);
      }
    } catch (error) {
      console.warn(
        `[agent-attachment] Failed to read ${attachment.filename}`,
        error,
      );
      parts.push({
        type: "text",
        text: `--- Attachment unavailable: ${attachment.filename} ---\nThe file could not be read for this turn.\n--- End unavailable attachment ---`,
      });
      names.push(attachment.filename);
    }
  }

  return { parts, names };
}
