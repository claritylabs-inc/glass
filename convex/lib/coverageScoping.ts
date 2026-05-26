"use node";

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

export function applyCoverageDeclarationScoping({
  fields,
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
  const review: CoverageReviewState = {
    strategyVersion: "coverage-declaration-scope-v1",
    generatedAt: nowMs,
    questions: [],
  };

  return {
    fields,
    review,
    changed: false,
  };
}
