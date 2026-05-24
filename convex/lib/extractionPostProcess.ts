"use node";

import { generateObject } from "ai";
import { z } from "zod";
import dayjs from "dayjs";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { applyCoverageDeclarationScoping } from "./coverageScoping";
import { insuranceDocToPolicy } from "./documentMapping";
import { reviewExtractionFields, type FieldReviewApplication } from "./extractionFieldReview";
import { getModelForOrg } from "./models";
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

async function refineCoverageReviewCopyWithLlm(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const review = fields.extractionReview as { questions?: Array<Record<string, unknown>> } | undefined;
  const questions = Array.isArray(review?.questions) ? review.questions : [];
  if (questions.length === 0) return fields;

  try {
    const model = await getModelForOrg(ctx, orgId, "extraction");
    const result = await generateObject({
      model,
      schema: coverageReviewCopySchema,
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
    const model = await getModelForOrg(ctx, orgId, "extraction");
    const result = await generateObject({
      model,
      schema: orgNameNormalizationSchema,
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

  const fieldReview = await reviewExtractionFields({
    ctx: options.ctx,
    orgId: options.orgId,
    document,
    sourceSpans: options.sourceSpans,
    log: options.log,
  });
  document = fieldReview.document;

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

  const reviewCopyFields = await refineCoverageReviewCopyWithLlm(
    options.ctx,
    options.orgId,
    scopedCoverage.fields,
  );
  const fields = await normalizeOrgNamesWithLlm(
    options.ctx,
    options.orgId,
    reviewCopyFields,
  );

  return {
    document,
    fields,
    fieldReview,
    coverageReviewQuestionCount: openReviewQuestionCount(fields),
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
