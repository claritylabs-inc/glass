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
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  text: string;
  hash: string;
  textHash?: string;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  chunkId?: string;
  metadata?: Record<string, unknown>;
  location?: Record<string, unknown>;
};

type SourceRetrievalQuery = {
  question: string;
  limit?: number;
};

type SourceRetrievalResult = {
  span: SourceSpan;
  relevance: number;
};

type SourceNode = {
  id: string;
  documentId: string;
  parentId?: string;
  kind: string;
  title: string;
  description: string;
  textExcerpt?: string;
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
  bbox?: SourceSpan["bbox"];
  order: number;
  path: string;
  metadata?: Record<string, unknown>;
};

type SourceNodeRetrievalResult = {
  node: SourceNode;
  relevance: number;
  hierarchy: SourceNode[];
  spans: SourceSpan[];
};

type SourceRetriever = {
  searchSourceSpans(query: SourceRetrievalQuery): Promise<SourceRetrievalResult[]>;
  searchSourceNodes(query: SourceRetrievalQuery): Promise<SourceNodeRetrievalResult[]>;
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
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  location?: Record<string, unknown>;
  text: string;
  textHash: string;
  bbox?: SourceSpan["bbox"];
  metadata?: Record<string, unknown>;
};

type SourceNodeDoc = {
  _id: Id<"sourceNodes">;
  policyId?: Id<"policies">;
  nodeId: string;
  documentId: string;
  parentNodeId?: string;
  kind: string;
  title: string;
  description: string;
  textExcerpt?: string;
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
  bbox?: SourceSpan["bbox"];
  order: number;
  path: string;
  metadata?: Record<string, unknown>;
  _score?: number;
};

function queryTerms(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9$.,%-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 2),
  ));
}

function scoreText(query: string, terms: string[], text: string): number {
  const lower = text.toLowerCase();
  let score = query && lower.includes(query.toLowerCase()) ? 8 : 0;
  for (const term of terms) {
    if (lower.includes(term)) score += 1;
  }
  return score;
}

function scoreNode(query: string, terms: string[], node: SourceNodeDoc): number {
  const score = scoreText(
    query,
    terms,
    [node.title, node.kind, node.path, node.description, node.textExcerpt].filter(Boolean).join(" "),
  );
  if (score === 0) return 0;
  return score + (node.kind === "table_row" || node.kind === "schedule" ? 1.5 : 0);
}

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
    sourceUnit: span.sourceUnit,
    parentSpanId: span.parentSpanId,
    table: span.table,
    text: span.text,
    hash: span.textHash,
    textHash: span.textHash,
    bbox: span.bbox,
    chunkId,
    metadata: span.metadata,
    location: span.location ?? (span.pageStart ? { page: span.pageStart } : undefined),
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
    metadata: chunk.metadata,
  };
}

function toSourceNode(node: SourceNodeDoc): SourceNode {
  return {
    id: node.nodeId,
    documentId: node.documentId,
    parentId: node.parentNodeId,
    kind: node.kind,
    title: node.title,
    description: node.description,
    textExcerpt: node.textExcerpt,
    sourceSpanIds: node.sourceSpanIds,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    bbox: node.bbox,
    order: node.order,
    path: node.path,
    metadata: node.metadata,
  };
}

function expandHierarchy(nodes: SourceNodeDoc[], target: SourceNodeDoc): SourceNodeDoc[] {
  const byNodeId = new Map(nodes.map((node) => [node.nodeId, node]));
  const ancestors: SourceNodeDoc[] = [];
  let parent = target.parentNodeId ? byNodeId.get(target.parentNodeId) : undefined;
  while (parent) {
    ancestors.unshift(parent);
    parent = parent.parentNodeId ? byNodeId.get(parent.parentNodeId) : undefined;
  }
  const children = nodes
    .filter((node) => node.parentNodeId === target.nodeId)
    .sort((left, right) => left.order - right.order)
    .slice(0, 8);
  const siblings = target.parentNodeId
    ? nodes
        .filter((node) => node.parentNodeId === target.parentNodeId && node.nodeId !== target.nodeId)
        .sort((left, right) => Math.abs(left.order - target.order) - Math.abs(right.order - target.order))
        .slice(0, 4)
    : [];
  const ordered = [...ancestors, target, ...children, ...siblings];
  const seen = new Set<string>();
  return ordered.filter((node) => {
    if (seen.has(node.nodeId)) return false;
    seen.add(node.nodeId);
    return true;
  });
}

export function createConvexSourceRetriever(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  _embed: EmbedText,
): SourceRetriever {
  return {
    async searchSourceNodes(query: SourceRetrievalQuery): Promise<SourceNodeRetrievalResult[]> {
      const terms = queryTerms(query.question);
      const nodes = await ctx.runQuery((internal as any).sourceNodes.listByOrgInternal, {
        orgId,
        limit: 1200,
      }) as SourceNodeDoc[];
      const rankedNodes = nodes
        .map((node) => ({ ...node, _score: scoreNode(query.question, terms, node) }))
        .filter((node) => (node._score ?? 0) > 0)
        .sort((left, right) => (right._score ?? 0) - (left._score ?? 0))
        .slice(0, query.limit ?? 10);

      const results: SourceNodeRetrievalResult[] = [];
      for (const nodeDoc of rankedNodes) {
        const [policyNodes, policySpans] = nodeDoc.policyId
          ? await Promise.all([
              ctx.runQuery((internal as any).sourceNodes.listByPolicyInternal, { policyId: nodeDoc.policyId }),
              ctx.runQuery(internal.sourceSpans.listSpansByPolicyInternal, { policyId: nodeDoc.policyId }),
            ])
          : [[], []];
        const spansByStableId = new Map(
          (policySpans as SourceSpanDoc[]).map((span) => [span.spanId, span]),
        );
        const hierarchy = expandHierarchy(policyNodes as SourceNodeDoc[], nodeDoc).map(toSourceNode);
        const spanIds = new Set([
          ...nodeDoc.sourceSpanIds,
          ...hierarchy.flatMap((item) => item.sourceSpanIds),
        ]);
        const spans = [...spanIds]
          .map((id) => spansByStableId.get(id))
          .filter((span): span is SourceSpanDoc => Boolean(span))
          .slice(0, 10)
          .map((span) => toSourceSpan(span));
        results.push({
          node: toSourceNode(nodeDoc),
          relevance: nodeDoc._score ?? 0,
          hierarchy,
          spans,
        });
      }

      return results;
    },

    async searchSourceSpans(query: SourceRetrievalQuery): Promise<SourceRetrievalResult[]> {
      const terms = queryTerms(query.question);
      const chunks = await ctx.runQuery(internal.sourceSpans.listChunksByOrgInternal, {
        orgId,
        limit: 1200,
      }) as SourceChunkDoc[];
      const rankedChunks = chunks
        .map((chunk) => ({ ...chunk, _score: scoreText(query.question, terms, chunk.text) }))
        .filter((chunk) => (chunk._score ?? 0) > 0)
        .sort((left, right) => (right._score ?? 0) - (left._score ?? 0))
        .slice(0, query.limit ?? 10);

      const results: SourceRetrievalResult[] = [];
      for (const chunkDoc of rankedChunks) {
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
          results.push({ span: fallbackSpan(chunkDoc), relevance: chunkDoc._score ?? 0 });
          continue;
        }

        for (const span of matchedSpans) {
          results.push({
            span: toSourceSpan(span, chunkDoc.chunkId),
            relevance: chunkDoc._score ?? 0,
          });
        }
      }

      return results.slice(0, query.limit ?? 10);
    },
  };
}
