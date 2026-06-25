"use node";

import { generateObject } from "ai";
import mammoth from "mammoth";
import { z } from "zod";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModelAndRouteForOrg, getProviderOptionsForTask } from "../lib/models";
import { structuredOutputSchemaForRoute } from "../lib/fireworksStructuredOutput";
import { tryBuildParsedPdfText } from "../lib/liteparsePreprocessor";

const MAX_SOURCE_CHARS = 40_000;
const PDF_APPLICATION_TIMEOUT_MS = 20_000;

const AuthoredQuestionSchema = z.object({
  section: z.string().min(1).max(120).nullable(),
  label: z.string().min(1).max(160),
  prompt: z.string().min(1).max(500),
  required: z.boolean(),
});

const QuestionAuthoringSchema = z.object({
  questions: z.array(AuthoredQuestionSchema).min(1).max(80),
});

type AuthoredQuestion = z.infer<typeof AuthoredQuestionSchema>;

function truncateSource(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_SOURCE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SOURCE_CHARS);
}

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

async function extractPdfApplicationText(
  buffer: ArrayBuffer,
  fileName?: string,
): Promise<string> {
  const liteParsedText = await tryBuildParsedPdfText({
    pdfBytes: new Uint8Array(buffer),
    documentId: fileName || "application-document",
    sourceKind: "attachment",
    maxChars: MAX_SOURCE_CHARS,
    timeoutMs: PDF_APPLICATION_TIMEOUT_MS,
  });
  if (!liteParsedText) {
    throw new Error("Could not extract text from the application PDF");
  }
  return liteParsedText;
}

async function extractDocxText(buffer: ArrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function extractFileText({
  buffer,
  fileName,
  contentType,
}: {
  buffer: ArrayBuffer;
  fileName?: string;
  contentType?: string;
}): Promise<string> {
  const lowerName = (fileName ?? "").toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("pdf") || lowerName.endsWith(".pdf")) {
    return await extractPdfApplicationText(buffer, fileName);
  }
  if (type.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    return await extractDocxText(buffer);
  }
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("csv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json")
  ) {
    return decodeText(buffer);
  }
  throw new Error(
    "Unsupported application document type. Use TXT, Markdown, PDF, DOCX, CSV, or JSON.",
  );
}

function buildPrompt({
  sourceText,
  lineOfBusiness,
  product,
  fileName,
}: {
  sourceText: string;
  lineOfBusiness?: string;
  product?: string;
  fileName?: string;
}) {
  return `Turn the source material into structured application questions for a commercial insurance intake.

Context:
- Line: ${lineOfBusiness?.trim() || "Not specified"}
- Product: ${product?.trim() || "Not specified"}
- Source file: ${fileName || "Pasted text"}

Rules:
- Extract only questions or applicant-provided fields needed to complete the application.
- Convert field labels, table rows, and fragments into clear applicant-facing questions.
- Preserve the source meaning; do not invent questions that are not supported by the source.
- Remove carrier instructions, disclaimers, signatures, broker-only notes, duplicate fields, and page chrome.
- Group questions with concise section names when the source has obvious sections.
- Set section to null only when no useful group is obvious.
- Use short labels that scan well in a broker/client UI.
- Use prompt for the full question the client should answer.
- Set required to false only when the source explicitly marks the item optional.
- Merge duplicate questions and keep the most complete wording.

Source material:
${sourceText}`;
}

function normalizeQuestion(question: AuthoredQuestion) {
  const label = question.label.trim().replace(/[?.:]+$/g, "");
  const prompt = question.prompt.trim();
  const section = question.section?.trim() || undefined;
  return {
    label: label || prompt.slice(0, 160),
    prompt,
    section,
    required: question.required,
  };
}

function questionFieldId(label: string, index: number, used: Set<string>) {
  const normalized = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  const base = normalized || `field_${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const suffixText = `_${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 64 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export const formatQuestions = action({
  args: {
    orgId: v.id("organizations"),
    pastedText: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
    product: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.applicationIntakes.assertQuestionAuthoringAccess, {
      orgId: args.orgId,
    });

    let sourceText = args.pastedText?.trim() ?? "";
    if (args.fileId) {
      const blob = await ctx.storage.get(args.fileId);
      if (!blob) throw new Error("Application document not found");
      const extractedText = await extractFileText({
        buffer: await blob.arrayBuffer(),
        fileName: args.fileName,
        contentType: args.contentType,
      });
      sourceText = [sourceText, extractedText].filter(Boolean).join("\n\n");
    }

    sourceText = truncateSource(sourceText);
    if (!sourceText) {
      throw new Error("Paste questions or upload an application document first");
    }

    const modelRoute = await getModelAndRouteForOrg(ctx, args.orgId, "application_authoring");
    const result = await generateObject({
      model: modelRoute.model,
      providerOptions: getProviderOptionsForTask("application_authoring"),
      schema: structuredOutputSchemaForRoute(QuestionAuthoringSchema, modelRoute.route),
      system:
        "You format commercial insurance application source material into clean structured JSON questions for Glass.",
      prompt: buildPrompt({
        sourceText,
        lineOfBusiness: args.lineOfBusiness,
        product: args.product,
        fileName: args.fileName,
      }),
    });

    const usedFieldIds = new Set<string>();
    return {
      questions: result.object.questions.map((question, index) => {
        const normalized = normalizeQuestion(question);
        return {
          fieldId: questionFieldId(normalized.label, index, usedFieldIds),
          ...normalized,
        };
      }),
    };
  },
});
