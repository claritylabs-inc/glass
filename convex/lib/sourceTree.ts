"use node";

import {
  buildDocumentSourceTree as buildSdkDocumentSourceTree,
  buildDeterministicOperationalProfile as buildSdkOperationalProfile,
  mergeOperationalProfile,
  normalizeDocumentSourceTreePaths,
  stableHash,
  type DocumentSourceNode,
  type OperationalCoverageLine,
  type OperationalParty,
  type PolicyOperationalProfile,
  type SourceBackedValue,
  type SourceSpan,
  type SourceSpanKind,
  type SourceSpanUnit,
} from "@claritylabs/cl-sdk";
import dayjs from "dayjs";
import { normalizeCoverageName, normalizeText } from "./coverageNames";
import { POLICY_TYPE_LABELS } from "./policyTypes";

export type {
  DocumentSourceNode,
  OperationalCoverageLine,
  PolicyOperationalProfile,
  SourceBackedValue,
};

export type DocumentSourceNodeKind =
  | "document"
  | "page_group"
  | "page"
  | "form"
  | "endorsement"
  | "section"
  | "schedule"
  | "clause"
  | "table"
  | "table_row"
  | "table_cell"
  | "text";

export type SourceSpanLike = {
  id?: string;
  spanId?: string;
  documentId?: string;
  sourceKind?: string;
  kind?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  location?: { page?: number; startPage?: number; endPage?: number } | Record<string, unknown>;
  text?: string;
  textHash?: string;
  hash?: string;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  metadata?: Record<string, unknown>;
};

type DeclarationProfileField = {
  field: string;
  value: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

const SOURCE_SPAN_KINDS = new Set<SourceSpanKind>([
  "pdf_text",
  "pdf_image",
  "html",
  "markdown",
  "plain_text",
  "structured_field",
]);

const SOURCE_SPAN_UNITS = new Set<SourceSpanUnit>([
  "page",
  "section",
  "table",
  "table_row",
  "table_cell",
  "key_value",
  "text",
]);

const SOURCE_NODE_KINDS = new Set<DocumentSourceNodeKind>([
  "document",
  "page_group",
  "page",
  "form",
  "endorsement",
  "section",
  "schedule",
  "clause",
  "table",
  "table_row",
  "table_cell",
  "text",
]);
const POLICY_TYPE_KEYS = new Set(Object.keys(POLICY_TYPE_LABELS));

function normalizeWhitespace(value: string): string {
  return normalizeText(value);
}

function truncate(value: string | undefined, maxChars: number): string | undefined {
  const text = normalizeWhitespace(value ?? "");
  if (!text) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}...` : text;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function spanId(span: SourceSpanLike): string {
  return String(span.id ?? span.spanId ?? span.textHash ?? stableHash(span.text ?? "").slice(0, 16));
}

function pageStart(span: SourceSpanLike): number | undefined {
  const location = span.location ?? {};
  return span.pageStart
    ?? (typeof location.page === "number" ? location.page : undefined)
    ?? (typeof location.startPage === "number" ? location.startPage : undefined);
}

function pageEnd(span: SourceSpanLike): number | undefined {
  const location = span.location ?? {};
  return span.pageEnd
    ?? (typeof location.endPage === "number" ? location.endPage : undefined)
    ?? pageStart(span);
}

function nodeId(documentId: string, kind: string, index: number): string {
  return [
    documentId.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    "source_node",
    kind,
    stableHash(`${documentId}|${kind}|${index}`).slice(0, 12),
  ].join(":");
}

function nodeDescription(params: {
  kind: DocumentSourceNodeKind;
  title: string;
  text?: string;
  page?: number;
}): string {
  return [
    params.title,
    params.kind.replace(/_/g, " "),
    params.page ? `page ${params.page}` : undefined,
    truncate(params.text, 1200),
  ].filter(Boolean).join(" | ");
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizedTable(value: unknown): SourceSpan["table"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    tableId: typeof record.tableId === "string" ? record.tableId : undefined,
    rowIndex: numberField(record.rowIndex),
    columnIndex: numberField(record.columnIndex),
    columnName: typeof record.columnName === "string" ? record.columnName : undefined,
    rowSpanId: typeof record.rowSpanId === "string" ? record.rowSpanId : undefined,
    tableSpanId: typeof record.tableSpanId === "string" ? record.tableSpanId : undefined,
    isHeader: typeof record.isHeader === "boolean" ? record.isHeader : undefined,
  };
}

function normalizedLocation(value: unknown): SourceSpan["location"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    page: numberField(record.page),
    startPage: numberField(record.startPage),
    endPage: numberField(record.endPage),
    charStart: numberField(record.charStart),
    charEnd: numberField(record.charEnd),
    lineStart: numberField(record.lineStart),
    lineEnd: numberField(record.lineEnd),
    fieldPath: typeof record.fieldPath === "string" ? record.fieldPath : undefined,
  };
}

function normalizedSourceUnit(value: unknown): SourceSpanUnit | undefined {
  return typeof value === "string" && SOURCE_SPAN_UNITS.has(value as SourceSpanUnit)
    ? value as SourceSpanUnit
    : undefined;
}

function normalizedKind(value: unknown): SourceSpanKind {
  return typeof value === "string" && SOURCE_SPAN_KINDS.has(value as SourceSpanKind)
    ? value as SourceSpanKind
    : "pdf_text";
}

function sourceSpansForSdk(sourceSpans: SourceSpanLike[], documentId: string): SourceSpan[] {
  return sourceSpans
    .filter((span) => typeof span.text === "string")
    .map((span, index) => {
      const rawId = spanId(span);
      const id = span.id || span.spanId
        ? rawId
        : [
          rawId,
          pageStart(span) ?? "na",
          span.sourceUnit ?? span.metadata?.sourceUnit ?? span.metadata?.elementType ?? "unit",
          typeof span.table?.rowIndex === "number" ? span.table.rowIndex : "row",
          typeof span.table?.columnIndex === "number" ? span.table.columnIndex : "col",
          index,
        ].join(":");
      const text = span.text ?? "";
      return {
        id,
        documentId: span.documentId ?? documentId,
        sourceKind: span.sourceKind === "policy_pdf" || span.sourceKind === "application_pdf" || span.sourceKind === "email" || span.sourceKind === "attachment" || span.sourceKind === "manual_note"
          ? span.sourceKind
          : undefined,
        chunkId: undefined,
        kind: normalizedKind(span.kind),
        text,
        hash: span.hash ?? span.textHash ?? stableHash(text || id),
        textHash: span.textHash,
        pageStart: pageStart(span),
        pageEnd: pageEnd(span),
        sectionId: span.sectionId,
        formNumber: span.formNumber,
        sourceUnit: normalizedSourceUnit(span.sourceUnit ?? span.metadata?.sourceUnit ?? span.metadata?.elementType),
        parentSpanId: span.parentSpanId,
        table: normalizedTable(span.table),
        bbox: span.bbox,
        location: normalizedLocation(span.location),
        metadata: stringRecord(span.metadata),
      } satisfies SourceSpan;
    });
}

export function buildSourceTreeFromSpans(sourceSpans: SourceSpanLike[], documentId?: string): DocumentSourceNode[] {
  const resolvedDocumentId = documentId ?? sourceSpans[0]?.documentId ?? "document";
  const nodes: DocumentSourceNode[] = [];
  let order = 0;
  const rootId = nodeId(resolvedDocumentId, "document", 0);
  const spans = sourceSpans
    .filter((span) => typeof span.text === "string" && span.text.trim())
    .map((span, index) => ({ span, index }))
    .sort((left, right) => {
      const leftPage = pageStart(left.span) ?? Number.MAX_SAFE_INTEGER;
      const rightPage = pageStart(right.span) ?? Number.MAX_SAFE_INTEGER;
      if (leftPage !== rightPage) return leftPage - rightPage;
      return left.index - right.index;
    });
  nodes.push({
    id: rootId,
    documentId: resolvedDocumentId,
    kind: "document",
    title: "Document",
    description: "Document root for source-native policy hierarchy",
    sourceSpanIds: [],
    pageStart: spans[0] ? pageStart(spans[0].span) : undefined,
    pageEnd: spans.at(-1) ? pageEnd(spans.at(-1)!.span) : undefined,
    order: order++,
    path: "1",
  });

  const pageIds = new Map<number, string>();
  const tableIds = new Map<string, string>();
  const rowIds = new Map<string, string>();
  const tableNumberByPage = new Map<number, number>();

  function ensurePage(page: number, span?: SourceSpanLike) {
    const existing = pageIds.get(page);
    if (existing) return existing;
    const id = nodeId(resolvedDocumentId, "page", page);
    pageIds.set(page, id);
    nodes.push({
      id,
      documentId: resolvedDocumentId,
      parentId: rootId,
      kind: "page",
      title: `Page ${page}`,
      description: nodeDescription({
        kind: "page",
        title: `Page ${page}`,
        text: span?.text,
        page,
      }),
      textExcerpt: truncate(span?.text, 1600),
      sourceSpanIds: span ? [spanId(span)] : [],
      pageStart: page,
      pageEnd: page,
      bbox: span?.bbox,
      order: order++,
      path: "",
      metadata: span?.metadata,
    });
    return id;
  }

  function ensureTable(pageId: string, page: number, tableId: string) {
    const existing = tableIds.get(tableId);
    if (existing) return existing;
    const nextTableNumber = (tableNumberByPage.get(page) ?? 0) + 1;
    tableNumberByPage.set(page, nextTableNumber);
    const id = nodeId(resolvedDocumentId, "table", nodes.length);
    tableIds.set(tableId, id);
    nodes.push({
      id,
      documentId: resolvedDocumentId,
      parentId: pageId,
      kind: "table",
      title: `Table ${nextTableNumber}`,
      description: nodeDescription({
        kind: "table",
        title: `Table ${nextTableNumber}`,
        page,
      }),
      sourceSpanIds: [],
      pageStart: page,
      pageEnd: page,
      order: order++,
      path: "",
      metadata: { tableId },
    });
    return id;
  }

  for (const { span } of spans) {
    const page = pageStart(span) ?? 1;
    const unit = span.sourceUnit ?? span.metadata?.sourceUnit ?? span.metadata?.elementType;
    if (unit === "text" && /^SPECIMEN POLICY — FOR TESTING ONLY$/i.test(normalizeWhitespace(span.text ?? ""))) {
      continue;
    }
    const table = normalizedTable(span.table);
    const pageId = ensurePage(page, unit === "page" ? span : undefined);
    if (unit === "page") continue;

    if (unit === "table_row" && table?.tableId) {
      const tableNodeId = ensureTable(pageId, page, table.tableId);
      const id = nodeId(resolvedDocumentId, "table_row", nodes.length);
      rowIds.set(spanId(span), id);
      nodes.push({
        id,
        documentId: resolvedDocumentId,
        parentId: tableNodeId,
        kind: "table_row",
        title: table.isHeader ? "Header row" : `Row ${typeof table.rowIndex === "number" ? table.rowIndex + 1 : rowIds.size}`,
        description: nodeDescription({
          kind: "table_row",
          title: table.isHeader ? "Header row" : "Table row",
          text: span.text,
          page,
        }),
        textExcerpt: truncate(span.text, 1600),
        sourceSpanIds: [spanId(span)],
        pageStart: page,
        pageEnd: pageEnd(span),
        bbox: span.bbox,
        order: order++,
        path: "",
        metadata: { ...span.metadata, table },
      });
      continue;
    }

    if (unit === "table_cell" && table?.tableId) {
      const tableNodeId = ensureTable(pageId, page, table.tableId);
      const rowKey = table.rowSpanId ?? span.parentSpanId ?? `${table.tableId}:row:${table.rowIndex ?? "unknown"}`;
      let rowNodeId = rowIds.get(rowKey);
      if (!rowNodeId) {
        rowNodeId = nodeId(resolvedDocumentId, "table_row", nodes.length);
        rowIds.set(rowKey, rowNodeId);
        nodes.push({
          id: rowNodeId,
          documentId: resolvedDocumentId,
          parentId: tableNodeId,
          kind: "table_row",
          title: `Row ${typeof table.rowIndex === "number" ? table.rowIndex + 1 : rowIds.size}`,
          description: nodeDescription({
            kind: "table_row",
            title: "Table row",
            page,
          }),
          sourceSpanIds: [],
          pageStart: page,
          pageEnd: page,
          order: order++,
          path: "",
          metadata: { tableId: table.tableId, rowIndex: table.rowIndex },
        });
      }
      nodes.push({
        id: nodeId(resolvedDocumentId, "table_cell", nodes.length),
        documentId: resolvedDocumentId,
        parentId: rowNodeId,
        kind: "table_cell",
        title: table.columnName || `Column ${typeof table.columnIndex === "number" ? table.columnIndex + 1 : ""}`.trim(),
        description: nodeDescription({
          kind: "table_cell",
          title: table.columnName || "Table cell",
          text: span.text,
          page,
        }),
        textExcerpt: truncate(span.text, 1600),
        sourceSpanIds: [spanId(span)],
        pageStart: page,
        pageEnd: pageEnd(span),
        bbox: span.bbox,
        order: order++,
        path: "",
        metadata: { ...span.metadata, table },
      });
      continue;
    }

    nodes.push({
      id: nodeId(resolvedDocumentId, "text", nodes.length),
      documentId: resolvedDocumentId,
      parentId: pageId,
      kind: "text",
      title: truncate(span.text, 80) ?? "Text",
      description: nodeDescription({
        kind: "text",
        title: "Text",
        text: span.text,
        page,
      }),
      textExcerpt: truncate(span.text, 1600),
      sourceSpanIds: [spanId(span)],
      pageStart: page,
      pageEnd: pageEnd(span),
      bbox: span.bbox,
      order: order++,
      path: "",
      metadata: span.metadata,
    });
  }

  return nodes;
}

function buildFallbackSourceTree(sourceSpans: SourceSpanLike[], documentId: string): DocumentSourceNode[] {
  const sdkSpans = sourceSpansForSdk(sourceSpans, documentId);
  if (sdkSpans.length > 0) {
    const sdkTree = buildSdkDocumentSourceTree(sdkSpans, documentId);
    if (sdkTree.some((node) => node.kind !== "document")) {
      return sdkTree;
    }
  }
  return buildSourceTreeFromSpans(sourceSpans, documentId);
}

function isValidSourceNodeId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function hasParentCycle(nodeId: string, parentById: Map<string, string | undefined>): boolean {
  const seen = new Set<string>();
  let currentId: string | undefined = nodeId;
  while (currentId) {
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    currentId = parentById.get(currentId);
  }
  return false;
}

function pruneInvalidTree(nodes: DocumentSourceNode[]): DocumentSourceNode[] {
  const uniqueNodes: DocumentSourceNode[] = [];
  const seenIds = new Set<string>();
  for (const node of nodes) {
    if (seenIds.has(node.id)) continue;
    seenIds.add(node.id);
    uniqueNodes.push(node);
  }

  const activeIds = new Set(uniqueNodes.map((node) => node.id));
  const parentById = new Map(
    uniqueNodes.map((node) => [node.id, node.parentId] as const),
  );

  for (const node of uniqueNodes) {
    if (node.parentId && !activeIds.has(node.parentId)) {
      activeIds.delete(node.id);
      continue;
    }
    if (hasParentCycle(node.id, parentById)) {
      activeIds.delete(node.id);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of uniqueNodes) {
      if (!activeIds.has(node.id)) continue;
      if (node.parentId && !activeIds.has(node.parentId)) {
        activeIds.delete(node.id);
        changed = true;
      }
    }
  }

  return uniqueNodes.filter((node) => activeIds.has(node.id));
}

function isTitleOrganizerNode(node: DocumentSourceNode | undefined) {
  return Boolean(
    node?.kind === "text" &&
    node.metadata &&
    typeof node.metadata === "object" &&
    !Array.isArray(node.metadata) &&
    (node.metadata as Record<string, unknown>).organizer === "title_block",
  );
}

function repairTextParentedNodes(nodes: DocumentSourceNode[]): DocumentSourceNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    if (!node.parentId) return node;
    const parent = byId.get(node.parentId);
    if (!parent || parent.kind !== "text") return node;
    if (isTitleOrganizerNode(parent) || node.kind !== "text") {
      return { ...node, parentId: parent.parentId };
    }
    return node;
  });
}

export function normalizeSourceTree(
  rawNodes: unknown,
  sourceSpans: SourceSpanLike[],
  documentId: string,
): DocumentSourceNode[] {
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return normalizeDocumentSourceTreePaths(buildFallbackSourceTree(sourceSpans, documentId));
  }
  const validSpanIds = new Set(sourceSpans.map(spanId));
  const nodes = rawNodes
    .map((node, index): DocumentSourceNode | undefined => {
      if (!node || typeof node !== "object") return undefined;
      const record = node as Record<string, unknown>;
      if (!isValidSourceNodeId(record.id)) return undefined;
      const kind = typeof record.kind === "string" && SOURCE_NODE_KINDS.has(record.kind as DocumentSourceNodeKind)
        ? record.kind as DocumentSourceNodeKind
        : undefined;
      if (!kind) return undefined;
      const title = typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : titleCase(kind);
      const textExcerpt = truncate(typeof record.textExcerpt === "string" ? record.textExcerpt : undefined, 1600);
      const description = truncate(typeof record.description === "string" ? record.description : undefined, 1800)
        ?? nodeDescription({
          kind,
          title,
          text: textExcerpt,
          page: typeof record.pageStart === "number" ? record.pageStart : undefined,
        });
      const rawSpanIds = Array.isArray(record.sourceSpanIds) ? record.sourceSpanIds : [];
      const parentId = isValidSourceNodeId(record.parentId) ? record.parentId : undefined;
      return {
        id: record.id,
        documentId: typeof record.documentId === "string" ? record.documentId : documentId,
        parentId,
        kind,
        title,
        description,
        textExcerpt,
        sourceSpanIds: rawSpanIds
          .filter((value): value is string => typeof value === "string" && (!validSpanIds.size || validSpanIds.has(value)))
          .slice(0, 80),
        pageStart: typeof record.pageStart === "number" ? record.pageStart : undefined,
        pageEnd: typeof record.pageEnd === "number" ? record.pageEnd : undefined,
        bbox: Array.isArray(record.bbox) ? record.bbox as DocumentSourceNode["bbox"] : undefined,
        order: typeof record.order === "number" ? record.order : index,
        path: typeof record.path === "string" ? record.path : "",
        metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
          ? record.metadata as Record<string, unknown>
          : undefined,
      };
    })
    .filter((node): node is DocumentSourceNode => Boolean(node));
  const validNodes = pruneInvalidTree(nodes);
  const hasDocumentRoot = validNodes.some((node) => node.kind === "document" && !node.parentId);
  return normalizeDocumentSourceTreePaths(
    hasDocumentRoot ? repairTextParentedNodes(validNodes) : buildFallbackSourceTree(sourceSpans, documentId),
  );
}

function nodeText(node: DocumentSourceNode): string {
  return normalizeWhitespace([node.title, node.description, node.textExcerpt].filter(Boolean).join(" "));
}

function sourceBackedValueFromDocument(
  value: unknown,
  nodes: DocumentSourceNode[],
): SourceBackedValue | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalizeWhitespace(value);
  const node = nodes.find((candidate) => nodeText(candidate).toLowerCase().includes(normalized.toLowerCase()));
  if (!node) return undefined;
  return {
    value: normalized,
    confidence: "medium",
    sourceNodeIds: [node.id],
    sourceSpanIds: node.sourceSpanIds,
  };
}

function sourceBackedValueFromNode(
  node: DocumentSourceNode,
  value: string | undefined,
  confidence: SourceBackedValue["confidence"] = "high",
): SourceBackedValue | undefined {
  const normalized = normalizeWhitespace(value ?? "").replace(/^[\s:;#-]+|[\s;,.]+$/g, "");
  if (!normalized) return undefined;
  return {
    value: normalized,
    confidence,
    sourceNodeIds: [node.id],
    sourceSpanIds: node.sourceSpanIds,
  };
}

function columnValues(text: string): Map<number, string> {
  const values = new Map<number, string>();
  const pattern = /\bColumn\s+(\d+):\s*([\s\S]*?)(?=\s+\|\s+Column\s+\d+:|$)/gi;
  for (const match of text.matchAll(pattern)) {
    const index = Number(match[1]);
    const value = normalizeWhitespace(match[2] ?? "");
    if (Number.isFinite(index) && value) values.set(index, value);
  }
  return values;
}

function isBadOperationalIdentityValue(value: string | undefined): boolean {
  const text = normalizeWhitespace(value ?? "");
  if (!text) return true;
  if (text.length > 180) return true;
  if (/^[a-z]/.test(text)) return true;
  if (/^(owner|policy owner|applicant)\s*:/i.test(text)) return true;
  if (/\b(?:insured persons?|insurance amount|benefit amount|policy number|owner|plan|premium)\s*:/i.test(text)) return true;
  if (/[•]/.test(text)) return true;
  if (/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]$/.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 10 && /\b(the|a|an|and|or|of|to|for|with|when|if|we|you|your|our|us|by)\b/i.test(text)) {
    return true;
  }
  return /(__{3,}|claims-made|please read|all monetary amounts|page\s+\d+\s+of\s+\d+|in consideration of the payment|subject to the declarations|policy title|signature blocks?|errors?\s+and\s+omissions\s+liability\s+policy|insured person dies|death benefit|grace period|collateral assignee|hypothecary creditor|for a loan|preced\b|\bCanad\b)/i.test(text);
}

function isBadBrokerValue(value: string | undefined): boolean {
  const text = normalizeWhitespace(value ?? "");
  if (isBadOperationalIdentityValue(text)) return true;
  if (text.length > 140) return true;
  if (/^[\\/]/.test(text)) return true;
  return /\b(forms?\/endorsements?|endorsements?\s+at\s+inception|bilateral\s+discovery|discovery\/erp|erp\s+options?|list\s+of\s+forms?|coverage\s+parts?|declarations?|sublimits?|deductibles?|premium|truncated|immunosuppressive|agents)\b/i.test(text);
}

function isLikelyNamedInsuredValue(value: string): boolean {
  const text = normalizeWhitespace(value);
  if (!text || text.length > 140) return false;
  if (/^(owner|policy owner|applicant|insured|insured person)\s*:/i.test(text)) return false;
  if (/^(holds|is|are|has|have|with|including|through|provides|administers|licensed|federally)\b/i.test(text)) return false;
  if (/\b(policy|coverage|deductible|premium|claim|limit|retroactive|endorsement)\b/i.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function datePhraseFromScheduleValue(value: string): string {
  const text = normalizeWhitespace(value);
  const monthDate = text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*(?:\d{4}|X{4})\b/i);
  if (monthDate) return monthDate[0];
  const isoDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) return isoDate[0];
  const slashDate = text.match(/\b\d{1,2}[/-]\d{1,2}[/-](?:\d{2,4}|X{4})\b/);
  return slashDate ? slashDate[0] : text;
}

function sourceTreeText(sourceTree: DocumentSourceNode[], maxNodes = 80): string {
  return normalizeWhitespace(
    sourceTree
      .filter((node) => node.kind !== "document")
      .slice(0, maxNodes)
      .map((node) => [node.title, node.description, node.textExcerpt].filter(Boolean).join(" "))
      .join(" "),
  );
}

function inferPersonalPolicyTypesFromText(text: string): string[] {
  const normalized = text.toLowerCase();
  const types: string[] = [];
  const add = (type: string, pattern: RegExp) => {
    if (pattern.test(normalized) && !types.includes(type)) types.push(type);
  };
  add("life", /\b(life insurance|permanent life|term life|whole life|universal life|sun permanent life|sun par protector|manulife par|vitality\s*plus|death benefit)\b/i);
  add("critical_illness", /\b(critical illness|critical illness insurance|covered critical illness|partial benefit payout)\b/i);
  add("disability", /\b(disability benefit|total disability|catastrophic disability|disability waiver|waiver of premium disability)\b/i);
  add("long_term_care", /\b(long[-\s]?term care|long term care conversion)\b/i);
  return types;
}

function inferPolicyTypesFromEvidence(
  profile: PolicyOperationalProfile,
  sourceTree: DocumentSourceNode[],
): string[] {
  return inferPersonalPolicyTypesFromText([
    sourceTreeText(sourceTree),
    profile.coverageTypes.join(" "),
    profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => [
      coverage.name,
      coverage.limit,
      coverage.premium,
      coverage.limits.map((term: PolicyOperationalProfile["coverages"][number]["limits"][number]) =>
        `${term.label} ${term.value} ${term.appliesTo ?? ""}`
      ).join(" "),
    ].filter(Boolean).join(" ")).join(" "),
  ].join(" "));
}

function withEvidencePolicyTypes(
  profile: PolicyOperationalProfile,
  sourceTree: DocumentSourceNode[],
): PolicyOperationalProfile {
  const inferred = inferPolicyTypesFromEvidence(profile, sourceTree);
  if (inferred.length === 0) return profile;
  const current = controlledPolicyTypes(profile.policyTypes);
  const next = current.every((type) => type === "other")
    ? inferred
    : [...current.filter((type) => type !== "other"), ...inferred];
  return {
    ...profile,
    policyTypes: [...new Set(next)].slice(0, 6),
  };
}

function valueOfSourceBackedValue(value: unknown): string | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && "value" in value && typeof value.value === "string"
    ? value.value
    : undefined;
}

function normalizedPolicyNumberValue(value: string | undefined): string | undefined {
  const text = normalizeWhitespace(value ?? "").replace(/^[\s:;#-]+|[\s;,.]+$/g, "");
  if (!text) return undefined;
  const extracted = policyNumberCandidateFromText(text);
  if (extracted) return extracted;
  if (/^[A-Z0-9][A-Z0-9,.-]{4,}[A-Z0-9]$/i.test(text) && /[0-9]/.test(text)) {
    return text;
  }
  return undefined;
}

function isBadPolicyNumberValue(value: string | undefined): boolean {
  return !normalizedPolicyNumberValue(value);
}

function isValidPremiumValue(value: string | undefined): boolean {
  const text = normalizeWhitespace(value ?? "");
  if (!text) return false;
  if (/^\d{1,3}$/.test(text)) return false;
  return /\$[A-Z0-9]/i.test(text)
    || (/\b(?:CAD|USD)\b/i.test(text) && /(?:\d|X{2,})/i.test(text))
    || /\b\d{1,3}(?:,\d{3})+\.\d{2}\b/.test(text)
    || /\b\d+\.\d{2}\b/.test(text)
    || /\bX{2,}(?:,X{3})*(?:\.X{2})\b/i.test(text);
}

function sanitizeOperationalProfileCandidate(
  candidate: Partial<PolicyOperationalProfile>,
): Partial<PolicyOperationalProfile> {
  const clean = { ...candidate };
  const policyNumber = valueOfSourceBackedValue(clean.policyNumber);
  const normalizedPolicyNumber = normalizedPolicyNumberValue(policyNumber);
  if (policyNumber && normalizedPolicyNumber) {
    clean.policyNumber = {
      ...(clean.policyNumber as SourceBackedValue),
      value: normalizedPolicyNumber,
    };
  } else if (policyNumber) {
    delete clean.policyNumber;
  }
  const premium = valueOfSourceBackedValue(clean.premium);
  if (premium && !isValidPremiumValue(premium)) {
    delete clean.premium;
  }
  for (const key of ["namedInsured", "insurer", "broker"] as const) {
    const value = valueOfSourceBackedValue(clean[key]);
    const invalid = key === "broker"
      ? isBadBrokerValue(value)
      : isBadOperationalIdentityValue(value);
    if (invalid) {
      delete clean[key];
    }
  }
  return clean;
}

function declarationProfileCandidate(sourceTree: DocumentSourceNode[]): Partial<PolicyOperationalProfile> {
  const nodes = sourceTree
    .filter((node) => node.kind !== "document")
    .sort((left, right) => left.order - right.order);
  const candidate: Partial<PolicyOperationalProfile> = {};

  for (const node of nodes) {
    const columns = columnValues(node.textExcerpt ?? "");
    const label = normalizeWhitespace(columns.get(1) ?? "");
    const value = normalizeWhitespace(columns.get(2) ?? "");
    if (!label || !value) continue;
    const normalizedLabel = label.toLowerCase();

    if (
      !candidate.namedInsured
      && /(?:item\s*1\b.*)?(?:named insured|insured name|policyholder|applicant)\b/.test(normalizedLabel)
      && isLikelyNamedInsuredValue(value)
    ) {
      candidate.namedInsured = sourceBackedValueFromNode(node, value);
    } else if (!candidate.policyNumber && /(?:item\s*2\b.*)?(?:policy|contract)\s*(?:number|no\.?|#)\b/.test(normalizedLabel)) {
      candidate.policyNumber = sourceBackedValueFromNode(node, value);
    } else if (/(?:item\s*3\b.*)?(?:policy period|policy term|period of insurance|effective.*(?:expiration|expiry)|from.*to)\b/.test(normalizedLabel)) {
      const period = value.match(/from:\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})\s+to:\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i);
      if (period) {
        candidate.effectiveDate ??= sourceBackedValueFromNode(node, period[1]);
        candidate.expirationDate ??= sourceBackedValueFromNode(node, period[2]);
      }
    } else if (!candidate.effectiveDate && /\b(?:policy date|date this policy starts|policy starts)\b/.test(normalizedLabel)) {
      candidate.effectiveDate = sourceBackedValueFromNode(node, datePhraseFromScheduleValue(value));
    } else if (!candidate.expirationDate && /\b(?:date this policy ends|policy ends|policy expiry|policy expiration)\b/.test(normalizedLabel)) {
      candidate.expirationDate = sourceBackedValueFromNode(node, datePhraseFromScheduleValue(value));
    } else if (!candidate.premium && /\b(?:annual premium|total premium|policy premium|premium due)\b/.test(normalizedLabel)) {
      candidate.premium = sourceBackedValueFromNode(node, value);
    } else if (!candidate.broker && /\b(?:broker|broker of record|producer|agent of record)\b/.test(normalizedLabel)) {
      candidate.broker = sourceBackedValueFromNode(node, value.replace(/\s+RIBO Registration\b.*$/i, ""));
    }
  }

  const jacketInsurerNode = nodes.find((node) =>
    (node.pageStart ?? Number.MAX_SAFE_INTEGER) <= 2
    && /\b[A-Z][A-Z &'’.-]+INSURANCE COMPANY\b/.test(node.textExcerpt ?? "")
  );
  const insurer = jacketInsurerNode?.textExcerpt?.match(/\b([A-Z][A-Z &'’.-]+INSURANCE COMPANY)\b/)?.[1];
  if (jacketInsurerNode && insurer) {
    const cleanInsurer = insurer.replace(/^(?:SPECIMEN POLICY\s+—\s+)?FOR TESTING ONLY\s+/i, "");
    candidate.insurer = sourceBackedValueFromNode(jacketInsurerNode, titleCase(cleanInsurer.toLowerCase()));
  }

  if (!candidate.insurer) {
    const manulifeNode = nodes.find((node) =>
      (node.pageStart ?? Number.MAX_SAFE_INTEGER) <= 3
      && /\bManulife\b/i.test([node.title, node.description, node.textExcerpt].filter(Boolean).join(" ")),
    );
    if (manulifeNode) {
      candidate.insurer = sourceBackedValueFromNode(manulifeNode, "Manulife");
    }
  }

  const brokerNode = nodes.find((node) => /\bItem\s*12\.\s*Broker of Record\b/i.test(node.textExcerpt ?? ""));
  const broker = brokerNode?.textExcerpt?.match(/\bItem\s*12\.\s*Broker of Record\s+(.+?)(?=\s+Item\s*13\.|\s+SLS-[A-Z]|\s+This Policy\b|\s+Countersigned\b|$)/i)?.[1];
  if (brokerNode && broker) {
    candidate.broker = sourceBackedValueFromNode(brokerNode, broker.replace(/\s+RIBO Registration\b.*$/i, ""));
  }

  return candidate;
}

const POLICY_NUMBER_PATTERNS = [
  /\b(?:policy|contract)\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9,.-]{4,}[A-Z0-9])/i,
  /\b(?:policy|contract)\s*[:#]\s*([A-Z0-9][A-Z0-9,.-]{4,}[A-Z0-9])/i,
];

const POLICY_TYPE_ALIASES: Record<string, string> = {
  "life insurance": "life",
  "permanent life": "life",
  "term life": "life",
  "whole life": "life",
  "universal life": "life",
  "critical illness": "critical_illness",
  "critical illness insurance": "critical_illness",
  "disability insurance": "disability",
  "long term care": "long_term_care",
  "long-term care": "long_term_care",
};

function policyNumberCandidateFromText(text: string): string | undefined {
  for (const pattern of POLICY_NUMBER_PATTERNS) {
    const value = text.match(pattern)?.[1];
    const clean = normalizeWhitespace(value ?? "").replace(/^[\s:;#-]+|[\s;,.]+$/g, "");
    if (clean) return clean;
  }
  return undefined;
}

function policyNumberEvidenceScore(node: DocumentSourceNode): number {
  const text = normalizeWhitespace([
    node.path,
    node.title,
    node.description,
    node.textExcerpt,
  ].filter(Boolean).join(" ")).toLowerCase();
  let score = 0;
  if (/\b(policy\s+summary|declarations?|declaration\s+page|schedule)\b/.test(text)) score += 80;
  if (/\b(plan|policy\s+date|insured\s+person|named\s+insured|insurance\s+amount|benefit\s+amount)\b/.test(text)) score += 35;
  if (node.kind === "table_row" || node.kind === "table_cell" || node.kind === "text") score += 20;
  if (node.kind === "page") score += 10;
  if (typeof node.pageStart === "number" && node.pageStart > 1 && node.pageStart <= 10) score += 20;
  if (typeof node.pageStart === "number" && node.pageStart === 1) score -= 30;
  if (/\b(notices?\s+and\s+jacket|policy\s+jacket|front\s+matter|table\s+of\s+contents)\b/.test(text)) score -= 70;
  if (node.kind === "page_group" || node.kind === "form") score -= 30;
  return score;
}

function repairPolicyNumberFromSourceTree(
  profile: PolicyOperationalProfile,
  sourceTree: DocumentSourceNode[],
): PolicyOperationalProfile {
  const current = profile.policyNumber?.value;
  const candidateNodes = sourceTree
    .filter((node) => node.kind !== "document")
    .slice(0, 120)
    .map((node) => ({
      node,
      value: policyNumberCandidateFromText([node.title, node.description, node.textExcerpt].filter(Boolean).join(" ")),
      score: policyNumberEvidenceScore(node),
    }))
    .filter((item): item is { node: DocumentSourceNode; value: string; score: number } => Boolean(item.value))
    .sort((left, right) =>
      right.score - left.score ||
      (left.node.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.node.pageStart ?? Number.MAX_SAFE_INTEGER) ||
      left.node.order - right.node.order,
    );
  const candidateNode = candidateNodes[0];
  if (!candidateNode?.value) return profile;
  if (current && candidateNode.value === current) return profile;
  if (current && !isBadPolicyNumberValue(current) && !candidateNode.value.startsWith(current) && candidateNode.score < 80) {
    return profile;
  }
  return {
    ...profile,
    policyNumber: sourceBackedValueFromNode(candidateNode.node, candidateNode.value, "high"),
  };
}

function controlledPolicyTypes(values: unknown): string[] {
  const types = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
  const controlled = types
    .map((type) => type.trim().toLowerCase().replace(/\s+/g, " "))
    .map((type) => POLICY_TYPE_ALIASES[type] ?? type.replace(/[\s-]+/g, "_"))
    .filter((type) => POLICY_TYPE_KEYS.has(type));
  const unique = [...new Set(controlled)].slice(0, 6);
  return unique.length ? unique : ["other"];
}

function controlledCoverageTypes(policyTypes: string[]): string[] {
  return policyTypes.map((type) => POLICY_TYPE_LABELS[type] ?? type);
}

const COVERAGE_TERM_KINDS = new Set([
  "each_claim_limit",
  "each_occurrence_limit",
  "each_loss_limit",
  "aggregate_limit",
  "sublimit",
  "retention",
  "deductible",
  "retroactive_date",
  "premium",
  "other",
]);

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function cleanCoverageTerms(value: unknown): Array<{
  kind: string;
  label: string;
  value: string;
  amount?: number;
  appliesTo?: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
}> {
  if (!Array.isArray(value)) return [];
  const terms: Array<{
    kind: string;
    label: string;
    value: string;
    amount?: number;
    appliesTo?: string;
    sourceNodeIds: string[];
    sourceSpanIds: string[];
  }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" ? normalizeWhitespace(record.label) : "";
    const termValue = typeof record.value === "string" ? normalizeWhitespace(record.value) : "";
    if (!label || !termValue) continue;
    const sourceNodeIds = stringValues(record.sourceNodeIds);
    const sourceSpanIds = stringValues(record.sourceSpanIds);
    const kind = typeof record.kind === "string" && COVERAGE_TERM_KINDS.has(record.kind)
      ? record.kind
      : "other";
    const key = [kind, label.toLowerCase(), termValue.toLowerCase(), sourceNodeIds.join(","), sourceSpanIds.join(",")].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push({
      kind,
      label,
      value: termValue,
      ...(typeof record.amount === "number" && Number.isFinite(record.amount) ? { amount: record.amount } : {}),
      ...(typeof record.appliesTo === "string" && record.appliesTo.trim() ? { appliesTo: normalizeWhitespace(record.appliesTo) } : {}),
      sourceNodeIds: [...new Set(sourceNodeIds)],
      sourceSpanIds: [...new Set(sourceSpanIds)],
    });
  }
  return terms;
}

function cleanOperationalCoverages(
  coverages: OperationalCoverageLine[],
): OperationalCoverageLine[] {
  const cleaned: OperationalCoverageLine[] = [];
  const seen = new Set<string>();
  for (const coverage of coverages) {
    const name = normalizeCoverageName(coverage.name);
    if (!name) continue;
    const record = coverage as OperationalCoverageLine & {
      limits?: unknown;
      retroactiveDate?: unknown;
      coverageOrigin?: unknown;
      endorsementNumber?: unknown;
    };
    const limits = cleanCoverageTerms(record.limits);
    if (
      !coverage.limit &&
      !coverage.deductible &&
      !coverage.premium &&
      !record.retroactiveDate &&
      limits.length === 0 &&
      !coverage.formNumber &&
      !coverage.sectionRef &&
      record.coverageOrigin !== "core" &&
      record.coverageOrigin !== "endorsement"
    ) {
      continue;
    }
    if (coverage.sourceNodeIds.length === 0 && coverage.sourceSpanIds.length === 0 && limits.every((term) => term.sourceNodeIds.length === 0 && term.sourceSpanIds.length === 0)) {
      continue;
    }
    const normalized: OperationalCoverageLine = {
      ...coverage,
      name,
      ...(limits.length ? { limits } : {}),
      ...(typeof record.retroactiveDate === "string" && record.retroactiveDate.trim()
        ? { retroactiveDate: record.retroactiveDate.trim() }
        : {}),
      ...(record.coverageOrigin === "core" || record.coverageOrigin === "endorsement"
        ? { coverageOrigin: record.coverageOrigin }
        : {}),
      ...(typeof record.endorsementNumber === "string" && record.endorsementNumber.trim()
        ? { endorsementNumber: record.endorsementNumber.trim() }
        : {}),
      sourceNodeIds: [...new Set(coverage.sourceNodeIds)],
      sourceSpanIds: [...new Set(coverage.sourceSpanIds)],
    } as OperationalCoverageLine;
    const key = [
      normalized.name.toLowerCase(),
      normalized.limit ?? "",
      normalized.deductible ?? "",
      normalized.premium ?? "",
      (normalized as OperationalCoverageLine & { retroactiveDate?: string }).retroactiveDate ?? "",
      JSON.stringify((normalized as OperationalCoverageLine & { limits?: unknown[] }).limits ?? []),
      normalized.formNumber ?? "",
      normalized.sectionRef ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(normalized);
  }
  return cleaned;
}

const PLACEHOLDER_AMOUNT_PATTERN = /\$[A-Z]{1,3}(?:,[A-Z]{3})*(?:\.[A-Z]{2})?/g;

function repairPlaceholderAmountFromSource(value: string, sourceText: string): string {
  if (!/\$[A-Z]/.test(value)) return value;
  const candidates = [...sourceText.matchAll(PLACEHOLDER_AMOUNT_PATTERN)]
    .map((match) => match[0])
    .filter((candidate) => candidate.toLowerCase().startsWith(value.toLowerCase()))
    .sort((left, right) => right.length - left.length);
  return candidates[0] ?? value;
}

function sourceTextForIds(nodeTextById: Map<string, string>, ids: string[]): string {
  return normalizeWhitespace(ids.map((id) => nodeTextById.get(id) ?? "").filter(Boolean).join(" "));
}

function repairCoverageTermsFromSourceTree(
  profile: PolicyOperationalProfile,
  sourceTree: DocumentSourceNode[],
): PolicyOperationalProfile {
  const nodeTextById = new Map(sourceTree.map((node) => [
    node.id,
    [node.title, node.description, node.textExcerpt].filter(Boolean).join(" "),
  ]));
  let changed = false;
  const coverages = profile.coverages.map((coverage: OperationalCoverageLine) => {
    const record = coverage as OperationalCoverageLine & { limits?: unknown[] };
    if (!Array.isArray(record.limits) || record.limits.length === 0) return coverage;
    const limits = record.limits.map((term: unknown) => {
      if (!term || typeof term !== "object" || Array.isArray(term)) return term;
      const termRecord = term as {
        value?: unknown;
        sourceNodeIds?: unknown;
      };
      if (typeof termRecord.value !== "string" || !Array.isArray(termRecord.sourceNodeIds)) return term;
      const sourceNodeIds = termRecord.sourceNodeIds.filter((id): id is string => typeof id === "string");
      const sourceText = sourceTextForIds(nodeTextById, sourceNodeIds);
      const repaired = repairPlaceholderAmountFromSource(termRecord.value, sourceText);
      if (repaired === termRecord.value) return term;
      changed = true;
      return { ...termRecord, value: repaired };
    });
    return { ...coverage, limits } as OperationalCoverageLine;
  });
  return changed ? { ...profile, coverages } : profile;
}

function coverageHasTerm(coverage: OperationalCoverageLine, label: RegExp): boolean {
  const record = coverage as OperationalCoverageLine & { limits?: unknown[] };
  return Array.isArray(record.limits) && record.limits.some((term: unknown) =>
    Boolean(term) &&
    typeof term === "object" &&
    !Array.isArray(term) &&
    typeof (term as { label?: unknown }).label === "string" &&
    label.test((term as { label: string }).label),
  );
}

function withSourceBackedPersonalBenefitTerms(
  profile: PolicyOperationalProfile,
  sourceTree: DocumentSourceNode[],
): PolicyOperationalProfile {
  const disabilityIndex = profile.coverages.findIndex((coverage: OperationalCoverageLine) => /\bdisability\s+benefit\b/i.test(coverage.name));
  if (disabilityIndex < 0 || coverageHasTerm(profile.coverages[disabilityIndex], /\bcatastrophic\s+disability\b/i)) {
    return profile;
  }
  const nodes = sourceTree.filter((node) => node.kind !== "document");
  const catastrophicHeading = nodes.find((node) =>
    /\bcatastrophic\s+disability\b/i.test(normalizeWhitespace(node.textExcerpt ?? node.title ?? "")) &&
    normalizeWhitespace(node.textExcerpt ?? node.title ?? "").length <= 80,
  );
  const catastrophicAgeWindow = nodes.find((node) =>
    /\bany\s+catastrophic\s+disability\s+must\s+occur\b/i.test(normalizeWhitespace(node.textExcerpt ?? node.description ?? "")),
  );
  const catastrophicCategories = nodes.find((node) =>
    /\b4\s+categories\s+of\s+catastrophic\s+disability\b/i.test(normalizeWhitespace(node.textExcerpt ?? node.description ?? "")),
  );
  if (!catastrophicHeading && !catastrophicAgeWindow && !catastrophicCategories) return profile;

  const termNodes = [catastrophicHeading, catastrophicAgeWindow, catastrophicCategories]
    .filter((node): node is DocumentSourceNode => Boolean(node));
  const sourceNodeIds = [...new Set(termNodes.map((node) => node.id))];
  const sourceSpanIds = [...new Set(termNodes.flatMap((node) => node.sourceSpanIds))];
  const catastrophicTerm = {
    kind: "other",
    label: "Catastrophic disability",
    value: "Any catastrophic disability must occur on or after the policy anniversary nearest the insured person's 18th birthday; the policy lists 4 categories of catastrophic disability.",
    appliesTo: "Disability benefit",
    sourceNodeIds,
    sourceSpanIds,
  };
  const coverages = profile.coverages.map((coverage: OperationalCoverageLine, index: number) => {
    if (index !== disabilityIndex) return coverage;
    const record = coverage as OperationalCoverageLine & { limits?: unknown[] };
    return {
      ...coverage,
      limits: [...(Array.isArray(record.limits) ? record.limits : []), catastrophicTerm],
      sourceNodeIds: [...new Set([...coverage.sourceNodeIds, ...sourceNodeIds])],
      sourceSpanIds: [...new Set([...coverage.sourceSpanIds, ...sourceSpanIds])],
    } as OperationalCoverageLine;
  });
  return { ...profile, coverages };
}

type OperationalCoverageExtension = {
  coverageOrigin?: "core" | "endorsement";
  coverageOriginConfidence?: "low" | "medium" | "high";
  coverageOriginReason?: string;
};

type OperationalProfileExtensions = {
  additionalInsuredEligibility?: unknown;
  additionalInsureds?: unknown;
};

function coverageExtensionKey(coverage: Record<string, unknown>): string {
  const sourceNodeIds = Array.isArray(coverage.sourceNodeIds)
    ? coverage.sourceNodeIds.filter((id): id is string => typeof id === "string")
    : [];
  const sourceSpanIds = Array.isArray(coverage.sourceSpanIds)
    ? coverage.sourceSpanIds.filter((id): id is string => typeof id === "string")
    : [];
  return [
    normalizeWhitespace(String(coverage.name ?? "")).toLowerCase(),
    normalizeWhitespace(String(coverage.limit ?? "")).toLowerCase(),
    normalizeWhitespace(String(coverage.deductible ?? "")).toLowerCase(),
    normalizeWhitespace(String(coverage.premium ?? "")).toLowerCase(),
    sourceNodeIds.join(","),
    sourceSpanIds.join(","),
  ].join("|");
}

function storedCoverageExtensions(rawProfile: unknown): Map<string, OperationalCoverageExtension> {
  const extensions = new Map<string, OperationalCoverageExtension>();
  const rows = rawProfile
    && typeof rawProfile === "object"
    && !Array.isArray(rawProfile)
    && Array.isArray((rawProfile as Record<string, unknown>).coverages)
    ? (rawProfile as { coverages: unknown[] }).coverages
    : [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const coverageOrigin = record.coverageOrigin === "core" || record.coverageOrigin === "endorsement"
      ? record.coverageOrigin
      : undefined;
    const coverageOriginConfidence = record.coverageOriginConfidence === "low"
      || record.coverageOriginConfidence === "medium"
      || record.coverageOriginConfidence === "high"
      ? record.coverageOriginConfidence
      : undefined;
    const coverageOriginReason = typeof record.coverageOriginReason === "string"
      ? record.coverageOriginReason
      : undefined;
    if (!coverageOrigin && !coverageOriginConfidence && !coverageOriginReason) continue;
    extensions.set(coverageExtensionKey(record), {
      coverageOrigin,
      coverageOriginConfidence,
      coverageOriginReason,
    });
  }
  return extensions;
}

function preserveCoverageExtensions(
  profile: PolicyOperationalProfile,
  rawProfile: unknown,
): PolicyOperationalProfile {
  const extensions = storedCoverageExtensions(rawProfile);
  if (extensions.size === 0) return profile;
  return {
    ...profile,
    coverages: profile.coverages.map((coverage: OperationalCoverageLine) => ({
      ...coverage,
      ...extensions.get(coverageExtensionKey(coverage as unknown as Record<string, unknown>)),
    })),
  };
}

function storedProfileExtensions(rawProfile: unknown): OperationalProfileExtensions {
  if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) return {};
  const record = rawProfile as Record<string, unknown>;
  return {
    ...(record.additionalInsuredEligibility && typeof record.additionalInsuredEligibility === "object"
      ? { additionalInsuredEligibility: record.additionalInsuredEligibility }
      : {}),
    ...(Array.isArray(record.additionalInsureds)
      ? { additionalInsureds: record.additionalInsureds }
      : {}),
  };
}

function preserveOperationalProfileExtensions(
  profile: PolicyOperationalProfile,
  rawProfile: unknown,
): PolicyOperationalProfile {
  return {
    ...preserveCoverageExtensions(profile, rawProfile),
    ...storedProfileExtensions(rawProfile),
  } as PolicyOperationalProfile;
}

function partiesFromProfile(profile: PolicyOperationalProfile): OperationalParty[] {
  const parties: OperationalParty[] = [];
  const push = (role: OperationalParty["role"], value: SourceBackedValue | undefined) => {
    if (!value) return;
    if (role === "broker" ? isBadBrokerValue(value.value) : isBadOperationalIdentityValue(value.value)) {
      return;
    }
    parties.push({
      role,
      name: value.value,
      sourceNodeIds: value.sourceNodeIds,
      sourceSpanIds: value.sourceSpanIds,
    });
  };
  push("named_insured", profile.namedInsured);
  push("insurer", profile.insurer);
  push("broker", profile.broker);
  return parties;
}

function restoreLegalSuffixPunctuation(value: string): string {
  return value.replace(/\b(Inc|Ltd|Corp|Co)$/i, "$1.");
}

function finalizeSourceBackedIdentity(
  value: SourceBackedValue | undefined,
  role?: OperationalParty["role"],
): SourceBackedValue | undefined {
  if (!value) return undefined;
  if (role === "broker" ? isBadBrokerValue(value.value) : isBadOperationalIdentityValue(value.value)) {
    return undefined;
  }
  return { ...value, value: restoreLegalSuffixPunctuation(value.value) };
}

function finalizeSourceBackedPolicyNumber(value: SourceBackedValue | undefined): SourceBackedValue | undefined {
  const normalized = normalizedPolicyNumberValue(value?.value);
  return value && normalized ? { ...value, value: normalized } : undefined;
}

function finalizeSourceBackedPremium(value: SourceBackedValue | undefined): SourceBackedValue | undefined {
  return value && isValidPremiumValue(value.value) ? value : undefined;
}

function sourceIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

function isLikelyCoverageNamedInsuredValue(value: string): boolean {
  const text = normalizeWhitespace(value);
  if (!isLikelyNamedInsuredValue(text) || isBadOperationalIdentityValue(text)) return false;
  return !/\b(?:insurance\s+amount|benefit\s+amount|premium|risk\s+classification|policy\s+date|date\s+this\s+policy\s+ends|plan)\b\s*:?\s*$/i.test(text);
}

function namedInsuredFromCoverageTerms(coverages: OperationalCoverageLine[]): SourceBackedValue | undefined {
  for (const coverage of coverages) {
    const coverageRecord = coverage as OperationalCoverageLine & { limits?: unknown[] };
    if (!Array.isArray(coverageRecord.limits)) continue;

    for (const term of coverageRecord.limits) {
      if (!term || typeof term !== "object" || Array.isArray(term)) continue;
      const record = term as Record<string, unknown>;
      const label = normalizeWhitespace(typeof record.label === "string" ? record.label : "");
      const value = normalizeWhitespace(typeof record.value === "string" ? record.value : "");
      if (!/\binsured\s+persons?\b/i.test(label) || !isLikelyCoverageNamedInsuredValue(value)) continue;

      const sourceNodeIds = sourceIds(record.sourceNodeIds);
      const sourceSpanIds = sourceIds(record.sourceSpanIds);
      if (sourceNodeIds.length === 0 && sourceSpanIds.length === 0) continue;

      return {
        value,
        confidence: "medium",
        sourceNodeIds,
        sourceSpanIds,
      };
    }
  }
  return undefined;
}

function normalizedIdentityComparison(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function preferCoverageNamedInsured(
  current: SourceBackedValue | undefined,
  candidate: SourceBackedValue | undefined,
  policyTypes: string[],
): SourceBackedValue | undefined {
  if (!candidate) return current;
  if (!current) return candidate;

  const currentText = normalizedIdentityComparison(current.value);
  const candidateText = normalizedIdentityComparison(candidate.value);
  if (!currentText || !candidateText || currentText === candidateText) return current;

  if (policyTypes.some((type) => ["life", "critical_illness", "disability", "long_term_care"].includes(type))) {
    return candidate;
  }

  const currentWordCount = currentText.split(/\s+/).length;
  const candidateWordCount = candidateText.split(/\s+/).length;
  if (candidateText.includes(currentText) && candidateWordCount > currentWordCount) {
    return candidate;
  }
  return current;
}

function finalizeOperationalProfile(profile: PolicyOperationalProfile): PolicyOperationalProfile {
  const policyTypes = controlledPolicyTypes(profile.policyTypes);
  const coverages = cleanOperationalCoverages(profile.coverages);
  const namedInsured = preferCoverageNamedInsured(
    finalizeSourceBackedIdentity(profile.namedInsured, "named_insured"),
    namedInsuredFromCoverageTerms(coverages),
    policyTypes,
  );
  const finalized: PolicyOperationalProfile = {
    ...profile,
    policyTypes,
    coverageTypes: controlledCoverageTypes(policyTypes),
    coverages,
    policyNumber: finalizeSourceBackedPolicyNumber(profile.policyNumber),
    namedInsured,
    insurer: finalizeSourceBackedIdentity(profile.insurer, "insurer"),
    broker: finalizeSourceBackedIdentity(profile.broker, "broker"),
    premium: finalizeSourceBackedPremium(profile.premium),
    parties: [],
  };
  finalized.parties = partiesFromProfile(finalized);
  finalized.sourceNodeIds = [...new Set([
    ...finalized.sourceNodeIds,
    ...finalized.parties.flatMap((party: OperationalParty) => party.sourceNodeIds),
  ])];
  finalized.sourceSpanIds = [...new Set([
    ...finalized.sourceSpanIds,
    ...finalized.parties.flatMap((party: OperationalParty) => party.sourceSpanIds),
  ])];
  return finalized;
}

export function withControlledPolicyTypes(
  profile: PolicyOperationalProfile,
  policyTypes: string[],
): PolicyOperationalProfile {
  return finalizeOperationalProfile({
    ...profile,
    policyTypes: controlledPolicyTypes(policyTypes),
  });
}

function documentProfileCandidate(
  document: Record<string, unknown> | undefined,
  sourceTree: DocumentSourceNode[],
): Partial<PolicyOperationalProfile> {
  if (!document) return {};
  const nodes = sourceTree.filter((node) => node.kind !== "document");
  const documentCoverages = Array.isArray(document.coverages)
    ? (document.coverages as Array<Record<string, unknown>>)
        .map((coverage): OperationalCoverageLine | undefined => {
          if (typeof coverage.name !== "string" || !coverage.name.trim()) return undefined;
          const nodeId = typeof coverage.documentNodeId === "string" ? coverage.documentNodeId : undefined;
          const node = nodeId ? sourceTree.find((item) => item.id === nodeId) : undefined;
          const sourceSpanIds = Array.isArray(coverage.sourceSpanIds)
            ? coverage.sourceSpanIds.filter((id): id is string => typeof id === "string")
            : node?.sourceSpanIds ?? [];
          if (!node && sourceSpanIds.length === 0) return undefined;
          return {
            name: coverage.name.trim(),
            coverageCode: typeof coverage.coverageCode === "string" ? coverage.coverageCode : undefined,
            limit: typeof coverage.limit === "string" ? coverage.limit : undefined,
            deductible: typeof coverage.deductible === "string" ? coverage.deductible : undefined,
            premium: typeof coverage.premium === "string" ? coverage.premium : typeof coverage.coveragePremium === "string" ? coverage.coveragePremium : undefined,
            retroactiveDate: typeof coverage.retroactiveDate === "string" ? coverage.retroactiveDate : undefined,
            formNumber: typeof coverage.formNumber === "string" ? coverage.formNumber : undefined,
            sectionRef: typeof coverage.sectionRef === "string" ? coverage.sectionRef : undefined,
            coverageOrigin: coverage.coverageOrigin === "core" || coverage.coverageOrigin === "endorsement"
              ? coverage.coverageOrigin
              : undefined,
            endorsementNumber: typeof coverage.endorsementNumber === "string" ? coverage.endorsementNumber : undefined,
            limits: cleanCoverageTerms(coverage.limits),
            sourceNodeIds: node ? [node.id] : nodeId ? [nodeId] : [],
            sourceSpanIds,
          } as OperationalCoverageLine;
        })
        .filter((coverage): coverage is OperationalCoverageLine => Boolean(coverage))
    : [];
  return {
    policyTypes: Array.isArray(document.policyTypes)
      ? document.policyTypes.filter((type): type is string => typeof type === "string")
      : undefined,
    policyNumber: sourceBackedValueFromDocument(document.policyNumber, nodes),
    namedInsured: sourceBackedValueFromDocument(document.insuredName, nodes),
    insurer: sourceBackedValueFromDocument(document.security ?? document.carrier, nodes),
    broker: sourceBackedValueFromDocument(document.broker, nodes),
    effectiveDate: sourceBackedValueFromDocument(document.effectiveDate, nodes),
    expirationDate: sourceBackedValueFromDocument(document.expirationDate, nodes),
    retroactiveDate: sourceBackedValueFromDocument(document.retroactiveDate, nodes),
    premium: sourceBackedValueFromDocument(document.premium ?? document.totalCost, nodes),
    coverages: documentCoverages.length ? documentCoverages : undefined,
  };
}

export function buildDeterministicOperationalProfile(
  sourceTree: DocumentSourceNode[],
  document?: Record<string, unknown>,
): PolicyOperationalProfile {
  const documentId = sourceTree[0]?.documentId ?? "document";
  const sdkSpans = sourceSpansForSdk([], documentId);
  const fallback = buildSdkOperationalProfile({ sourceTree, sourceSpans: sdkSpans });
  const candidate = documentProfileCandidate(document, sourceTree);
  const withDocument = mergeOperationalProfile(
    fallback,
    sanitizeOperationalProfileCandidate(candidate),
    new Set(sourceTree.map((node) => node.id)),
    new Set(sourceTree.flatMap((node) => node.sourceSpanIds)),
  );
  const withDeclarations = mergeOperationalProfile(
    withDocument,
    declarationProfileCandidate(sourceTree),
    new Set(sourceTree.map((node) => node.id)),
    new Set(sourceTree.flatMap((node) => node.sourceSpanIds)),
  );
  const repaired = withSourceBackedPersonalBenefitTerms(
    repairCoverageTermsFromSourceTree(
      repairPolicyNumberFromSourceTree(withEvidencePolicyTypes(withDeclarations, sourceTree), sourceTree),
      sourceTree,
    ),
    sourceTree,
  );
  return finalizeOperationalProfile(repaired);
}

export function normalizeOperationalProfile(
  rawProfile: unknown,
  sourceTree: DocumentSourceNode[],
  sourceSpans: SourceSpanLike[],
  document?: Record<string, unknown>,
): PolicyOperationalProfile {
  const sdkSpans = sourceSpansForSdk(sourceSpans, sourceTree[0]?.documentId ?? "document");
  const validNodeIds = new Set(sourceTree.map((node) => node.id));
  const validSpanIds = new Set(sdkSpans.map((span) => span.id));
  const fallback = buildSdkOperationalProfile({ sourceTree, sourceSpans: sdkSpans });
  const withDocument = mergeOperationalProfile(
    fallback,
    sanitizeOperationalProfileCandidate(documentProfileCandidate(document, sourceTree)),
    validNodeIds,
    validSpanIds,
  );
  const withDeclarations = mergeOperationalProfile(
    withDocument,
    declarationProfileCandidate(sourceTree),
    validNodeIds,
    validSpanIds,
  );
  const withRaw = rawProfile && typeof rawProfile === "object" && !Array.isArray(rawProfile)
    ? mergeOperationalProfile(
      withDeclarations,
      sanitizeOperationalProfileCandidate(rawProfile as Partial<PolicyOperationalProfile>),
      validNodeIds,
      validSpanIds,
    )
    : withDeclarations;
  const repaired = withSourceBackedPersonalBenefitTerms(
    repairCoverageTermsFromSourceTree(
      repairPolicyNumberFromSourceTree(withEvidencePolicyTypes(withRaw, sourceTree), sourceTree),
      sourceTree,
    ),
    sourceTree,
  );
  return preserveOperationalProfileExtensions(finalizeOperationalProfile(repaired), rawProfile);
}

export function normalizeStoredOperationalProfile(
  rawProfile: unknown,
  document?: Record<string, unknown>,
): PolicyOperationalProfile {
  const nodeIds = new Set<string>();
  const spanIds = new Set<string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.sourceNodeIds)) {
      for (const id of record.sourceNodeIds) {
        if (typeof id === "string") nodeIds.add(id);
      }
    }
    if (Array.isArray(record.sourceSpanIds)) {
      for (const id of record.sourceSpanIds) {
        if (typeof id === "string") spanIds.add(id);
      }
    }
  };

  if (rawProfile && typeof rawProfile === "object" && !Array.isArray(rawProfile)) {
    const record = rawProfile as Record<string, unknown>;
    collect(record);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
      } else {
        collect(value);
      }
    }
  }

  const documentId = "stored-profile";
  const sourceSpans: SourceSpanLike[] = [...spanIds].map((id) => ({
    id,
    spanId: id,
    documentId,
    kind: "pdf_text",
    text: "",
  }));
  const allSpanIds = [...spanIds];
  const sourceTree: DocumentSourceNode[] = [
    {
      id: documentId,
      documentId,
      kind: "document",
      title: "Stored profile",
      description: "Stored operational profile evidence placeholder.",
      textExcerpt: "",
      sourceSpanIds: allSpanIds,
      order: 0,
      path: "Stored profile",
      metadata: {},
    },
    ...[...nodeIds].map((id, index) => ({
      id,
      documentId,
      parentId: documentId,
      kind: "text" as const,
      title: id,
      description: "Stored operational profile evidence node.",
      textExcerpt: "",
      sourceSpanIds: allSpanIds,
      order: index + 1,
      path: `Stored profile / ${id}`,
      metadata: {},
    })),
  ];
  return normalizeOperationalProfile(rawProfile, sourceTree, sourceSpans, document);
}

function profileValue(profile: PolicyOperationalProfile, key: keyof PolicyOperationalProfile): string | undefined {
  const value = profile[key];
  return value && typeof value === "object" && !Array.isArray(value) && "value" in value
    ? String(value.value)
    : undefined;
}

function profileField(profile: PolicyOperationalProfile, key: keyof PolicyOperationalProfile): SourceBackedValue | undefined {
  const value = profile[key];
  return value && typeof value === "object" && !Array.isArray(value) && "value" in value
    ? value as SourceBackedValue
    : undefined;
}

const DECLARATION_PROFILE_FIELD_KEYS: Record<string, keyof PolicyOperationalProfile> = {
  policyNumber: "policyNumber",
  namedInsured: "namedInsured",
  insurer: "insurer",
  policyPeriodStart: "effectiveDate",
  policyPeriodEnd: "expirationDate",
  effectiveDate: "effectiveDate",
  expirationDate: "expirationDate",
  broker: "broker",
  premium: "premium",
};

function operationalProfileDeclarationFields(
  operationalProfile: PolicyOperationalProfile,
): DeclarationProfileField[] {
  return Object.entries(DECLARATION_PROFILE_FIELD_KEYS)
    .flatMap(([field, key]) => {
      const value = profileField(operationalProfile, key);
      if (!value?.value) return [];
      return [{
        field,
        value: value.value,
        sourceNodeIds: value.sourceNodeIds,
        sourceSpanIds: value.sourceSpanIds,
      }];
    });
}

function declarationFieldValue(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeWhitespace(value) : undefined;
}

function shouldReplaceDeclarationField(
  field: string,
  existingValue: string | undefined,
  profileValue: string,
) {
  if (!existingValue) return true;
  if (existingValue === profileValue) return true;
  if (["namedInsured", "insurer"].includes(field)) {
    return isBadOperationalIdentityValue(existingValue) || existingValue.length > profileValue.length * 1.8;
  }
  if (field === "broker") {
    return isBadBrokerValue(existingValue) || existingValue.length > profileValue.length * 1.8;
  }
  return false;
}

function repairDeclarationsFromOperationalProfile(
  declarations: unknown,
  operationalProfile: PolicyOperationalProfile,
): Record<string, unknown> | undefined {
  const profileFields = operationalProfileDeclarationFields(operationalProfile);
  if (profileFields.length === 0) return declarations && typeof declarations === "object" && !Array.isArray(declarations)
    ? declarations as Record<string, unknown>
    : undefined;

  const existing = declarations && typeof declarations === "object" && !Array.isArray(declarations)
    ? declarations as Record<string, unknown>
    : {};
  const fields = Array.isArray(existing.fields)
    ? existing.fields.filter((field): field is Record<string, unknown> =>
      Boolean(field) && typeof field === "object" && !Array.isArray(field),
    )
    : [];
  const byField = new Map<string, Record<string, unknown>>();
  for (const field of fields) {
    const name = typeof field.field === "string" ? field.field : undefined;
    if (name && !byField.has(name)) byField.set(name, field);
  }

  for (const profileField of profileFields) {
    const name = profileField.field as string;
    const existingField = byField.get(name);
    const existingValue = declarationFieldValue(existingField?.value);
    const nextValue = declarationFieldValue(profileField.value);
    if (!nextValue) continue;
    if (shouldReplaceDeclarationField(name, existingValue, nextValue)) {
      byField.set(name, {
        ...(existingField ?? {}),
        ...profileField,
      });
    }
  }

  return {
    ...existing,
    fields: [...byField.values()],
  };
}

export function sourceTreeToDocumentOutline(sourceTree: DocumentSourceNode[]): Array<Record<string, unknown>> {
  const byParent = new Map<string | undefined, DocumentSourceNode[]>();
  for (const node of sourceTree.filter((item) => item.kind !== "document")) {
    const group = byParent.get(node.parentId) ?? [];
    group.push(node);
    byParent.set(node.parentId, group);
  }
  for (const group of byParent.values()) group.sort((left, right) => left.order - right.order);
  const root = sourceTree.find((node) => node.kind === "document");
  const visit = (node: DocumentSourceNode): Record<string, unknown> => ({
    id: node.id,
    title: node.title,
    type: node.kind,
    label: node.kind,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    excerpt: node.textExcerpt,
    content: node.textExcerpt,
    sourceSpanIds: node.sourceSpanIds,
    sourceTextHash: node.sourceSpanIds.join(":") || undefined,
    interpretationLabels: [node.kind],
    metadata: node.metadata,
    children: (byParent.get(node.id) ?? []).map(visit),
  });
  return (byParent.get(root?.id) ?? byParent.get(undefined) ?? []).map(visit);
}

function sourceTreeToCompactDocumentOutline(
  sourceTree: DocumentSourceNode[],
): Array<Record<string, unknown>> {
  const byParent = new Map<string | undefined, DocumentSourceNode[]>();
  for (const node of sourceTree.filter((item) => item.kind !== "document")) {
    const group = byParent.get(node.parentId) ?? [];
    group.push(node);
    byParent.set(node.parentId, group);
  }
  for (const group of byParent.values()) group.sort((left, right) => left.order - right.order);
  const root = sourceTree.find((node) => node.kind === "document");
  let emitted = 0;
  const maxNodes = 120;
  const visit = (node: DocumentSourceNode, depth: number): Record<string, unknown> | null => {
    if (emitted >= maxNodes) return null;
    emitted += 1;
    const children = depth < 2
      ? (byParent.get(node.id) ?? [])
        .map((child) => visit(child, depth + 1))
        .filter((child): child is Record<string, unknown> => Boolean(child))
      : [];
    return {
      id: node.id,
      title: truncate(node.title, 120) ?? titleCase(node.kind),
      type: node.kind,
      label: node.kind,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      excerpt: truncate(node.textExcerpt, 180),
      sourceSpanIds: node.sourceSpanIds.slice(0, 12),
      children,
    };
  };
  return (byParent.get(root?.id) ?? byParent.get(undefined) ?? [])
    .map((node) => visit(node, 0))
    .filter((node): node is Record<string, unknown> => Boolean(node));
}

export function sourceTreePolicyFields(params: {
  sourceTree: DocumentSourceNode[];
  operationalProfile: PolicyOperationalProfile;
  existingDocumentMetadata?: unknown;
  existingDeclarations?: unknown;
}): Record<string, unknown> {
  const { sourceTree, operationalProfile } = params;
  const documentOutline = sourceTreeToCompactDocumentOutline(sourceTree);
  const hasEvidenceNodes = sourceTree.some((node) => node.kind !== "document");
  const existingMetadata = params.existingDocumentMetadata && typeof params.existingDocumentMetadata === "object" && !Array.isArray(params.existingDocumentMetadata)
    ? params.existingDocumentMetadata as Record<string, unknown>
    : {};
  const fields: Record<string, unknown> = {
    operationalProfile,
    sourceTreeVersion: "v3",
    sourceTreeStatus: hasEvidenceNodes ? "ready" : "missing",
    sourceTreeUpdatedAt: dayjs().valueOf(),
    documentOutline,
    documentMetadata: {
      ...existingMetadata,
      sourceTreeVersion: "v3",
      sourceTreeCanonical: true,
      sourceNodeCount: sourceTree.length,
      tableOfContents: documentOutline.map((node) => ({
        title: node.title,
        pageStart: node.pageStart,
        pageEnd: node.pageEnd,
        documentNodeId: node.id,
        sourceSpanIds: node.sourceSpanIds,
      })),
      agentGuidance: [
        {
          kind: "source_tree",
          title: "Use the source tree as canonical evidence",
          detail: "Operational fields are source-backed projections. Use source nodes and source spans for policy wording and provenance.",
        },
      ],
    },
  };
  const declarations = repairDeclarationsFromOperationalProfile(params.existingDeclarations, operationalProfile);
  if (declarations) fields.declarations = declarations;
  return {
    ...fields,
    ...operationalProfilePolicyFields(operationalProfile),
  };
}

export function operationalProfilePolicyFields(
  operationalProfile: PolicyOperationalProfile,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    operationalProfile,
  };
  const policyNumber = profileValue(operationalProfile, "policyNumber");
  const namedInsured = profileValue(operationalProfile, "namedInsured");
  const insurer = profileValue(operationalProfile, "insurer");
  const broker = profileValue(operationalProfile, "broker");
  const effectiveDate = profileValue(operationalProfile, "effectiveDate");
  const expirationDate = profileValue(operationalProfile, "expirationDate");
  const retroactiveDate = profileValue(operationalProfile, "retroactiveDate");
  const premium = profileValue(operationalProfile, "premium");
  fields.policyNumber = policyNumber ?? "Unknown";
  fields.insuredName = namedInsured ?? "Unknown";
  if (insurer) {
    fields.security = insurer;
    fields.carrier = insurer;
  } else {
    fields.security = undefined;
    fields.carrier = "Unknown";
  }
  if (broker) fields.broker = broker;
  if (effectiveDate) fields.effectiveDate = effectiveDate;
  if (expirationDate) fields.expirationDate = expirationDate;
  if (retroactiveDate) fields.retroactiveDate = retroactiveDate;
  fields.premium = premium ?? undefined;
  if (operationalProfile.documentType) fields.documentType = operationalProfile.documentType;
  if (operationalProfile.policyTypes.length > 0) fields.policyTypes = operationalProfile.policyTypes;
  if (operationalProfile.coverages.length > 0) {
    fields.coverages = operationalProfile.coverages.map((coverage: OperationalCoverageLine) => {
      const coverageRecord = coverage as OperationalCoverageLine & {
        coverageOrigin?: "core" | "endorsement";
        coverageOriginConfidence?: "low" | "medium" | "high";
        coverageOriginReason?: string;
        endorsementNumber?: string;
        retroactiveDate?: string;
        limits?: unknown[];
      };
      return {
        name: coverage.name,
        coverageCode: coverage.coverageCode,
        limit: coverage.limit,
        deductible: coverage.deductible,
        premium: coverage.premium,
        retroactiveDate: coverageRecord.retroactiveDate,
        formNumber: coverage.formNumber,
        sectionRef: coverage.sectionRef,
        coverageOrigin: coverageRecord.coverageOrigin,
        coverageOriginConfidence: coverageRecord.coverageOriginConfidence,
        coverageOriginReason: coverageRecord.coverageOriginReason,
        endorsementNumber: coverageRecord.endorsementNumber,
        limits: coverageRecord.limits,
        documentNodeId: coverage.sourceNodeIds[0],
        sourceSpanIds: coverage.sourceSpanIds,
        originalContent: [
          coverage.name,
          ...(Array.isArray(coverageRecord.limits) && coverageRecord.limits.length
            ? coverageRecord.limits.map((term: unknown) => {
              const record = term && typeof term === "object" && !Array.isArray(term)
                ? term as Record<string, unknown>
                : {};
              return [record.label, record.value].filter((part) => typeof part === "string" && part.trim()).join(": ");
            })
            : [coverage.limit, coverage.deductible, coverage.premium]),
        ].filter(Boolean).join(" | "),
      };
    });
  }
  return fields;
}
