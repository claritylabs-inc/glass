"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { searchPolicyDocument } from "./aiUtils";

type LookupResult = Record<string, unknown>;
type SourceSpanDoc = {
  spanId?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  text: string;
};

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function queryTerms(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9$.,%-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 2),
  ));
}

function scoreSpan(query: string, terms: string[], span: SourceSpanDoc): number {
  const text = span.text.toLowerCase();
  let score = query && text.includes(query.toLowerCase()) ? 6 : 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }
  return score;
}

function attachSourceSpans(result: LookupResult, spans: Array<SourceSpanDoc & { score: number }>): LookupResult {
  const resultText = `${textValue(result.title)} ${textValue(result.content)}`.toLowerCase();
  const matched = spans
    .filter((span) => {
      if (span.score <= 0) return false;
      if (!resultText) return true;
      const title = textValue(result.title).toLowerCase();
      return (
        resultText.includes(span.text.slice(0, 80).toLowerCase()) ||
        (span.sectionId && title.includes(span.sectionId.toLowerCase())) ||
        span.score >= 2
      );
    })
    .slice(0, 3);

  if (matched.length === 0) return result;
  return {
    ...result,
    sourceSpanIds: matched.map((span) => span.spanId).filter(Boolean),
    sourceSpans: matched.map((span) => ({
      id: span.spanId,
      pageStart: span.pageStart,
      pageEnd: span.pageEnd,
      sectionId: span.sectionId,
      formNumber: span.formNumber,
      text: span.text.slice(0, 1200),
    })),
  };
}

function sourceOnlyResults(spans: Array<SourceSpanDoc & { score: number }>, maxResults: number): LookupResult[] {
  return spans
    .filter((span) => span.score > 0)
    .slice(0, maxResults)
    .map((span) => ({
      title: span.sectionId ?? span.formNumber ?? `Source evidence${span.pageStart ? ` page ${span.pageStart}` : ""}`,
      type: "source_span",
      pages: span.pageStart ? `${span.pageStart}${span.pageEnd ? `-${span.pageEnd}` : ""}` : undefined,
      content: span.text.slice(0, 6000),
      sourceSpanIds: span.spanId ? [span.spanId] : [],
      sourceSpans: [{
        id: span.spanId,
        pageStart: span.pageStart,
        pageEnd: span.pageEnd,
        sectionId: span.sectionId,
        formNumber: span.formNumber,
        text: span.text.slice(0, 1200),
      }],
    }));
}

export async function searchPolicyDocumentWithSourceSpans(
  ctx: ActionCtx,
  policy: Record<string, unknown>,
  query: string,
  maxResults = 8,
): Promise<Array<Record<string, unknown>> | string> {
  const base = searchPolicyDocument(policy, query, maxResults);
  const policyId = policy._id as Id<"policies"> | undefined;
  if (!policyId) return base;

  const terms = queryTerms(query);
  const spans = await ctx.runQuery(internal.sourceSpans.listSpansByPolicyInternal, { policyId })
    .then((docs) => docs.map((doc) => ({ ...doc, score: scoreSpan(query, terms, doc) })))
    .catch(() => []);
  const rankedSpans = spans.sort((left, right) => right.score - left.score);

  if (Array.isArray(base)) {
    const augmented = base.map((result) => attachSourceSpans(result, rankedSpans));
    const hasSourceBackedResult = augmented.some((result) =>
      Array.isArray(result.sourceSpanIds) && result.sourceSpanIds.length > 0,
    );
    return hasSourceBackedResult ? augmented : [...augmented, ...sourceOnlyResults(rankedSpans, 2)].slice(0, maxResults);
  }

  const sourceResults = sourceOnlyResults(rankedSpans, maxResults);
  return sourceResults.length > 0 ? sourceResults : base;
}
