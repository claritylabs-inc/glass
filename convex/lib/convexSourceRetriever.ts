"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

type EmbedText = (text: string) => Promise<number[]>;

type SourceKind = "policy_pdf" | "application_pdf" | "email" | "attachment" | "manual_note";

type SourceSpan = {
  id: string;
  documentId: string;
  sourceKind?: SourceKind;
  kind: "pdf_text" | "pdf_image" | "html" | "markdown" | "plain_text" | "structured_field";
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  text: string;
  hash: string;
  textHash?: string;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  chunkId?: string;
  metadata?: Record<string, string>;
  location?: { page?: number };
};

type SourceRetrievalQuery = {
  question: string;
  limit?: number;
};

type SourceRetrievalResult = {
  span: SourceSpan;
  relevance: number;
};

type SourceRetriever = {
  searchSourceSpans(query: SourceRetrievalQuery): Promise<SourceRetrievalResult[]>;
};

type SourceChunkDoc = {
  _id: Id<"sourceChunks">;
  policyId?: Id<"policies">;
  chunkId: string;
  documentId: string;
  sourceSpanIds: string[];
  text: string;
  metadata?: Record<string, unknown>;
  _score?: number;
};

type SourceSpanDoc = {
  spanId: string;
  documentId: string;
  sourceKind: SourceKind;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  text: string;
  textHash: string;
  bbox?: SourceSpan["bbox"];
  metadata?: Record<string, string>;
};

function toSourceSpan(span: SourceSpanDoc, chunkId?: string): SourceSpan {
  return {
    id: span.spanId,
    documentId: span.documentId,
    sourceKind: span.sourceKind,
    kind: "pdf_text",
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
    sectionId: span.sectionId,
    formNumber: span.formNumber,
    text: span.text,
    hash: span.textHash,
    textHash: span.textHash,
    bbox: span.bbox,
    chunkId,
    metadata: span.metadata,
    location: span.pageStart ? { page: span.pageStart } : undefined,
  };
}

function fallbackSpan(chunk: SourceChunkDoc): SourceSpan {
  return {
    id: chunk.sourceSpanIds[0] ?? chunk.chunkId,
    documentId: chunk.documentId,
    sourceKind: "policy_pdf",
    kind: "pdf_text",
    text: chunk.text,
    hash: String(chunk.metadata?.textHash ?? chunk.chunkId),
    textHash: String(chunk.metadata?.textHash ?? chunk.chunkId),
    chunkId: chunk.chunkId,
    metadata: Object.fromEntries(
      Object.entries(chunk.metadata ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  };
}

export function createConvexSourceRetriever(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  embed: EmbedText,
): SourceRetriever {
  return {
    async searchSourceSpans(query: SourceRetrievalQuery): Promise<SourceRetrievalResult[]> {
      const vector = await embed(query.question);
      const chunkResults = await ctx.vectorSearch("sourceChunks", "by_embedding", {
        vector,
        limit: query.limit ?? 10,
        filter: (q) => q.eq("orgId", orgId),
      });

      const results: SourceRetrievalResult[] = [];
      for (const result of chunkResults) {
        const chunk = await ctx.runQuery(internal.sourceSpans.getChunk, { id: result._id });
        if (!chunk) continue;
        const chunkDoc = { ...chunk, _score: result._score } as SourceChunkDoc;
        const policySpans = chunkDoc.policyId
          ? await ctx.runQuery(internal.sourceSpans.listSpansByPolicyInternal, { policyId: chunkDoc.policyId })
          : [];
        const spansByStableId = new Map(
          (policySpans as SourceSpanDoc[]).map((span) => [span.spanId, span]),
        );
        const matchedSpans = chunkDoc.sourceSpanIds
          .map((id) => spansByStableId.get(id))
          .filter((span): span is SourceSpanDoc => Boolean(span));

        if (matchedSpans.length === 0) {
          results.push({ span: fallbackSpan(chunkDoc), relevance: result._score });
          continue;
        }

        for (const span of matchedSpans) {
          results.push({
            span: toSourceSpan(span, chunkDoc.chunkId),
            relevance: result._score,
          });
        }
      }

      return results.slice(0, query.limit ?? 10);
    },
  };
}
