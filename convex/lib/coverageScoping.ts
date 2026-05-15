"use node";

import { sanitizeNulls } from "@claritylabs/cl-sdk";

export type CoverageLike = Record<string, unknown>;

export type CoverageReviewOption = {
  id: string;
  value: string;
  label: string;
  coverage: CoverageLike;
  detail?: string;
  limitType?: string;
  pageNumber?: number;
  sourceLabel?: string;
  reason?: string;
  sourceSpanIds?: string[];
};

export type CoverageReviewQuestion = {
  id: string;
  kind: "coverage_limit_conflict";
  status: "open" | "confirmed" | "broker_help_requested" | "dismissed";
  coverageName: string;
  limitType?: string;
  currentValue?: string;
  recommendedOptionId?: string;
  recommendation?: string;
  question: string;
  reason: string;
  options: CoverageReviewOption[];
  sourceSpanIds?: string[];
  createdAt: number;
};

export type CoverageReviewState = {
  strategyVersion: "coverage-declaration-scope-v1";
  generatedAt: number;
  questions: CoverageReviewQuestion[];
};

type SourceSpanLike = {
  id?: unknown;
  text?: unknown;
  pageStart?: unknown;
};

type CoverageScore = {
  index: number;
  coverage: CoverageLike;
  score: number;
  reasons: string[];
};

const DECLARATION_AUTHORITY_PATTERN =
  /\b(declarations?|policy\s+declarations?|coverage\s+summary|schedule\s+of\s+(?:coverages?|insurance)|confirmation|binder|quote\s+summary|selected\s+(?:limits?|coverages?)|endorsements?)\b/i;

const SELECTED_MARK_PATTERN =
  /(?:\[[xX]\]|\(x\)|☒|✓|✔|\byes\b|\bincluded\b|\bselected\b|\bapplies\b)/i;

const EXCLUDED_PATTERN =
  /\b(not\s+covered|not\s+included|excluded|does\s+not\s+apply|declined|rejected|option(?:al)?|available\s+(?:limit|option)|choose\s+one|select\s+one)\b/i;

const DISTINCT_LIMIT_TYPES = new Set([
  "per_occurrence",
  "per_claim",
  "per_person",
  "per_accident",
  "aggregate",
  "general_aggregate",
  "products_completed_ops_aggregate",
  "statutory",
  "scheduled",
  "blanket",
]);

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeText(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCoverageName(value: unknown): string {
  return normalizeText(value)
    .replace(/\b(each|per|policy|general|annual|aggregate|occurrence|claim|claims|limit|limits|deductible|retention|coverage)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLimitType(coverage: CoverageLike): string {
  const explicit = normalizeText(coverage.limitType);
  if (explicit) {
    if (explicit.includes("aggregate")) return "aggregate";
    if (explicit.includes("occurrence")) return "per_occurrence";
    if (explicit.includes("claim")) return "per_claim";
    if (explicit.includes("person")) return "per_person";
    if (explicit.includes("accident")) return "per_accident";
    if (explicit.includes("statutory")) return "statutory";
    if (explicit.includes("scheduled")) return "scheduled";
    if (explicit.includes("blanket")) return "blanket";
    return explicit;
  }

  const combined = normalizeText([
    coverage.name,
    coverage.originalContent,
    coverage.resolvedOriginalContent,
    coverage.sectionRef,
  ].filter(Boolean).join(" "));
  if (combined.includes("aggregate")) return "aggregate";
  if (combined.includes("each occurrence") || combined.includes("per occurrence")) return "per_occurrence";
  if (combined.includes("each claim") || combined.includes("per claim")) return "per_claim";
  if (combined.includes("per person")) return "per_person";
  if (combined.includes("per accident") || combined.includes("each accident")) return "per_accident";
  if (combined.includes("statutory")) return "statutory";
  if (combined.includes("scheduled")) return "scheduled";
  if (combined.includes("blanket")) return "blanket";
  return "limit";
}

function coverageTermKind(coverage: CoverageLike): "limit" | "deductible" | "retroactive_date" {
  const combined = normalizeText([
    coverage.name,
    coverage.limit,
    coverage.deductible,
    coverage.originalContent,
    coverage.resolvedOriginalContent,
    coverage.sectionRef,
  ].filter(Boolean).join(" "));
  if (combined.includes("retroactive")) return "retroactive_date";
  if (combined.includes("deductible") || combined.includes("retention")) return "deductible";
  return "limit";
}

function parseCoverageMoney(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(
    /(?:\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(m|mm|million|k|thousand)?\b|([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(m|mm|million|k|thousand)\b|([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\b)/i,
  );
  if (!match) return undefined;
  const baseText = match[1] ?? match[3] ?? match[5];
  const base = Number.parseFloat(baseText.replace(/,/g, ""));
  if (!Number.isFinite(base)) return undefined;
  const suffix = (match[2] ?? match[4])?.toLowerCase();
  if (suffix === "m" || suffix === "mm" || suffix === "million") return Math.round(base * 1_000_000);
  if (suffix === "k" || suffix === "thousand") return Math.round(base * 1_000);
  return Math.round(base);
}

function limitValueKey(coverage: CoverageLike): string {
  const amount =
    typeof coverage.limitAmount === "number"
      ? coverage.limitAmount
      : parseCoverageMoney(coverage.limit) ?? parseCoverageMoney(coverage.originalContent);
  if (amount !== undefined) return String(amount);
  return normalizeText(coverage.limit ?? coverage.originalContent);
}

function limitNeedles(coverage: CoverageLike): string[] {
  const values = [
    coverage.limit,
    coverage.originalContent,
    typeof coverage.limitAmount === "number" ? String(coverage.limitAmount) : undefined,
    String(limitValueKey(coverage)),
  ];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter((value) => value.length > 0),
    ),
  );
}

function groupKey(coverage: CoverageLike): string {
  const name = normalizeCoverageName(coverage.name) || normalizeCoverageName(coverage.coverageCode) || "coverage";
  return `${name}|${normalizeLimitType(coverage)}`;
}

function optionValue(coverage: CoverageLike): string {
  return cleanText(coverage.limit) || cleanText(coverage.originalContent) || "As stated";
}

function humanLimitType(value: string): string {
  switch (value) {
    case "aggregate":
      return "aggregate";
    case "general_aggregate":
      return "general aggregate";
    case "products_completed_ops_aggregate":
      return "products/completed operations aggregate";
    case "per_occurrence":
      return "per occurrence";
    case "per_claim":
      return "per occurrence";
    case "per_person":
      return "per person";
    case "per_accident":
      return "per accident";
    case "statutory":
      return "statutory";
    case "scheduled":
      return "scheduled";
    case "blanket":
      return "blanket";
    default:
      return value.replace(/_/g, " ");
  }
}

function coverageRole(coverage: CoverageLike, limitType: string): string {
  const termKind = coverageTermKind(coverage);
  if (termKind === "deductible") return "deductible";
  if (termKind === "retroactive_date") return "retroactive date";
  return humanLimitType(limitType);
}

function coveragePageNumber(coverage: CoverageLike): number | undefined {
  return typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined;
}

function coverageSourceLabel(coverage: CoverageLike): string | undefined {
  const section = cleanText(coverage.sectionRef);
  const form = cleanText(coverage.formNumber);
  const page = coveragePageNumber(coverage);
  const parts = [
    section || form || undefined,
    page !== undefined ? `page ${page}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function optionLabel(coverage: CoverageLike, limitType: string): string {
  const value = optionValue(coverage);
  const role = coverageRole(coverage, limitType);
  if (role && role !== "limit" && !normalizeText(value).includes(normalizeText(role))) {
    return `${value} ${role}`;
  }
  return value;
}

function optionDetail(coverage: CoverageLike, limitType: string): string {
  const source = coverageSourceLabel(coverage);
  const name = cleanText(coverage.name);
  const original = cleanText(coverage.originalContent);
  const detail = [
    humanLimitType(limitType) !== "limit" ? `Type: ${humanLimitType(limitType)}` : undefined,
    source ? `Source: ${source}` : undefined,
    name ? `Extracted as: ${name}` : undefined,
    original && original !== name ? `Text: ${original}` : undefined,
  ].filter(Boolean);
  return detail.join(" | ");
}

function recommendationReason(winner: CoverageScore, runnerUp?: CoverageScore): string {
  const reason = winner.reasons[0];
  const margin = runnerUp ? winner.score - runnerUp.score : winner.score;
  if (reason?.includes("declarations") || reason?.includes("summary") || reason?.includes("endorsement")) {
    return "Recommended because this value is supported by declaration or schedule wording.";
  }
  if (reason?.includes("selection marker")) {
    return "Recommended because the source wording marks this value as the selected option.";
  }
  if (margin >= 4) {
    return "Recommended because the source evidence is stronger than the alternatives.";
  }
  return "Recommended by the extraction review, but source wording is close enough that confirmation is useful.";
}

function questionText(coverageName: string, limitType: string): string {
  const baseName = cleanText(coverageName)
    .replace(/\s+[-—]\s+(each\s+claim|per\s+claim|each\s+occurrence|per\s+occurrence|aggregate|policy\s+aggregate|deductible|retroactive\s+date)(?:\s+limit)?$/i, "")
    .replace(/\s+(each\s+claim|per\s+claim|each\s+occurrence|per\s+occurrence|aggregate|policy\s+aggregate)\s+limit$/i, "")
    .trim() || coverageName;
  const normalizedName = normalizeText(baseName);
  const readableLimitType = humanLimitType(limitType);
  if (readableLimitType !== "limit" && !normalizedName.includes(normalizeText(readableLimitType))) {
    return `Which ${readableLimitType} limit should Glass use for ${baseName}?`;
  }
  return `Which limit should Glass use for ${baseName}?`;
}

function uniqueIdPart(value: string): string {
  return normalizeText(value).replace(/\s+/g, "-").slice(0, 48) || "coverage";
}

function collectRecordText(value: unknown, out: string[] = []): string[] {
  if (!value) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRecordText(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectRecordText(item, out);
    }
  }
  return out;
}

function collectAuthorityTexts(document: Record<string, unknown>, sourceSpans: SourceSpanLike[]): string[] {
  const texts: string[] = [];
  collectRecordText(document.declarations, texts);

  for (const key of ["sections", "endorsements", "formInventory"]) {
    const items = document[key];
    if (!Array.isArray(items)) continue;
    for (const item of items as Record<string, unknown>[]) {
      const title = cleanText(item.title ?? item.name ?? item.formType ?? item.type);
      const content = collectRecordText(item, []).join(" ");
      if (DECLARATION_AUTHORITY_PATTERN.test(`${title} ${content}`)) {
        texts.push(`${title} ${content}`);
      }
    }
  }

  for (const span of sourceSpans) {
    const text = cleanText(span.text);
    if (!text) continue;
    if (DECLARATION_AUTHORITY_PATTERN.test(text) || SELECTED_MARK_PATTERN.test(text)) {
      texts.push(text);
    }
  }

  return texts;
}

function sourceSpanIds(coverage: CoverageLike): string[] {
  return Array.isArray(coverage.sourceSpanIds)
    ? coverage.sourceSpanIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
}

function scoreCoverage(
  coverage: CoverageLike,
  index: number,
  authorityTexts: string[],
  sourceTextById: Map<string, string>,
): CoverageScore {
  const reasons: string[] = [];
  let score = 0;
  const name = normalizeCoverageName(coverage.name);
  const ownText = [
    coverage.name,
    coverage.limit,
    coverage.originalContent,
    coverage.resolvedOriginalContent,
    coverage.sectionRef,
    ...sourceSpanIds(coverage).map((id) => sourceTextById.get(id)),
  ].map(cleanText).filter(Boolean).join(" ");

  if (coverage.included === true) {
    score += 3;
    reasons.push("marked included");
  } else if (coverage.included === false) {
    score -= 6;
    reasons.push("marked not included");
  }

  if (DECLARATION_AUTHORITY_PATTERN.test(ownText)) {
    score += 4;
    reasons.push("appears in declarations/summary/endorsement text");
  }
  if (SELECTED_MARK_PATTERN.test(ownText)) {
    score += 3;
    reasons.push("selection marker near extracted value");
  }
  if (EXCLUDED_PATTERN.test(ownText)) {
    score -= 4;
    reasons.push("looks like optional or excluded wording");
  }
  if (sourceSpanIds(coverage).length > 0) {
    score += 1;
    reasons.push("has source span evidence");
  }

  for (const text of authorityTexts) {
    const normalized = normalizeText(text);
    if (name && normalized.includes(name) && limitNeedles(coverage).some((needle) => normalized.includes(needle))) {
      score += 6;
      reasons.push("limit appears in declarations/summary/endorsement evidence");
      break;
    }
  }

  return { index, coverage, score, reasons };
}

function mergeSourceSpanIds(scores: CoverageScore[]): string[] {
  return Array.from(new Set(scores.flatMap((score) => sourceSpanIds(score.coverage)))).sort();
}

function shouldReviewGroup(scores: CoverageScore[]): boolean {
  const limitValues = new Set(scores.map((score) => limitValueKey(score.coverage)).filter(Boolean));
  return limitValues.size > 1;
}

export function applyCoverageDeclarationScoping({
  fields,
  sourceSpans,
  nowMs,
}: {
  fields: Record<string, unknown>;
  sourceSpans?: SourceSpanLike[];
  nowMs: number;
}): {
  fields: Record<string, unknown>;
  review: CoverageReviewState;
  changed: boolean;
} {
  const rawCoverages = Array.isArray(fields.coverages)
    ? (fields.coverages as CoverageLike[]).map((coverage) => sanitizeNulls(coverage) as CoverageLike)
    : [];
  const document = {
    ...(typeof fields.document === "object" && fields.document ? fields.document as Record<string, unknown> : {}),
    declarations: fields.declarations,
  };
  const authorityTexts = collectAuthorityTexts(document, sourceSpans ?? []);
  const sourceTextById = new Map<string, string>();
  for (const span of sourceSpans ?? []) {
    if (typeof span.id === "string" && typeof span.text === "string") {
      sourceTextById.set(span.id, span.text);
    }
  }
  const byGroup = new Map<string, CoverageScore[]>();

  rawCoverages.forEach((coverage, index) => {
    if (coverageTermKind(coverage) !== "limit") return;
    const key = groupKey(coverage);
    const list = byGroup.get(key) ?? [];
    list.push(scoreCoverage(coverage, index, authorityTexts, sourceTextById));
    byGroup.set(key, list);
  });

  const removeIndexes = new Set<number>();
  const replacementByIndex = new Map<number, CoverageLike>();
  const questions: CoverageReviewQuestion[] = [];

  for (const [key, scores] of byGroup) {
    if (scores.length < 2 || !shouldReviewGroup(scores)) continue;
    const limitType = key.split("|")[1];
    if (DISTINCT_LIMIT_TYPES.has(limitType) && new Set(scores.map((score) => limitValueKey(score.coverage))).size === 1) {
      continue;
    }

    const ordered = [...scores].sort((a, b) => b.score - a.score || a.index - b.index);
    const winner = ordered[0];
    if (!winner) continue;

    for (const score of ordered.slice(1)) {
      removeIndexes.add(score.index);
    }

    const options = ordered.map((score, optionIndex) => {
      const value = optionValue(score.coverage);
      const optionLimitType = normalizeLimitType(score.coverage);
      const label = optionLabel(score.coverage, optionLimitType);
      return {
        id: `${uniqueIdPart(value)}-${uniqueIdPart(optionLimitType)}-${score.index}-${optionIndex}`,
        value,
        label,
        coverage: score.coverage,
        detail: optionDetail(score.coverage, optionLimitType),
        limitType: optionLimitType,
        pageNumber: coveragePageNumber(score.coverage),
        sourceLabel: coverageSourceLabel(score.coverage),
        reason: score.reasons[0],
        sourceSpanIds: sourceSpanIds(score.coverage),
      };
    });
    const coverageName = cleanText(winner.coverage.name) || "coverage";
    const sourceIds = mergeSourceSpanIds(ordered);
    const recommendedOptionId = options[0]?.id;
    const reason =
      winner.score >= (ordered[1]?.score ?? 0) + 4
        ? "Multiple limits were extracted for this coverage; declarations, selected-option, summary, or endorsement evidence favored the current value."
        : "Multiple limits were extracted for this coverage and the selected policy limit needs confirmation.";

    replacementByIndex.set(winner.index, {
      ...winner.coverage,
      extractionReviewStatus: winner.score >= (ordered[1]?.score ?? 0) + 4 ? "scoped_from_declarations" : "needs_confirmation",
      extractionReviewReason: reason,
      ...(sourceIds.length > 0 ? { reviewSourceSpanIds: sourceIds } : {}),
    });
    questions.push({
      id: `coverage-limit-${uniqueIdPart(coverageName)}-${uniqueIdPart(limitType)}`,
      kind: "coverage_limit_conflict",
      status: "open",
      coverageName,
      limitType,
      currentValue: optionValue(winner.coverage),
      ...(recommendedOptionId ? { recommendedOptionId } : {}),
      recommendation: recommendationReason(winner, ordered[1]),
      question: questionText(coverageName, limitType),
      reason,
      options,
      ...(sourceIds.length > 0 ? { sourceSpanIds: sourceIds } : {}),
      createdAt: nowMs,
    });
  }

  const nextCoverages = rawCoverages
    .map((coverage, index) => replacementByIndex.get(index) ?? coverage)
    .filter((_coverage, index) => !removeIndexes.has(index));
  const changed = nextCoverages.length !== rawCoverages.length || questions.length > 0;
  const review: CoverageReviewState = {
    strategyVersion: "coverage-declaration-scope-v1",
    generatedAt: nowMs,
    questions,
  };

  return {
    fields: {
      ...fields,
      coverages: nextCoverages,
      extractionReview: review,
    },
    review,
    changed,
  };
}
