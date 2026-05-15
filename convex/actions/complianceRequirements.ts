"use node";

import { generateObject } from "ai";
import mammoth from "mammoth";
import { z } from "zod";
import { v } from "convex/values";
import { action } from "../_generated/server";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getModel } from "../lib/models";

const CATEGORY_VALUES = [
  "general_liability",
  "auto",
  "workers_comp",
  "umbrella",
  "professional",
  "cyber",
  "property",
  "other",
] as const;

const RequirementSchema = z.object({
  title: z.string().min(1).max(120),
  category: z.enum(CATEGORY_VALUES),
  requirementText: z.string().min(1).max(4000),
  name: z.string().min(1).max(160).nullable(),
  coverageCode: z.string().min(1).max(80).nullable(),
  limit: z.string().min(1).max(160).nullable(),
  limitAmount: z.number().nonnegative().nullable(),
  limitType: z.string().min(1).max(80).nullable(),
  limitValueType: z.string().min(1).max(80).nullable(),
  deductible: z.string().min(1).max(160).nullable(),
  deductibleAmount: z.number().nonnegative().nullable(),
  deductibleType: z.string().min(1).max(80).nullable(),
  deductibleValueType: z.string().min(1).max(80).nullable(),
  originalContent: z.string().min(1).max(4000).nullable(),
  sourceExcerpt: z.string().min(1).max(4000).nullable(),
  sourcePageStart: z.number().int().positive().nullable(),
  sourcePageEnd: z.number().int().positive().nullable(),
});

const RequirementImportSchema = z.object({
  requirements: z.array(RequirementSchema).max(24),
});

type ImportedRequirement = z.infer<typeof RequirementSchema>;
type ExistingRequirement = {
  title: string;
  requirementText: string;
};

const MAX_SOURCE_CHARS = 40_000;

function truncateSource(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_SOURCE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SOURCE_CHARS);
}

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function optionalString(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalNumber(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeImportedRequirement(requirement: ImportedRequirement) {
  return {
    title: requirement.title,
    category: requirement.category,
    requirementText: requirement.requirementText,
    name: optionalString(requirement.name),
    coverageCode: optionalString(requirement.coverageCode),
    limit: optionalString(requirement.limit),
    limitAmount: optionalNumber(requirement.limitAmount),
    limitType: optionalString(requirement.limitType),
    limitValueType: optionalString(requirement.limitValueType),
    deductible: optionalString(requirement.deductible),
    deductibleAmount: optionalNumber(requirement.deductibleAmount),
    deductibleType: optionalString(requirement.deductibleType),
    deductibleValueType: optionalString(requirement.deductibleValueType),
    originalContent: optionalString(requirement.originalContent),
    sourceExcerpt:
      optionalString(requirement.sourceExcerpt) ??
      optionalString(requirement.originalContent),
    sourcePageStart: optionalNumber(requirement.sourcePageStart),
    sourcePageEnd: optionalNumber(requirement.sourcePageEnd),
  };
}

async function extractPdfText(buffer: ArrayBuffer) {
  const { getDocument, VerbosityLevel } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = (textContent as { items: Array<{ str?: string }> }).items;
    pages.push(items.map((item) => item.str ?? "").join(" "));
  }
  return pages.join("\n\n");
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
}) {
  const lowerName = (fileName ?? "").toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("pdf") || lowerName.endsWith(".pdf")) {
    return await extractPdfText(buffer);
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
    "Unsupported requirement document type. Use TXT, Markdown, PDF, DOCX, CSV, or JSON.",
  );
}

function buildPrompt({
  sourceText,
  existingRequirements,
  appliesTo,
}: {
  sourceText: string;
  existingRequirements: ExistingRequirement[];
  appliesTo: "vendors" | "own_org" | "both";
}) {
  const existing = existingRequirements.length
    ? existingRequirements
        .map(
          (requirement) =>
            `- ${requirement.title}: ${requirement.requirementText}`,
        )
        .join("\n")
    : "None";

  const scope =
    appliesTo === "own_org"
      ? "internal organization insurance requirements"
      : appliesTo === "both"
        ? "insurance requirements that apply to both vendors and the organization"
        : "vendor insurance requirements";

  return `Create a concise checklist of ${scope} from the source text.

Rules:
- Extract only actionable insurance compliance requirements.
- Preserve exact limits, deductibles, endorsements, waiver, additional insured, primary/noncontributory, rating, cancellation notice, and expiration requirements when present.
- Store each requirement in the same shape as a policy coverage: name, coverageCode, limit, limitType, limitValueType, deductible, deductibleType, deductibleValueType, and originalContent when available.
- Set sourceExcerpt to the shortest exact source language that supports the requirement. For PDFs, set sourcePageStart/sourcePageEnd when the page is obvious from page markers; otherwise leave pages null.
- When a minimum coverage amount is stated, set limit to the original limit text and limitAmount to the numeric dollar amount. Example: "$1M per occurrence" becomes limitAmount 1000000.
- When a deductible or retention amount is stated, set deductible to the original deductible text and deductibleAmount to the numeric dollar amount.
- Merge duplicates and split unrelated insurance lines into separate requirements.
- Do not invent requirements not supported by the source.
- Use short titles that make scanning easy.
- Choose the closest category from: ${CATEGORY_VALUES.join(", ")}.
- Avoid duplicating existing requirements.

Existing active requirements:
${existing}

Source text:
${sourceText}`;
}

export const importRequirements = action({
  args: {
    orgId: v.id("organizations"),
    pastedText: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: v.optional(
      v.union(
        v.literal("lease_agreement"),
        v.literal("client_contract"),
        v.literal("vendor_requirements"),
        v.literal("other"),
      ),
    ),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    createdCount: number;
    requirementIds: Id<"insuranceRequirements">[];
  }> => {
    const context: {
      userId: Id<"users">;
      existingRequirements: ExistingRequirement[];
    } = await ctx.runQuery(
      internal.compliance.getRequirementImportContextInternal,
      {
        orgId: args.orgId,
      },
    );

    let sourceText = args.pastedText?.trim() ?? "";
    if (args.fileId) {
      const blob = await ctx.storage.get(args.fileId);
      if (!blob) throw new Error("Requirement document not found");
      const fileText = await extractFileText({
        buffer: await blob.arrayBuffer(),
        fileName: args.fileName,
        contentType: args.contentType,
      });
      sourceText = [sourceText, fileText].filter(Boolean).join("\n\n");
    }

    sourceText = truncateSource(sourceText);
    if (!sourceText)
      throw new Error("Paste text or upload a requirement document first");

    const sourceType =
      args.sourceType ??
      (args.fileName?.toLowerCase().includes("lease")
        ? "lease_agreement"
        : args.fileName?.toLowerCase().includes("contract")
          ? "client_contract"
          : "vendor_requirements");
    const sourceDocumentId: Id<"requirementSourceDocuments"> =
      await ctx.runMutation(
        internal.compliance.createRequirementSourceDocumentInternal,
        {
          orgId: args.orgId,
          userId: context.userId,
          fileId: args.fileId,
          fileName: args.fileName,
          contentType: args.contentType,
          sourceType,
          title:
            args.fileName ||
            `Pasted requirements ${dayjs().format("YYYY-MM-DD HH:mm")}`,
          sourceTextExcerpt: sourceText.slice(0, 4000),
        },
      );

    const model = getModel("chat");
    const result = await generateObject({
      model,
      schema: RequirementImportSchema,
      system:
        "You convert contract and certificate insurance language into coverage-shaped structured compliance requirements for Glass.",
      prompt: buildPrompt({
        sourceText,
        existingRequirements: context.existingRequirements,
        appliesTo: args.appliesTo ?? "vendors",
      }),
    });

    const requirementIds: Id<"insuranceRequirements">[] = await ctx.runMutation(
      internal.compliance.createRequirementsInternal,
      {
        orgId: args.orgId,
        userId: context.userId,
        appliesTo: args.appliesTo,
        sourceDocumentId,
        sourceDocumentName: args.fileName || "Pasted source text",
        sourceType,
        requirements: result.object.requirements.map(
          normalizeImportedRequirement,
        ),
      },
    );

    return { createdCount: requirementIds.length, requirementIds };
  },
});
