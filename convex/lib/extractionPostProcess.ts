"use node";

import { generateObject } from "ai";
import { z } from "zod";
import dayjs from "dayjs";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { applyCoverageDeclarationScoping } from "./coverageScoping";
import { insuranceDocToPolicy } from "./documentMapping";
import { reviewExtractionFields, type FieldReviewApplication } from "./extractionFieldReview";
import { getModelAndRouteForOrg } from "./models";
import { structuredOutputSchemaForRoute } from "./fireworksStructuredOutput";
import { applyPolicyPeriodFallback } from "./policyPeriodExtraction";

type SourceSpanLike = {
  text?: string;
  pageStart?: number;
  pageEnd?: number;
  id?: string;
  sectionId?: string;
  metadata?: Record<string, unknown>;
};

type ExtractionPostProcessOptions = {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  document: Record<string, unknown>;
  sourceSpans: SourceSpanLike[];
  runModelReview?: boolean;
  log?: (message: string, level?: "info" | "warn" | "error") => Promise<void> | void;
};

export type ExtractionPostProcessResult = {
  document: Record<string, unknown>;
  fields: Record<string, unknown>;
  fieldReview: FieldReviewApplication;
  coverageReviewQuestionCount: number;
};

const orgNameNormalizationSchema = z.object({
  carrier: z.string().nullable(),
  security: z.string().nullable(),
  mga: z.string().nullable(),
  broker: z.string().nullable(),
  brokerAgency: z.string().nullable(),
});

const coverageReviewCopySchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    reason: z.string(),
    recommendation: z.string(),
  })),
});

const SOURCE_GROUNDED_IDENTITY_FIELDS = [
  "carrier",
  "security",
  "carrierLegalName",
  "carrierNaicNumber",
  "carrierAmBestRating",
  "carrierAdmittedStatus",
  "underwriter",
  "mga",
  "broker",
  "brokerAgency",
  "brokerContactName",
  "brokerLicenseNumber",
  "programName",
  "policyNumber",
  "quoteNumber",
  "priorPolicyNumber",
  "insuredName",
  "insuredDba",
  "insuredFein",
] as const;

const SOURCE_GROUNDED_PARTY_FIELDS = {
  insurer: ["legalName", "naicNumber", "amBestRating", "amBestNumber", "admittedStatus", "stateOfDomicile"],
  producer: ["agencyName", "contactName", "licenseNumber", "phone", "email"],
} as const;

const SOURCE_PROVENANCE_FIELDS = [
  "sourceSpanIds",
  "documentNodeId",
  "sourceTextHash",
  "pageStart",
  "pageEnd",
] as const;

const SOURCE_BACKED_IDENTITY_FIELDS = [
  "insuredAddress",
  "additionalNamedInsureds",
  "claimsContacts",
  "regulatoryContacts",
  "thirdPartyAdministrators",
  "additionalInsureds",
  "lossPayees",
  "mortgageHolders",
] as const;

const SOURCE_PROVENANCE_FIELD_SET = new Set<string>(SOURCE_PROVENANCE_FIELDS);
const LOW_VALUE_IDENTITY_FIELD_SET = new Set(["role", "relationship", "type", "kind", "label", "status"]);

type RemovedSourceSensitiveValue = {
  field: string;
  value: string;
};

function compactCoverageReviewForPrompt(fields: Record<string, unknown>) {
  const review = fields.extractionReview as { questions?: Array<Record<string, unknown>> } | undefined;
  const questions = Array.isArray(review?.questions) ? review.questions : [];
  return questions.map((question) => ({
    id: question.id,
    coverageName: question.coverageName,
    limitType: question.limitType,
    currentValue: question.currentValue,
    reason: question.reason,
    options: Array.isArray(question.options)
      ? question.options.map((option) => {
        const item = option as Record<string, unknown>;
        const coverage = typeof item.coverage === "object" && item.coverage
          ? item.coverage as Record<string, unknown>
          : {};
        return {
          id: item.id,
          label: item.label,
          value: item.value,
          limitType: item.limitType ?? coverage.limitType,
          source: item.sourceLabel,
          extractedAs: coverage.name,
          originalText: coverage.originalContent,
          reason: item.reason,
        };
      })
      : [],
  }));
}

function normalizedSourceEvidence(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderSourceValue(value: string) {
  return /^(?:unknown|n\/a|na|none|not applicable|not available)$/i.test(value.trim());
}

function sourceTextCorpus(sourceSpans: SourceSpanLike[]) {
  return normalizedSourceEvidence(
    sourceSpans
      .map((span) => typeof span.text === "string" ? span.text : "")
      .filter(Boolean)
      .join("\n"),
  );
}

function knownSourceSpanIds(sourceSpans: SourceSpanLike[]) {
  const ids = new Set<string>();
  for (const span of sourceSpans) {
    if (typeof span.id === "string" && span.id.trim()) ids.add(span.id);
    if (typeof span.sectionId === "string" && span.sectionId.trim()) ids.add(span.sectionId);
  }
  return ids;
}

function sourceSpanTextById(sourceSpans: SourceSpanLike[]) {
  const textById = new Map<string, string>();
  const append = (id: string | undefined, text: string) => {
    if (!id?.trim()) return;
    textById.set(id, [textById.get(id), text].filter(Boolean).join("\n"));
  };

  for (const span of sourceSpans) {
    const text = typeof span.text === "string" ? span.text : "";
    append(span.id, text);
    append(span.sectionId, text);
  }
  return textById;
}

function provenanceSourceSpanIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const ids = (value as Record<string, unknown>).sourceSpanIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

function hasValidSourceProvenance(value: unknown, knownIds: Set<string>) {
  const ids = provenanceSourceSpanIds(value);
  if (ids.length === 0) return false;
  if (knownIds.size === 0) return false;
  return ids.some((id) => knownIds.has(id));
}

function sourceCorpusForProvenance(value: unknown, textById: Map<string, string>) {
  return normalizedSourceEvidence(
    provenanceSourceSpanIds(value)
      .map((id) => textById.get(id) ?? "")
      .filter(Boolean)
      .join("\n"),
  );
}

function sourceEvidenceCandidates(value: string) {
  const trimmed = value.trim();
  const withoutParentheticals = trimmed.replace(/\s*\([^)]*\)/g, " ");
  const withoutTrailingDescriptors = withoutParentheticals
    .replace(/\b(?:a\s+division\s+of|division\s+of|administered\s+by|issued\s+by)\b.*$/i, "")
    .trim();
  const beforeMetadataDelimiter =
    withoutTrailingDescriptors.split(/\s[-–—|]\s/)[0]?.trim() ?? withoutTrailingDescriptors;

  return Array.from(new Set([
    trimmed,
    withoutParentheticals,
    withoutTrailingDescriptors,
    beforeMetadataDelimiter,
  ]
    .map(normalizedSourceEvidence)
    .filter((candidate) => candidate.length >= 3)));
}

function sourceSupportsScalarValue(value: unknown, corpus: string) {
  if (typeof value === "string") {
    if (!value.trim() || isPlaceholderSourceValue(value)) return true;
    return sourceEvidenceCandidates(value).some((candidate) => corpus.includes(candidate));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const candidate = normalizedSourceEvidence(String(value));
    return candidate.length > 0 && corpus.includes(candidate);
  }
  return true;
}

function displayRemovedValue(value: unknown) {
  const display = typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : JSON.stringify(value);
  if (!display) return "";
  return display.length > 120 ? `${display.slice(0, 117)}...` : display;
}

function sourceClaimValues(value: unknown) {
  const claims: unknown[] = [];

  const collect = (item: unknown, key?: string) => {
    if (item === undefined || item === null) return;
    if (key && (SOURCE_PROVENANCE_FIELD_SET.has(key) || LOW_VALUE_IDENTITY_FIELD_SET.has(key))) return;

    if (typeof item === "string") {
      if (normalizedSourceEvidence(item).length >= 3 && !isPlaceholderSourceValue(item)) claims.push(item);
      return;
    }

    if (typeof item === "number" && Number.isFinite(item)) {
      claims.push(item);
      return;
    }

    if (Array.isArray(item)) {
      for (const child of item) collect(child);
      return;
    }

    if (typeof item === "object") {
      for (const [childKey, childValue] of Object.entries(item as Record<string, unknown>)) {
        collect(childValue, childKey);
      }
    }
  };

  collect(value);
  return claims;
}

function hasSourceSupportedClaim(value: unknown, textById: Map<string, string>) {
  const corpus = sourceCorpusForProvenance(value, textById);
  if (!corpus) return false;
  return sourceClaimValues(value).some((claim) => sourceSupportsScalarValue(claim, corpus));
}

function copySourceProvenance(record: Record<string, unknown>) {
  const provenance: Record<string, unknown> = {};
  for (const key of SOURCE_PROVENANCE_FIELDS) {
    if (record[key] !== undefined && record[key] !== null) {
      provenance[key] = record[key];
    }
  }
  return provenance;
}

function sourceGroundedPartyObject(
  field: keyof typeof SOURCE_GROUNDED_PARTY_FIELDS,
  value: unknown,
  corpus: string,
  sourceSpanIds: Set<string>,
  sourceTextById: Map<string, string>,
  removed: RemovedSourceSensitiveValue[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasValidSourceProvenance(record, sourceSpanIds)) {
    removed.push({ field, value: "missing or invalid source spans" });
    return undefined;
  }
  const allowedFields = SOURCE_GROUNDED_PARTY_FIELDS[field];
  const primaryField = allowedFields[0];
  const primaryValue = record[primaryField];
  const recordCorpus = sourceCorpusForProvenance(record, sourceTextById) || corpus;
  if (
    typeof primaryValue !== "string" ||
    !primaryValue.trim() ||
    !sourceSupportsScalarValue(primaryValue, recordCorpus)
  ) {
    removed.push({ field, value: displayRemovedValue(record[primaryField] ?? value) });
    return undefined;
  }

  const next: Record<string, unknown> = copySourceProvenance(record);
  for (const key of allowedFields) {
    const raw = record[key];
    if (raw === undefined || raw === null) continue;
    if (sourceSupportsScalarValue(raw, recordCorpus)) {
      next[key] = raw;
    } else {
      removed.push({ field: `${field}.${key}`, value: displayRemovedValue(raw) });
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function sourceBackedIdentityValue(
  field: string,
  value: unknown,
  sourceSpanIds: Set<string>,
  sourceTextById: Map<string, string>,
  removed: RemovedSourceSensitiveValue[],
) {
  if (Array.isArray(value)) {
    const kept = value.filter((item, index) => {
      if (
        hasValidSourceProvenance(item, sourceSpanIds) &&
        hasSourceSupportedClaim(item, sourceTextById)
      ) {
        return true;
      }
      const reason = hasValidSourceProvenance(item, sourceSpanIds)
        ? "source span does not support value"
        : "missing or invalid source spans";
      removed.push({ field: `${field}[${index}]`, value: reason });
      return false;
    });
    return kept.length > 0 || value.length === 0 ? kept : undefined;
  }

  if (hasValidSourceProvenance(value, sourceSpanIds) && hasSourceSupportedClaim(value, sourceTextById)) {
    return value;
  }
  const removedValue = hasValidSourceProvenance(value, sourceSpanIds)
    ? "source span does not support value"
    : "missing or invalid source spans";
  removed.push({ field, value: removedValue });
  return undefined;
}

export function stripUngroundedSourceSensitiveValues<T extends Record<string, unknown>>(
  value: T,
  sourceSpans: SourceSpanLike[],
): { value: T; removed: RemovedSourceSensitiveValue[] } {
  const corpus = sourceTextCorpus(sourceSpans);
  const sourceSpanIds = knownSourceSpanIds(sourceSpans);
  const sourceTextById = sourceSpanTextById(sourceSpans);
  const next: Record<string, unknown> = { ...value };
  const removed: RemovedSourceSensitiveValue[] = [];

  for (const field of SOURCE_GROUNDED_IDENTITY_FIELDS) {
    const raw = next[field];
    if (raw === undefined || raw === null || sourceSupportsScalarValue(raw, corpus)) continue;
    removed.push({ field, value: displayRemovedValue(raw) });
    delete next[field];
  }

  for (const field of SOURCE_BACKED_IDENTITY_FIELDS) {
    if (next[field] === undefined || next[field] === null) continue;
    const grounded = sourceBackedIdentityValue(field, next[field], sourceSpanIds, sourceTextById, removed);
    if (grounded !== undefined) {
      next[field] = grounded;
    } else {
      delete next[field];
    }
  }

  for (const field of Object.keys(SOURCE_GROUNDED_PARTY_FIELDS) as Array<keyof typeof SOURCE_GROUNDED_PARTY_FIELDS>) {
    if (next[field] === undefined || next[field] === null) continue;
    const party = sourceGroundedPartyObject(field, next[field], corpus, sourceSpanIds, sourceTextById, removed);
    if (party) {
      next[field] = party;
    } else {
      delete next[field];
    }
  }

  return { value: next as T, removed };
}

async function logRemovedSourceSensitiveValues(
  removed: RemovedSourceSensitiveValue[],
  log?: ExtractionPostProcessOptions["log"],
) {
  const seen = new Set<string>();
  for (const item of removed) {
    const key = `${item.field}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await log?.(
      `Dropped ungrounded extracted ${item.field}: ${item.value || "value not present in source spans"}`,
      "warn",
    );
  }
}

async function refineCoverageReviewCopyWithLlm(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const review = fields.extractionReview as { questions?: Array<Record<string, unknown>> } | undefined;
  const questions = Array.isArray(review?.questions) ? review.questions : [];
  if (questions.length === 0) return fields;

  try {
    const modelRoute = await getModelAndRouteForOrg(ctx, orgId, "extraction");
    const result = await generateObject({
      model: modelRoute.model,
      schema: structuredOutputSchemaForRoute(coverageReviewCopySchema, modelRoute.route),
      prompt: `Rewrite coverage extraction review questions for a broker or client reviewing an insurance policy.

Rules:
- Keep each id unchanged.
- Write clear, plain questions. Avoid duplicated words like "limit limit".
- Do not ask users to choose between terms that can all be true. If options are a deductible, retroactive date, aggregate, and per-occurrence/per-claim limit, explain that the recommendation is the actual coverage limit and the others are separate policy terms.
- Use "per occurrence" in user-facing wording instead of "per claim" unless quoting source text.
- Include a short reason that explains why review is needed.
- Include a short recommendation sentence that names the recommended option and why source evidence supports it.
- Do not use jargon like extraction slot, candidate, or model.
- Keep question under 120 characters and reason/recommendation under 180 characters.

Review JSON:
${JSON.stringify(compactCoverageReviewForPrompt(fields))}`,
    });

    const copyById = new Map(result.object.questions.map((question) => [question.id, question]));
    return {
      ...fields,
      extractionReview: {
        ...(review ?? {}),
        questions: questions.map((question) => {
          const copy = typeof question.id === "string" ? copyById.get(question.id) : undefined;
          return copy
            ? {
              ...question,
              question: copy.question,
              reason: copy.reason,
              recommendation: copy.recommendation,
            }
            : question;
        }),
      },
    };
  } catch (err) {
    console.warn(
      `LLM coverage-review copy failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fields;
  }
}

async function normalizeOrgNamesWithLlm(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const candidates = {
    carrier: typeof fields.carrier === "string" ? fields.carrier : undefined,
    security: typeof fields.security === "string" ? fields.security : undefined,
    mga: typeof fields.mga === "string" ? fields.mga : undefined,
    broker: typeof fields.broker === "string" ? fields.broker : undefined,
    brokerAgency: typeof fields.brokerAgency === "string" ? fields.brokerAgency : undefined,
  };
  if (!Object.values(candidates).some(Boolean)) return fields;

  try {
    const modelRoute = await getModelAndRouteForOrg(ctx, orgId, "extraction");
    const result = await generateObject({
      model: modelRoute.model,
      schema: structuredOutputSchemaForRoute(orgNameNormalizationSchema, modelRoute.route),
      prompt: `Normalize insurance organization display names.

Rules:
- Return concise user-facing names only.
- Remove legal/disclaimer suffixes, "administered by" clauses, and parenthetical metadata.
- Keep the canonical brand/entity name.
- If input is already concise, keep it unchanged.
- Return every schema key. Use null for missing input keys.

Input JSON:
${JSON.stringify(candidates)}`,
    });

    const normalized = result.object;
    return {
      ...fields,
      carrier: normalized.carrier ?? fields.carrier,
      security: normalized.security ?? fields.security,
      mga: normalized.mga ?? fields.mga,
      broker: normalized.broker ?? fields.broker,
      brokerAgency: normalized.brokerAgency ?? fields.brokerAgency,
    };
  } catch (err) {
    console.warn(
      `LLM org-name normalization failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fields;
  }
}

function openReviewQuestionCount(fields: Record<string, unknown>) {
  const review = fields.extractionReview as { questions?: Array<Record<string, unknown>> } | undefined;
  if (!Array.isArray(review?.questions)) return 0;
  return review.questions.filter((question) =>
    typeof question.id === "string" &&
    question.status !== "confirmed" &&
    question.status !== "dismissed"
  ).length;
}

export async function postProcessExtractionDocument(
  options: ExtractionPostProcessOptions,
): Promise<ExtractionPostProcessResult> {
  let document = options.document;
  const runModelReview = options.runModelReview ?? true;

  const periodFallback = applyPolicyPeriodFallback(
    document,
    options.sourceSpans.map((span) => ({
      text: typeof span.text === "string" ? span.text : undefined,
      pageStart: typeof span.pageStart === "number" ? span.pageStart : undefined,
    })),
  );
  if (periodFallback.changed) {
    document = periodFallback.document;
    await options.log?.(
      `Policy period verified from source text: ${periodFallback.period?.effectiveDate} to ${periodFallback.period?.expirationDate}`,
      "info",
    );
  }

  const fieldReview = runModelReview
    ? await reviewExtractionFields({
      ctx: options.ctx,
      orgId: options.orgId,
      document,
      sourceSpans: options.sourceSpans,
      log: options.log,
    })
    : { document, applied: [], skipped: [] };
  document = fieldReview.document;
  const groundedDocument = stripUngroundedSourceSensitiveValues(document, options.sourceSpans);
  document = groundedDocument.value;
  await logRemovedSourceSensitiveValues(groundedDocument.removed, options.log);

  const mappedFields = insuranceDocToPolicy(document as never);
  const scopedCoverage = applyCoverageDeclarationScoping({
    fields: mappedFields,
    sourceSpans: options.sourceSpans,
    nowMs: dayjs().valueOf(),
  });
  if (scopedCoverage.changed && scopedCoverage.review.questions.length > 0) {
    await options.log?.(
      `Coverage scoping found ${scopedCoverage.review.questions.length} limit question${scopedCoverage.review.questions.length === 1 ? "" : "s"} for declaration review`,
      "warn",
    );
  }

  const reviewCopyFields = runModelReview
    ? await refineCoverageReviewCopyWithLlm(
      options.ctx,
      options.orgId,
      scopedCoverage.fields,
    )
    : scopedCoverage.fields;
  const fields = runModelReview
    ? await normalizeOrgNamesWithLlm(
      options.ctx,
      options.orgId,
      reviewCopyFields,
    )
    : reviewCopyFields;
  const groundedFields = stripUngroundedSourceSensitiveValues(fields, options.sourceSpans);
  await logRemovedSourceSensitiveValues(groundedFields.removed, options.log);

  return {
    document,
    fields: groundedFields.value,
    fieldReview,
    coverageReviewQuestionCount: openReviewQuestionCount(groundedFields.value),
  };
}

export function openExtractionReviewQuestions(value: unknown): Array<Record<string, unknown>> {
  const review = value as { questions?: Array<Record<string, unknown>> } | undefined;
  if (!Array.isArray(review?.questions)) return [];
  return review.questions.filter((question) =>
    typeof question.id === "string" &&
    question.status !== "confirmed" &&
    question.status !== "dismissed"
  );
}
