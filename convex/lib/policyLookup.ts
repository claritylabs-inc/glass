"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { searchPolicyDocument } from "./aiUtils";
import type { GlassSourceSpan } from "./pdfSourceSpans";
import { preparePdfTextWithParserFallback } from "./doclingPreprocessor";
import { makeEmbedText } from "./sdkCallbacks";

type LookupResult = Record<string, unknown>;
type SourceSpanDoc = {
  spanId?: string;
  documentId?: string;
  sourceKind?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  text: string;
  textHash?: string;
  semanticScore?: number;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  metadata?: Record<string, unknown>;
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
  if (typeof span.semanticScore === "number") score += Math.max(0, span.semanticScore * 4);
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
    evidenceSource: "extracted_data_and_original_pdf",
    originalPdfChecked: true,
    sourceSpanIds: matched.map((span) => span.spanId).filter(Boolean),
    sourceSpans: matched.map((span) => ({
      id: span.spanId,
      sourceKind: span.sourceKind,
      pageStart: span.pageStart,
      pageEnd: span.pageEnd,
      sectionId: span.sectionId,
      formNumber: span.formNumber,
      bbox: span.bbox,
      metadata: span.metadata,
      confidence: span.score >= 6 ? "high" : span.score >= 2 ? "medium" : "low",
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
      type: "original_pdf_source_span",
      evidenceSource: "original_pdf",
      originalPdfChecked: true,
      confidence: span.score >= 6 ? "high" : span.score >= 2 ? "medium" : "low",
      pages: span.pageStart ? `${span.pageStart}${span.pageEnd ? `-${span.pageEnd}` : ""}` : undefined,
      content: span.text.slice(0, 6000),
      sourceSpanIds: span.spanId ? [span.spanId] : [],
      sourceSpans: [{
        id: span.spanId,
        sourceKind: span.sourceKind,
        pageStart: span.pageStart,
        pageEnd: span.pageEnd,
        sectionId: span.sectionId,
        formNumber: span.formNumber,
        bbox: span.bbox,
        metadata: span.metadata,
        text: span.text.slice(0, 1200),
      }],
    }));
}

function toSourceSpanDoc(span: GlassSourceSpan | { id: string; documentId: string; sourceKind: string; pageStart?: number; pageEnd?: number; sectionId?: string; formNumber?: string; text: string; textHash?: string; hash?: string; bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>; metadata?: Record<string, unknown> }): SourceSpanDoc {
  const spanWithLocation = span as typeof span & {
    bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
    metadata?: Record<string, unknown>;
  };
  return {
    spanId: span.id,
    documentId: span.documentId,
    sourceKind: span.sourceKind,
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
    sectionId: span.sectionId,
    formNumber: span.formNumber,
    text: span.text,
    textHash: span.textHash ?? span.hash,
    bbox: spanWithLocation.bbox,
    metadata: spanWithLocation.metadata,
  };
}

async function loadStoredSourceSpans(
  ctx: ActionCtx,
  policyId: Id<"policies">,
): Promise<SourceSpanDoc[]> {
  return ctx.runQuery(internal.sourceSpans.listSpansByPolicyInternal, { policyId })
    .then((docs: SourceSpanDoc[]) => docs.map((doc) => ({
      spanId: doc.spanId,
      documentId: doc.documentId,
      sourceKind: doc.sourceKind,
      pageStart: doc.pageStart,
      pageEnd: doc.pageEnd,
      sectionId: doc.sectionId,
      formNumber: doc.formNumber,
      text: doc.text,
      textHash: doc.textHash,
      bbox: doc.bbox,
      metadata: doc.metadata,
    })))
    .catch(() => []);
}

async function loadOriginalPdfSpans(
  ctx: ActionCtx,
  policy: Record<string, unknown>,
): Promise<SourceSpanDoc[]> {
  const fileId = policy.fileId as Id<"_storage"> | undefined;
  const policyId = policy._id as string | undefined;
  if (!fileId || !policyId) return [];

  const blob = await ctx.storage.get(fileId).catch(() => null);
  if (!blob) return [];

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { sourceSpans } = await preparePdfTextWithParserFallback({
    pdfBytes: bytes,
    documentId: policyId,
    sourceKind: "policy_pdf",
  });
  return sourceSpans.map(toSourceSpanDoc);
}

async function searchSemanticSourceChunks(
  ctx: ActionCtx,
  policy: Record<string, unknown>,
  query: string,
  spans: SourceSpanDoc[],
): Promise<SourceSpanDoc[]> {
  const policyId = policy._id as Id<"policies"> | undefined;
  const orgId = policy.orgId as Id<"organizations"> | undefined;
  if (!policyId || !orgId) return [];

  try {
    const vector = await makeEmbedText(ctx, orgId)(query);
    const results = await ctx.vectorSearch("sourceChunks", "by_embedding", {
      vector,
      limit: 12,
      filter: (q) => q.eq("orgId", orgId),
    });
    const spansById = new Map(spans.map((span) => [span.spanId, span]));
    const semantic: SourceSpanDoc[] = [];

    for (const result of results) {
      const chunk = await ctx.runQuery(internal.sourceSpans.getChunk, {
        id: result._id,
      });
      if (!chunk || String(chunk.policyId) !== String(policyId)) continue;
      const matched = chunk.sourceSpanIds
        .map((id: string) => spansById.get(id))
        .filter((span: SourceSpanDoc | undefined): span is SourceSpanDoc => Boolean(span));
      if (matched.length > 0) {
        semantic.push(
          ...matched.map((span: SourceSpanDoc) => ({
            ...span,
            semanticScore: Math.max(span.semanticScore ?? 0, result._score),
          })),
        );
        continue;
      }
      semantic.push({
        spanId: chunk.sourceSpanIds[0] ?? chunk.chunkId,
        documentId: chunk.documentId,
        sourceKind: "policy_pdf",
        text: chunk.text,
        semanticScore: result._score,
      });
    }
    return semantic;
  } catch {
    return [];
  }
}

function dedupeSpans(spans: SourceSpanDoc[]): SourceSpanDoc[] {
  const byKey = new Map<string, SourceSpanDoc>();
  for (const span of spans) {
    const key = span.spanId ?? span.textHash ?? span.text.slice(0, 160);
    const existing = byKey.get(key);
    if (!existing || (span.semanticScore ?? 0) > (existing.semanticScore ?? 0)) {
      byKey.set(key, span);
    }
  }
  return [...byKey.values()];
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
  let spans = await loadStoredSourceSpans(ctx, policyId);
  if (spans.length === 0) {
    spans = await loadOriginalPdfSpans(ctx, policy);
  }
  const semanticSpans = await searchSemanticSourceChunks(ctx, policy, query, spans);
  const rankedSpans = dedupeSpans([...spans, ...semanticSpans])
    .map((span) => ({ ...span, score: scoreSpan(query, terms, span) }))
    .filter((span) => span.score > 0)
    .sort((left, right) => right.score - left.score);

  if (Array.isArray(base)) {
    const augmented = base.map((result) => attachSourceSpans(result, rankedSpans));
    const hasSourceBackedResult = augmented.some((result) =>
      Array.isArray(result.sourceSpanIds) && result.sourceSpanIds.length > 0,
    );
    const sourceEvidence = sourceOnlyResults(rankedSpans, hasSourceBackedResult ? 2 : 3);
    const seen = new Set(
      augmented.flatMap((result) =>
        Array.isArray(result.sourceSpanIds) ? result.sourceSpanIds.map(String) : [],
      ),
    );
    const additionalEvidence = sourceEvidence.filter((result) => {
      const ids = Array.isArray(result.sourceSpanIds) ? result.sourceSpanIds.map(String) : [];
      return ids.length === 0 || ids.some((id) => !seen.has(id));
    });
    return [...augmented, ...additionalEvidence].slice(0, maxResults);
  }

  const sourceResults = sourceOnlyResults(rankedSpans, maxResults);
  return sourceResults.length > 0 ? sourceResults : base;
}
