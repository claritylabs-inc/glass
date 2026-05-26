"use node";

import { generateObject } from "ai";
import { z } from "zod";
import { sanitizeNulls } from "@claritylabs/cl-sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getModelForOrg } from "./models";
import { normalizeExtractedString } from "./valueNormalization";

type SourceLike = {
  id?: string;
  text?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  metadata?: Record<string, unknown>;
};

type FieldReviewGroup = {
  id: string;
  label: string;
  fields: string[];
  keywords: string[];
  instructions: string;
};

export type FieldReviewOptions = {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  document: Record<string, unknown>;
  sourceSpans: SourceLike[];
  log?: (message: string, level?: "info" | "warn" | "error") => Promise<void> | void;
};

type ReviewCorrection = {
  field: string;
  value: unknown;
  confidence: "high" | "medium" | "low";
  reason: string;
  evidenceQuote: string;
};

type ReviewResult = {
  groupId: string;
  corrections: ReviewCorrection[];
};

export type FieldReviewApplication = {
  document: Record<string, unknown>;
  applied: Array<ReviewCorrection & { groupId: string }>;
  skipped: Array<ReviewCorrection & { groupId: string; reasonSkipped: string }>;
};

const FIELD_REVIEW_GROUPS: FieldReviewGroup[] = [
  {
    id: "identity_and_period",
    label: "Identity and policy period",
    fields: [
      "carrier",
      "security",
      "mga",
      "brokerAgency",
      "policyNumber",
      "quoteNumber",
      "insuredName",
      "effectiveDate",
      "expirationDate",
      "proposedEffectiveDate",
      "proposedExpirationDate",
    ],
    keywords: [
      "policy number",
      "quote number",
      "named insured",
      "insured",
      "carrier",
      "insurer",
      "underwriter",
      "mga",
      "broker",
      "effective",
      "expiration",
      "period",
    ],
    instructions:
      "Verify carrier/security, MGA, broker, policy or quote number, named insured, and policy period fields. Prefer declaration pages and schedule summaries over policy wording. For named insured, use rows explicitly labeled named insured/insured/applicant and do not use authorized officer contacts, notice contacts, broker/producer names, signatures, incorporation/licensing statements, or corporate-authority wording as the insured.",
  },
  {
    id: "financial_terms",
    label: "Premiums, taxes, fees, and payment terms",
    fields: [
      "premium",
      "premiumAmount",
      "totalCost",
      "totalCostAmount",
      "minimumPremium",
      "minimumPremiumAmount",
      "depositPremium",
      "depositPremiumAmount",
      "premiumBreakdown",
      "taxesAndFees",
      "paymentPlan",
    ],
    keywords: [
      "premium",
      "annual premium",
      "total payable",
      "total cost",
      "tax",
      "fee",
      "surcharge",
      "minimum earned",
      "minimum premium",
      "deposit premium",
      "payment",
    ],
    instructions:
      "Verify all money-related fields. Prefer declaration/schedule tables over definitions, exclusions, application summaries, licensing statements, and premium-basis descriptions. Annual or term premium belongs in premium, total payable/due belongs in totalCost, minimum earned/deposit terms belong in minimumPremium/depositPremium, and itemized taxes/fees belong only in taxesAndFees. When correcting money fields, also correct the paired numeric amount field without currency symbols or commas when evidence directly states the number. Capture premium table rows as structured premiumBreakdown and taxesAndFees when source evidence contains rows but the current extraction missed them.",
  },
  {
    id: "coverage_terms",
    label: "Coverage limits and deductibles",
    fields: ["coverages", "limits", "deductibles", "coverageForm", "retroactiveDate"],
    keywords: [
      "limit",
      "deductible",
      "retention",
      "aggregate",
      "occurrence",
      "claim",
      "coverage",
      "retroactive",
    ],
    instructions:
      "Verify coverage names, limits, deductibles, retentions, aggregate/per-occurrence typing, coverage form, and retroactive date. Do not collapse distinct limits into one field. When correcting numeric coverage rows, include limitAmount and deductibleAmount as plain numbers only when the evidence directly states fixed numeric currency values.",
  },
];

const reviewRowSchema = z.object({
  line: z.string().nullable(),
  name: z.string().nullable(),
  amount: z.string().nullable(),
  amountValue: z.number().nullable(),
  type: z.string().nullable(),
  limit: z.string().nullable(),
  limitAmount: z.number().nullable(),
  limitType: z.string().nullable(),
  deductible: z.string().nullable(),
  deductibleAmount: z.number().nullable(),
  deductibleType: z.string().nullable(),
  formNumber: z.string().nullable(),
  pageNumber: z.number().nullable(),
  sectionRef: z.string().nullable(),
  originalContent: z.string().nullable(),
});

const fieldReviewSchema = z.object({
  corrections: z.array(z.object({
    field: z.string(),
    valueString: z.string().nullable(),
    valueNumber: z.number().nullable(),
    valueBoolean: z.boolean().nullable(),
    valueRows: z.array(reviewRowSchema).nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    reason: z.string(),
    evidenceQuote: z.string(),
  })),
});

function correctionValue(correction: z.infer<typeof fieldReviewSchema>["corrections"][number]) {
  if (correction.valueRows !== null) {
    return correction.valueRows.map((row) => Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== null && value !== undefined),
    ));
  }
  if (correction.valueNumber !== null) return correction.valueNumber;
  if (correction.valueBoolean !== null) return correction.valueBoolean;
  return correction.valueString ?? undefined;
}

function reviewMode() {
  const raw = process.env.EXTRACTION_FIELD_REVIEW_MODE;
  if (raw === "skip" || raw === "auto" || raw === "always") return raw;
  return "always";
}

function isMissingValue(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !normalized || normalized === "unknown" || normalized === "n/a" || normalized === "not applicable";
  }
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function compactDocumentForGroup(document: Record<string, unknown>, group: FieldReviewGroup) {
  return Object.fromEntries(
    group.fields.map((field) => [field, document[field]]),
  );
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sectionEvidence(document: Record<string, unknown>) {
  const sections = Array.isArray(document.sections) ? document.sections : [];
  const evidence: SourceLike[] = [];
  for (const raw of sections) {
    const section = sanitizeNulls(raw) as Record<string, unknown>;
    const title = normalizeExtractedString(section.title);
    const content = normalizeExtractedString(section.content);
    if (title || content) {
      evidence.push({
        id: typeof section.recordId === "string" ? section.recordId : undefined,
        sectionId: typeof section.sectionNumber === "string" ? section.sectionNumber : undefined,
        pageStart: typeof section.pageStart === "number" ? section.pageStart : undefined,
        pageEnd: typeof section.pageEnd === "number" ? section.pageEnd : undefined,
        text: [title, content].filter(Boolean).join("\n"),
        metadata: { source: "document.sections" },
      });
    }
    if (Array.isArray(section.subsections)) {
      for (const rawSubsection of section.subsections) {
        const subsection = sanitizeNulls(rawSubsection) as Record<string, unknown>;
        const subsectionTitle = normalizeExtractedString(subsection.title);
        const subsectionContent = normalizeExtractedString(subsection.content);
        if (subsectionTitle || subsectionContent) {
          evidence.push({
            pageStart: typeof subsection.pageNumber === "number" ? subsection.pageNumber : undefined,
            sectionId: typeof subsection.sectionNumber === "string" ? subsection.sectionNumber : undefined,
            text: [subsectionTitle, subsectionContent].filter(Boolean).join("\n"),
            metadata: { source: "document.sections.subsections" },
          });
        }
      }
    }
  }
  return evidence;
}

function scoreEvidence(text: string, group: FieldReviewGroup) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const keyword of group.keywords) {
    if (lower.includes(keyword.toLowerCase())) score += 3;
  }
  for (const field of group.fields) {
    const spaced = field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
    if (lower.includes(spaced.toLowerCase())) score += 1;
  }
  return score;
}

export function selectEvidenceForFieldGroup(params: {
  document: Record<string, unknown>;
  sourceSpans: SourceLike[];
  group: FieldReviewGroup;
  maxSnippets?: number;
}) {
  const candidates = [...sectionEvidence(params.document), ...params.sourceSpans]
    .map((source, index) => {
      const text = normalizeText(source.text);
      return {
        source,
        index,
        text,
        score: text ? scoreEvidence(text, params.group) : 0,
      };
    })
    .filter((item) => item.text && item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, params.maxSnippets ?? 8);

  return candidates.map((item, index) => ({
    id: item.source.id ?? item.source.sectionId ?? `evidence_${index + 1}`,
    pageStart: item.source.pageStart,
    pageEnd: item.source.pageEnd,
    text: item.text.slice(0, 1800),
  }));
}

function shouldReviewGroup(document: Record<string, unknown>, group: FieldReviewGroup, evidenceCount: number) {
  if (evidenceCount === 0) return false;
  if (reviewMode() === "always") return true;
  return group.fields.some((field) => isMissingValue(document[field]));
}

function hasEvidenceQuote(correction: ReviewCorrection) {
  const quote = normalizeText(correction.evidenceQuote);
  return quote.length >= 8;
}

function canApplyCorrection(document: Record<string, unknown>, group: FieldReviewGroup, correction: ReviewCorrection) {
  if (!group.fields.includes(correction.field)) return "field is not registered for this review group";
  if (correction.confidence === "low") return "confidence is low";
  if (!hasEvidenceQuote(correction)) return "missing source evidence quote";
  if (!isMissingValue(document[correction.field]) && correction.confidence !== "high") {
    return "replacing an existing value requires high confidence";
  }
  if (correction.value === undefined || correction.value === null) return "empty correction value";
  return null;
}

export function applyFieldReviewResults(
  document: Record<string, unknown>,
  reviews: ReviewResult[],
): FieldReviewApplication {
  const next = { ...document };
  const applied: FieldReviewApplication["applied"] = [];
  const skipped: FieldReviewApplication["skipped"] = [];

  for (const review of reviews) {
    const group = FIELD_REVIEW_GROUPS.find((item) => item.id === review.groupId);
    if (!group) continue;
    for (const correction of review.corrections) {
      const reasonSkipped = canApplyCorrection(next, group, correction);
      if (reasonSkipped) {
        skipped.push({ ...correction, groupId: review.groupId, reasonSkipped });
        continue;
      }
      next[correction.field] = correction.value;
      applied.push({ ...correction, groupId: review.groupId });
    }
  }

  return { document: next, applied, skipped };
}

async function reviewGroup(options: FieldReviewOptions, group: FieldReviewGroup) {
  const evidence = selectEvidenceForFieldGroup({
    document: options.document,
    sourceSpans: options.sourceSpans,
    group,
  });
  if (!shouldReviewGroup(options.document, group, evidence.length)) return null;

  const model = await getModelForOrg(options.ctx, options.orgId, "classification");
  const current = compactDocumentForGroup(options.document, group);
  const result = await generateObject({
    model,
    schema: fieldReviewSchema,
    maxOutputTokens: 2500,
    prompt: `Review extracted insurance policy fields against source evidence.

Group: ${group.label}
Registered fields: ${group.fields.join(", ")}

Instructions:
${group.instructions}

Rules:
- Return corrections only for fields in Registered fields.
- Prefer source evidence over the current extracted value.
- Correct missing, Unknown, incomplete, or source-contradicted values.
- Do not invent. Every correction needs a short exact evidenceQuote from the provided evidence.
- Use confidence "high" only when the evidence directly states the value.
- Put exactly one value slot on each correction:
  valueString for string fields, valueNumber for numeric fields, valueBoolean for boolean fields, or valueRows for financial/coverage table rows. Set the unused value slots to null.
- Examples:
  {"field":"premiumAmount","valueString":null,"valueNumber":42000,"valueBoolean":null,"valueRows":null,...}
  {"field":"totalCostAmount","valueString":null,"valueNumber":43820,"valueBoolean":null,"valueRows":null,...}
  {"field":"premiumBreakdown","valueString":null,"valueNumber":null,"valueBoolean":null,"valueRows":[{"line":"Annual Premium","name":null,"amount":"CAD $42,000","amountValue":42000,"type":null,"limit":null,"limitAmount":null,"limitType":null,"deductible":null,"deductibleAmount":null,"deductibleType":null,"formNumber":null,"pageNumber":5,"sectionRef":null,"originalContent":null}],...}
  {"field":"taxesAndFees","valueString":null,"valueNumber":null,"valueBoolean":null,"valueRows":[{"line":null,"name":"Policy Fee","amount":"CAD $350","amountValue":350,"type":"fee","limit":null,"limitAmount":null,"limitType":null,"deductible":null,"deductibleAmount":null,"deductibleType":null,"formNumber":null,"pageNumber":5,"sectionRef":null,"originalContent":null}],...}
- Return an empty corrections array when evidence does not justify a change.

Current extracted fields:
${JSON.stringify(current, null, 2)}

Evidence:
${JSON.stringify(evidence, null, 2)}`,
  });

  return {
    groupId: group.id,
    corrections: result.object.corrections.flatMap((correction): ReviewCorrection[] => {
      const value = correctionValue(correction);
      if (value === undefined) return [];
      return [{
        field: correction.field,
        value,
        confidence: correction.confidence,
        reason: correction.reason,
        evidenceQuote: correction.evidenceQuote,
      }];
    }),
  };
}

export async function reviewExtractionFields(
  options: FieldReviewOptions,
): Promise<FieldReviewApplication> {
  if (reviewMode() === "skip") {
    return { document: options.document, applied: [], skipped: [] };
  }

  const reviews: ReviewResult[] = [];
  for (const group of FIELD_REVIEW_GROUPS) {
    try {
      const review = await reviewGroup(options, group);
      if (review) reviews.push(review);
    } catch (error) {
      await options.log?.(
        `Field review failed for ${group.label}: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      );
    }
  }

  const applied = applyFieldReviewResults(options.document, reviews);
  if (applied.applied.length > 0) {
    await options.log?.(
      `Field review applied ${applied.applied.length} correction${applied.applied.length === 1 ? "" : "s"} across ${new Set(applied.applied.map((item) => item.groupId)).size} group${new Set(applied.applied.map((item) => item.groupId)).size === 1 ? "" : "s"}`,
      "info",
    );
  }
  return applied;
}

export const TEST_FIELD_REVIEW_GROUPS = FIELD_REVIEW_GROUPS;
