"use node";

import mammoth from "mammoth";
import { z } from "zod";
import { v } from "convex/values";
import dayjs from "dayjs";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateObjectForOrg } from "../lib/models";
import { tryBuildParsedPdfText } from "../lib/liteparsePreprocessor";
import {
  REQUIREMENT_CONDITION_TYPES,
  REQUIREMENT_LIMIT_KINDS,
  REQUIREMENT_PROVISIONS,
  REQUIREMENT_SCOPES,
  type RequirementScope,
} from "../lib/complianceTypes";
import { ACORD_LOB_LABELS, isLobCode } from "../lib/linesOfBusiness";

const COMMON_COMMERCIAL_LOBS = [
  "CGL",
  "GL",
  "AUTOB",
  "WORK",
  "WCMA",
  "UMBRC",
  "EXLIA",
  "EO",
  "PL",
  "PROPC",
  "PROP",
  "BOP",
  "CRIME",
  "EPLI",
  "DO",
  "FIDUC",
  "INMRC",
  "OLIB",
] as const;

const LobSchema = z.string().refine((value) => isLobCode(value), {
  message: "Expected an ACORD line-of-business code",
});

const sourceDocumentTypeValidator = v.union(
  v.literal("lease_agreement"),
  v.literal("client_contract"),
  v.literal("vendor_requirements"),
  v.literal("other"),
);

const ScopeSchema = z.enum(REQUIREMENT_SCOPES);

const RequirementSchema = z.object({
  kind: z.enum(["coverage", "insurer", "condition"]),
  scope: ScopeSchema.nullable(),
  title: z.string().min(1).max(120),
  requirementText: z.string().min(1).max(4000),
  lineOfBusiness: LobSchema.nullable(),
  limits: z
    .array(
      z.object({
        kind: z.enum(REQUIREMENT_LIMIT_KINDS),
        amount: z.number().nonnegative(),
        label: z.string().min(1).max(160).nullable(),
      }),
    )
    .max(12)
    .nullable(),
  maxDeductible: z
    .object({
      amount: z.number().nonnegative(),
      label: z.string().min(1).max(160).nullable(),
    })
    .nullable(),
  coverageForm: z.enum(["occurrence", "claims_made"]).nullable(),
  retroactiveDateOnOrBefore: z.string().min(1).max(60).nullable(),
  provisions: z.array(z.enum(REQUIREMENT_PROVISIONS)).max(8).nullable(),
  requiredForms: z.array(z.string().min(1).max(40)).max(12).nullable(),
  minAmBestRating: z.string().min(1).max(20).nullable(),
  minAmBestFinancialSize: z.string().min(1).max(20).nullable(),
  admittedRequired: z.boolean().nullable(),
  conditionType: z.enum(REQUIREMENT_CONDITION_TYPES).nullable(),
  noticeDays: z.number().int().nonnegative().nullable(),
  sourceExcerpt: z.string().min(1).max(4000),
  sourcePageStart: z.number().int().positive().nullable(),
  sourcePageEnd: z.number().int().positive().nullable(),
});

const RequirementImportSchema = z.object({
  requirements: z.array(RequirementSchema).max(32),
});

type ImportedRequirement = z.infer<typeof RequirementSchema>;
type ExistingRequirement = {
  kind: string;
  scope: string;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  conditionType?: string;
};
type RequirementImportContext = {
  userId: Id<"users">;
  existingRequirements: ExistingRequirement[];
};
type ExtractedFileText = {
  text: string;
  parserBackend?: "liteparse" | "pdfjs" | "mammoth" | "plain_text";
  parsedAt?: number;
};

const MAX_SOURCE_CHARS = 40_000;
const PDF_REQUIREMENT_WORKER_TIMEOUT_MS = 20_000;

function truncateSource(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_SOURCE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SOURCE_CHARS);
}

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function optionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function scopeFromArgs(args: {
  scope?: RequirementScope;
  appliesTo?: RequirementScope | "both";
}): RequirementScope {
  if (args.scope) return args.scope;
  return args.appliesTo === "own_org" ? "own_org" : "vendors";
}

function normalizeImportedRequirement(
  requirement: ImportedRequirement,
  defaultScope: RequirementScope,
) {
  const kind = requirement.kind;
  const scope = requirement.scope ?? defaultScope;
  return {
    kind,
    scope,
    title: requirement.title.trim(),
    requirementText: requirement.requirementText.trim(),
    lineOfBusiness:
      kind === "coverage" ? optionalString(requirement.lineOfBusiness) : undefined,
    limits:
      kind === "coverage"
        ? (requirement.limits ?? []).map((limit) => ({
          kind: limit.kind,
          amount: limit.amount,
          label: optionalString(limit.label),
        }))
        : undefined,
    maxDeductible:
      kind === "coverage" && requirement.maxDeductible
        ? {
          amount: requirement.maxDeductible.amount,
          label: optionalString(requirement.maxDeductible.label),
        }
        : undefined,
    coverageForm: kind === "coverage" ? requirement.coverageForm ?? undefined : undefined,
    retroactiveDateOnOrBefore:
      kind === "coverage"
        ? optionalString(requirement.retroactiveDateOnOrBefore)
        : undefined,
    provisions: kind === "coverage" ? requirement.provisions ?? undefined : undefined,
    requiredForms: kind === "coverage" ? requirement.requiredForms ?? undefined : undefined,
    minAmBestRating:
      kind === "insurer" ? optionalString(requirement.minAmBestRating) : undefined,
    minAmBestFinancialSize:
      kind === "insurer"
        ? optionalString(requirement.minAmBestFinancialSize)
        : undefined,
    admittedRequired:
      kind === "insurer" ? requirement.admittedRequired ?? undefined : undefined,
    conditionType:
      kind === "condition" ? requirement.conditionType ?? "other" : undefined,
    noticeDays:
      kind === "condition" ? optionalNumber(requirement.noticeDays) : undefined,
    sourceExcerpt: requirement.sourceExcerpt.trim(),
    sourcePageStart: optionalNumber(requirement.sourcePageStart),
    sourcePageEnd: optionalNumber(requirement.sourcePageEnd),
  };
}

async function extractPdfRequirementText(
  buffer: ArrayBuffer,
  fileName?: string,
): Promise<ExtractedFileText> {
  const pdfBytes = new Uint8Array(buffer);
  const liteParsedText = await tryBuildParsedPdfText({
    pdfBytes,
    documentId: fileName || "requirement-document",
    sourceKind: "attachment",
    maxChars: MAX_SOURCE_CHARS,
    timeoutMs: PDF_REQUIREMENT_WORKER_TIMEOUT_MS,
  });
  if (!liteParsedText) {
    throw new Error("Could not extract text from the requirement PDF");
  }
  return {
    text: liteParsedText,
    parserBackend: "liteparse",
    parsedAt: dayjs().valueOf(),
  };
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
}): Promise<ExtractedFileText> {
  const lowerName = (fileName ?? "").toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("pdf") || lowerName.endsWith(".pdf")) {
    return await extractPdfRequirementText(buffer, fileName);
  }
  if (type.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    return { text: await extractDocxText(buffer), parserBackend: "mammoth" };
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
    return { text: decodeText(buffer), parserBackend: "plain_text" };
  }
  throw new Error(
    "Unsupported requirement document type. Use TXT, Markdown, PDF, DOCX, CSV, or JSON.",
  );
}

function buildPrompt({
  sourceText,
  existingRequirements,
  scope,
}: {
  sourceText: string;
  existingRequirements: ExistingRequirement[];
  scope: RequirementScope;
}) {
  const existing = existingRequirements.length
    ? existingRequirements
        .map(
          (requirement) =>
            `- ${requirement.kind}/${requirement.scope}/${requirement.lineOfBusiness ?? requirement.conditionType ?? "n/a"}: ${requirement.title}: ${requirement.requirementText}`,
        )
        .join("\n")
    : "None";
  const commonLobs = COMMON_COMMERCIAL_LOBS.map(
    (code) => `${code}: ${ACORD_LOB_LABELS[code]}`,
  ).join("\n");

  return `Create a concise, source-backed insurance compliance rule set from the source text.

Default scope: ${scope}. Use "vendors" for requirements vendors/contractors must satisfy. Use "own_org" for requirements this organization must satisfy.

Each rule must be one of:
- coverage: policy coverage requirement that can be checked against structured policy coverages.
- insurer: carrier/insurer standard such as AM Best rating, financial size, admitted/licensed status. These are manually verified in v1.
- condition: administrative obligation such as cancellation notice, certificate delivery, claims reporting, or subcontractor insurance. These are manually verified in v1.

Coverage rules:
- Set lineOfBusiness to an ACORD code. Use one of these common commercial codes when possible:
${commonLobs}
- Split unrelated insurance lines into separate rules.
- Extract each required limit into limits[] with kind, amount, and original label.
- Use limit kinds only from: ${REQUIREMENT_LIMIT_KINDS.join(", ")}.
- Extract provisions from: ${REQUIREMENT_PROVISIONS.join(", ")}.
- Extract required endorsement/form numbers such as CG 20 10 or CG 20 37 into requiredForms.
- Extract max deductible/retention only when the source states a ceiling.

Insurer rules:
- Store AM Best rating and financial size fields when stated.
- Keep carrier ratings manual; do not invent rating data.

Condition rules:
- Use conditionType from: ${REQUIREMENT_CONDITION_TYPES.join(", ")}.
- Use noticeDays for cancellation/nonrenewal notice periods.

For every rule:
- sourceExcerpt is required and should be the shortest exact source language supporting the rule.
- Set source pages when obvious from page markers; otherwise leave null.
- Do not invent unsupported requirements.
- Merge duplicates and avoid duplicating existing requirements.
- Keep titles short and scannable.

Existing active requirements:
${existing}

Source text:
${sourceText}`;
}

async function runRequirementImport(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    pastedText?: string;
    fileId?: Id<"_storage">;
    fileName?: string;
    contentType?: string;
    sourceType?: "lease_agreement" | "client_contract" | "vendor_requirements" | "other";
    scope?: RequirementScope;
    appliesTo?: RequirementScope | "both";
  },
  context: RequirementImportContext,
  titlePrefix: "Pasted requirements" | "Mailbox requirements",
  fallbackSourceDocumentName: "Pasted source text" | "Mailbox source text",
): Promise<{
  createdCount: number;
  requirementIds: Id<"insuranceRequirements">[];
}> {
  let sourceText = args.pastedText?.trim() ?? "";
  let fileExtraction: ExtractedFileText | undefined;
  if (args.fileId) {
    const blob = await ctx.storage.get(args.fileId);
    if (!blob) throw new Error("Requirement document not found");
    fileExtraction = await extractFileText({
      buffer: await blob.arrayBuffer(),
      fileName: args.fileName,
      contentType: args.contentType,
    });
    sourceText = [sourceText, fileExtraction.text].filter(Boolean).join("\n\n");
  }

  sourceText = truncateSource(sourceText);
  if (!sourceText) {
    throw new Error("Paste text or upload a requirement document first");
  }
  const sourceType =
    args.sourceType ??
    (args.fileName?.toLowerCase().includes("lease")
      ? "lease_agreement"
      : args.fileName?.toLowerCase().includes("contract")
        ? "client_contract"
        : "vendor_requirements");
  const scope = scopeFromArgs(args);

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
          `${titlePrefix} ${dayjs().format("YYYY-MM-DD HH:mm")}`,
        sourceTextExcerpt: sourceText.slice(0, 4000),
        parserBackend: fileExtraction?.parserBackend,
        parsedAt: fileExtraction?.parsedAt,
      },
    );

  const result = await generateObjectForOrg(ctx, args.orgId, "requirement_extraction", {
    schema: RequirementImportSchema,
    system:
      "You convert contract, lease, certificate, and vendor insurance language into typed ACORD-25-style compliance rules for Glass.",
    prompt: buildPrompt({
      sourceText,
      existingRequirements: context.existingRequirements,
      scope,
    }),
  });

  const requirementIds: Id<"insuranceRequirements">[] = await ctx.runMutation(
    internal.compliance.createRequirementsInternal,
    {
      orgId: args.orgId,
      userId: context.userId,
      scope,
      sourceDocumentId,
      sourceDocumentName: args.fileName || fallbackSourceDocumentName,
      sourceType,
      requirements: result.object.requirements.map((requirement) =>
        normalizeImportedRequirement(requirement, scope),
      ),
    },
  );

  return { createdCount: requirementIds.length, requirementIds };
}

export const importRequirements = action({
  args: {
    orgId: v.id("organizations"),
    pastedText: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: v.optional(sourceDocumentTypeValidator),
    scope: v.optional(v.union(v.literal("vendors"), v.literal("own_org"))),
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
    const context: RequirementImportContext = await ctx.runQuery(
      internal.compliance.getRequirementImportContextInternal,
      { orgId: args.orgId },
    );
    return await runRequirementImport(
      ctx,
      args,
      context,
      "Pasted requirements",
      "Pasted source text",
    );
  },
});

export const importRequirementsInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    pastedText: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: v.optional(sourceDocumentTypeValidator),
    scope: v.optional(v.union(v.literal("vendors"), v.literal("own_org"))),
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
    const context: RequirementImportContext = await ctx.runQuery(
      internal.compliance.getRequirementImportContextForUserInternal,
      { orgId: args.orgId, userId: args.userId },
    );
    return await runRequirementImport(
      ctx,
      args,
      context,
      "Mailbox requirements",
      "Mailbox source text",
    );
  },
});
