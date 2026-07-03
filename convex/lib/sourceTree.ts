"use node";

import {
  buildDocumentSourceTree as buildSdkDocumentSourceTree,
  normalizeDocumentSourceTreePaths,
  PolicyOperationalProfileSchema,
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
        sourceKind: span.sourceKind === "policy_pdf" || span.sourceKind === "email" || span.sourceKind === "attachment" || span.sourceKind === "manual_note"
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

function isBadOperationalIdentityValue(value: string | undefined): boolean {
  const text = normalizeWhitespace(value ?? "");
  if (!text) return true;
  if (text.length > 180) return true;
  if (/^[a-z]/.test(text)) return true;
  if (/^(owner|policy owner|applicant)\s*:/i.test(text)) return true;
  if (/\b(?:insured persons?|insurance amount|benefit amount|policy number|owner|plan|premium)\s*:/i.test(text)) return true;
  if (/\b(?:risk management|notices?\s+contact|mailing address|email:|direct:)\b/i.test(text)) return true;
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

function sourceBackedString(value: SourceBackedValue, key: string): string | undefined {
  const record = value as SourceBackedValue & Record<string, unknown>;
  const text = record[key];
  return typeof text === "string" ? normalizeWhitespace(text) : undefined;
}

function preferredIdentityText(
  value: SourceBackedValue,
  role?: OperationalParty["role"],
): string {
  const raw = normalizeWhitespace(value.value);
  const normalized = sourceBackedString(value, "normalizedValue");
  if (!normalized) return raw;
  const invalidNormalized = role === "broker"
    ? isBadBrokerValue(normalized)
    : isBadOperationalIdentityValue(normalized);
  if (invalidNormalized) return raw;

  const invalidRaw = role === "broker"
    ? isBadBrokerValue(raw)
    : isBadOperationalIdentityValue(raw);
  if (invalidRaw) return normalized;
  if (raw.toLowerCase().includes(normalized.toLowerCase())) return normalized;
  if (normalized.length < raw.length * 0.7) return normalized;
  return raw;
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

type MoneyCandidate = {
  value: string;
  amount: number;
};

const MONEY_VALUE_PATTERN = /(?:\b(?:CAD|USD)\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?|\b(?:CAD|USD)\s+\d[\d,]*(?:\.\d{1,2})?/gi;

function moneyNumberFromString(value: string | undefined): number | undefined {
  const text = normalizeWhitespace(value ?? "");
  if (!/^\$?\s*\d[\d,\s]*(?:\.\d{1,2})?$/.test(text)) return undefined;
  const amount = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function currencyPrefixFromText(value: string | undefined): string | undefined {
  const text = normalizeWhitespace(value ?? "");
  const currency = text.match(/\b(CAD|USD)\b/i)?.[1];
  return currency ? currency.toUpperCase() : undefined;
}

function formatMoneyCandidate(
  amount: number,
  currencyPrefix: string | undefined,
  hasCents: boolean,
): string {
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${currencyPrefix ? `${currencyPrefix} ` : ""}$${formatted}`;
}

function moneyCandidateFromText(
  value: string,
  fallbackCurrencyPrefix?: string,
): MoneyCandidate | undefined {
  const amount = moneyNumberFromString(value.replace(/\b(?:CAD|USD)\b/gi, ""));
  if (amount === undefined) return undefined;
  const hasCents = /\.\d{1,2}\b/.test(value);
  const currencyPrefix = currencyPrefixFromText(value) ?? fallbackCurrencyPrefix;
  return {
    value: formatMoneyCandidate(amount, currencyPrefix, hasCents),
    amount,
  };
}

function moneyCandidatesFromText(value: string): MoneyCandidate[] {
  const text = normalizeWhitespace(value);
  const fallbackCurrencyPrefix = currencyPrefixFromText(text);
  return [...text.matchAll(MONEY_VALUE_PATTERN)]
    .map((match) => moneyCandidateFromText(match[0] ?? "", fallbackCurrencyPrefix))
    .filter((candidate): candidate is MoneyCandidate => Boolean(candidate));
}

function isPremiumLabelPart(value: string): boolean {
  return /\bpremium\b/i.test(value) &&
    !/\b(?:total\s+(?:due|payable|cost)|fees?|tax(?:es)?)\b/i.test(value);
}

function premiumCandidateFromLabeledParts(parts: string[]): MoneyCandidate | undefined {
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (!isPremiumLabelPart(part)) continue;
    const nextPart = parts[index + 1];
    const nextCandidate = nextPart && !/\b(?:premium|total\s+(?:due|payable|cost)|fees?|tax(?:es)?)\b/i.test(nextPart)
      ? moneyCandidatesFromText(nextPart)[0]
      : undefined;
    const candidate = moneyCandidatesFromText(part)[0] ?? nextCandidate;
    if (candidate) return candidate;
  }
  return undefined;
}

function preferredPremiumMoneyCandidate(value: SourceBackedValue): MoneyCandidate | undefined {
  const text = normalizeWhitespace(value.value);
  const labeledParts = text.split(/\s*[;|]\s*/).filter(Boolean);
  const partCandidate = premiumCandidateFromLabeledParts(labeledParts);
  if (partCandidate) return partCandidate;

  const normalizedAmount = moneyNumberFromString(sourceBackedString(value, "normalizedValue"));
  if (normalizedAmount !== undefined) {
    const normalizedValue = sourceBackedString(value, "normalizedValue") ?? "";
    const hasCents = /\.\d{1,2}\b/.test(normalizedValue);
    return {
      value: formatMoneyCandidate(normalizedAmount, currencyPrefixFromText(text), hasCents),
      amount: normalizedAmount,
    };
  }

  const candidates = moneyCandidatesFromText(text);
  return candidates[0];
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
  const premiumCandidate = clean.premium && typeof clean.premium === "object" && !Array.isArray(clean.premium)
    ? preferredPremiumMoneyCandidate(clean.premium as SourceBackedValue)
    : undefined;
  if (premiumCandidate && clean.premium) {
    clean.premium = {
      ...(clean.premium as SourceBackedValue),
      value: premiumCandidate.value,
      normalizedValue: String(premiumCandidate.amount),
    };
  } else if (premium && !isValidPremiumValue(premium)) {
    delete clean.premium;
  }
  for (const key of ["namedInsured", "insurer", "broker"] as const) {
    const sourceValue = valueOfSourceBackedValue(clean[key])
      ? clean[key] as SourceBackedValue
      : undefined;
    const value = sourceValue ? preferredIdentityText(sourceValue, key === "broker" ? "broker" : undefined) : undefined;
    const invalid = key === "broker"
      ? isBadBrokerValue(value)
      : isBadOperationalIdentityValue(value);
    if (invalid) {
      delete clean[key];
    } else if (sourceValue && value && value !== sourceValue.value) {
      clean[key] = { ...sourceValue, value };
    }
  }
  return clean;
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

function hasSpecificPolicyType(types: string[]): boolean {
  return types.some((type) => type !== "other");
}

function resolvePolicyTypes(
  profileTypes: unknown,
  existingTypes: unknown,
): { policyTypes: string[]; carriedForward: boolean } {
  const controlled = controlledPolicyTypes(profileTypes);
  if (hasSpecificPolicyType(controlled)) {
    return { policyTypes: controlled, carriedForward: false };
  }
  const existingControlled = controlledPolicyTypes(existingTypes);
  if (hasSpecificPolicyType(existingControlled)) {
    return { policyTypes: existingControlled, carriedForward: true };
  }
  return { policyTypes: controlled, carriedForward: false };
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

function cleanCoverageScalar(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = normalizeWhitespace(value).replace(/\s+\/$/g, "");
  return text || undefined;
}

function hasMonetaryCoverageValue(value: string | undefined): boolean {
  const text = normalizeWhitespace(value ?? "");
  return /\$|(?:\b(?:USD|CAD)\b)|(?:\b\d+(?:,\d{3})*(?:\.\d+)?\s*%)/i.test(text);
}

function isUnusableCoverageName(name: string): boolean {
  return /^(?:coverage\s+part\s+[A-Z]\)?|aggregate|claim|proceeding|each\s+(?:claim|loss|occurrence))$/i.test(name)
    || /^\$[\d,.]+\s+policy$/i.test(name);
}

function isCoverageNameEcho(value: string | undefined, coverageName: string): boolean {
  if (!value || hasMonetaryCoverageValue(value)) return false;
  const normalized = normalizeCoverageName(value);
  return Boolean(normalized && normalized.toLowerCase() === coverageName.toLowerCase());
}

function preferredCoverageLimit(
  currentLimit: string | undefined,
  coverageName: string,
  limits: Array<{ label: string; value: string }>,
): string | undefined {
  if (currentLimit && !isCoverageNameEcho(currentLimit, coverageName)) return currentLimit;
  return limits.find((term) =>
    hasMonetaryCoverageValue(term.value) &&
    !/\b(?:deductible|retention|premium)\b/i.test(term.label)
  )?.value;
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
    const termValue = cleanCoverageScalar(record.value) ?? "";
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
    if (!name || isUnusableCoverageName(name)) continue;
    const record = coverage as OperationalCoverageLine & {
      limits?: unknown;
      retroactiveDate?: unknown;
      endorsementNumber?: unknown;
    };
    const limits = cleanCoverageTerms(record.limits)
      .filter((term) => !isCoverageNameEcho(term.value, name));
    const limit = preferredCoverageLimit(cleanCoverageScalar(coverage.limit), name, limits);
    const deductible = cleanCoverageScalar(coverage.deductible);
    const premium = cleanCoverageScalar(coverage.premium);
    if (
      !limit &&
      !deductible &&
      !premium &&
      !record.retroactiveDate &&
      limits.length === 0 &&
      !coverage.formNumber &&
      !coverage.sectionRef
    ) {
      continue;
    }
    const coverageBase = { ...coverage } as OperationalCoverageLine & { limits?: unknown };
    delete coverageBase.limit;
    delete coverageBase.deductible;
    delete coverageBase.premium;
    delete coverageBase.limits;
    const normalized: OperationalCoverageLine = {
      ...coverageBase,
      name,
      ...(limit ? { limit } : {}),
      ...(deductible ? { deductible } : {}),
      ...(premium ? { premium } : {}),
      ...(limits.length ? { limits } : {}),
      ...(typeof record.retroactiveDate === "string" && record.retroactiveDate.trim()
        ? { retroactiveDate: record.retroactiveDate.trim() }
        : {}),
      ...(typeof record.endorsementNumber === "string" && record.endorsementNumber.trim()
        ? { endorsementNumber: record.endorsementNumber.trim() }
        : {}),
      sourceNodeIds: [...new Set(coverage.sourceNodeIds)],
      sourceSpanIds: [...new Set(coverage.sourceSpanIds)],
    } as OperationalCoverageLine;
    const key = [
      normalized.name.toLowerCase(),
      limit ?? "",
      deductible ?? "",
      premium ?? "",
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

type OperationalProfileExtensions = {
  additionalInsuredEligibility?: unknown;
  additionalInsureds?: unknown;
};

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
    ...profile,
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
  const identityValue = preferredIdentityText(value, role);
  if (role === "broker" ? isBadBrokerValue(identityValue) : isBadOperationalIdentityValue(identityValue)) {
    return undefined;
  }
  return { ...value, value: restoreLegalSuffixPunctuation(identityValue) };
}

function finalizeSourceBackedPolicyNumber(value: SourceBackedValue | undefined): SourceBackedValue | undefined {
  const normalized = normalizedPolicyNumberValue(value?.value);
  return value && normalized ? { ...value, value: normalized } : undefined;
}

function finalizeSourceBackedPremium(value: SourceBackedValue | undefined): SourceBackedValue | undefined {
  if (!value) return undefined;
  const premiumCandidate = preferredPremiumMoneyCandidate(value);
  if (!premiumCandidate) return isValidPremiumValue(value.value) ? value : undefined;
  return {
    ...value,
    value: premiumCandidate.value,
    normalizedValue: String(premiumCandidate.amount),
  };
}

function finalizeOperationalProfile(profile: PolicyOperationalProfile): PolicyOperationalProfile {
  const policyTypes = controlledPolicyTypes(profile.policyTypes);
  const coverages = cleanOperationalCoverages(profile.coverages);
  const finalized: PolicyOperationalProfile = {
    ...profile,
    policyTypes,
    coverages,
    policyNumber: finalizeSourceBackedPolicyNumber(profile.policyNumber),
    namedInsured: finalizeSourceBackedIdentity(profile.namedInsured, "named_insured"),
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

function emptyOperationalProfile(): PolicyOperationalProfile {
  return PolicyOperationalProfileSchema.parse({
    documentType: "policy",
    policyTypes: ["other"],
    coverages: [],
    parties: [],
    endorsementSupport: [],
    sourceNodeIds: [],
    sourceSpanIds: [],
    warnings: [],
  });
}

function validSourceIds(value: unknown, validIds: Set<string>): string[] {
  return [...new Set(stringValues(value).filter((id) => validIds.has(id)))];
}

function normalizeRawSourceBackedValue(
  value: unknown,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): SourceBackedValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const text = cleanCoverageScalar(record.value);
  const sourceNodeIds = validSourceIds(record.sourceNodeIds, validNodeIds);
  const sourceSpanIds = validSourceIds(record.sourceSpanIds, validSpanIds);
  if (!text) return undefined;
  const hasSource = sourceNodeIds.length > 0 || sourceSpanIds.length > 0;
  const confidence = record.confidence === "low" || record.confidence === "medium" || record.confidence === "high"
    ? record.confidence
    : undefined;
  return {
    value: text,
    ...(typeof record.normalizedValue === "string" && record.normalizedValue.trim()
      ? { normalizedValue: normalizeWhitespace(record.normalizedValue) }
      : {}),
    ...(hasSource
      ? confidence ? { confidence } : {}
      : { confidence: "low" as const }),
    sourceNodeIds,
    sourceSpanIds,
  };
}

function normalizeRawCoverageTerm(
  value: unknown,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): NonNullable<OperationalCoverageLine["limits"]>[number] | undefined {
  const [term] = cleanCoverageTerms([value]);
  if (!term) return undefined;
  const sourceNodeIds = validSourceIds(term.sourceNodeIds, validNodeIds);
  const sourceSpanIds = validSourceIds(term.sourceSpanIds, validSpanIds);
  return {
    ...term,
    sourceNodeIds,
    sourceSpanIds,
  };
}

function normalizeRawCoverage(
  value: unknown,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): OperationalCoverageLine | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const name = cleanCoverageScalar(record.name);
  if (!name) return undefined;
  const limits = Array.isArray(record.limits)
    ? record.limits
        .map((term) => normalizeRawCoverageTerm(term, validNodeIds, validSpanIds))
        .filter((term): term is NonNullable<OperationalCoverageLine["limits"]>[number] => Boolean(term))
    : [];
  const sourceNodeIds = validSourceIds([
    ...stringValues(record.sourceNodeIds),
    ...limits.flatMap((term) => term.sourceNodeIds),
  ], validNodeIds);
  const sourceSpanIds = validSourceIds([
    ...stringValues(record.sourceSpanIds),
    ...limits.flatMap((term) => term.sourceSpanIds),
  ], validSpanIds);
  return {
    name,
    ...(cleanCoverageScalar(record.coverageCode) ? { coverageCode: cleanCoverageScalar(record.coverageCode) } : {}),
    ...(cleanCoverageScalar(record.limit) ? { limit: cleanCoverageScalar(record.limit) } : {}),
    ...(cleanCoverageScalar(record.deductible) ? { deductible: cleanCoverageScalar(record.deductible) } : {}),
    ...(cleanCoverageScalar(record.premium) ? { premium: cleanCoverageScalar(record.premium) } : {}),
    ...(cleanCoverageScalar(record.retroactiveDate) ? { retroactiveDate: cleanCoverageScalar(record.retroactiveDate) } : {}),
    ...(cleanCoverageScalar(record.formNumber) ? { formNumber: cleanCoverageScalar(record.formNumber) } : {}),
    ...(cleanCoverageScalar(record.sectionRef) ? { sectionRef: cleanCoverageScalar(record.sectionRef) } : {}),
    ...(cleanCoverageScalar(record.endorsementNumber) ? { endorsementNumber: cleanCoverageScalar(record.endorsementNumber) } : {}),
    limits,
    sourceNodeIds,
    sourceSpanIds,
  };
}

function normalizeRawEndorsementSupport(
  value: unknown,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): PolicyOperationalProfile["endorsementSupport"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const kind = cleanCoverageScalar(record.kind);
    const summary = cleanCoverageScalar(record.summary);
    const sourceNodeIds = validSourceIds(record.sourceNodeIds, validNodeIds);
    const sourceSpanIds = validSourceIds(record.sourceSpanIds, validSpanIds);
    const status = record.status === "supported" || record.status === "excluded" || record.status === "requires_review"
      ? record.status
      : undefined;
    if (!kind || !summary || !status || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return [];
    return [{ kind, status, summary, sourceNodeIds, sourceSpanIds }];
  });
}

function normalizeRawOperationalProfile(
  rawProfile: unknown,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): PolicyOperationalProfile {
  if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
    return emptyOperationalProfile();
  }
  const candidate = sanitizeOperationalProfileCandidate(rawProfile as Partial<PolicyOperationalProfile>);
  const candidateCoverages: unknown[] = Array.isArray(candidate.coverages)
    ? candidate.coverages
    : [];
  const coverages = candidateCoverages.length > 0
    ? candidateCoverages
        .map((coverage) => normalizeRawCoverage(coverage, validNodeIds, validSpanIds))
        .filter((coverage): coverage is OperationalCoverageLine => Boolean(coverage))
    : [];
  const values = [
    candidate.policyNumber,
    candidate.namedInsured,
    candidate.insurer,
    candidate.broker,
    candidate.effectiveDate,
    candidate.expirationDate,
    candidate.retroactiveDate,
    candidate.premium,
  ].map((value) => normalizeRawSourceBackedValue(value, validNodeIds, validSpanIds));
  const sourceNodeIds = [...new Set([
    ...values.flatMap((value) => value?.sourceNodeIds ?? []),
    ...coverages.flatMap((coverage) => coverage.sourceNodeIds),
  ])];
  const sourceSpanIds = [...new Set([
    ...values.flatMap((value) => value?.sourceSpanIds ?? []),
    ...coverages.flatMap((coverage) => coverage.sourceSpanIds),
  ])];
  return PolicyOperationalProfileSchema.parse({
    documentType: candidate.documentType === "quote" ? "quote" : "policy",
    policyTypes: controlledPolicyTypes(candidate.policyTypes),
    policyNumber: values[0],
    namedInsured: values[1],
    insurer: values[2],
    broker: values[3],
    effectiveDate: values[4],
    expirationDate: values[5],
    retroactiveDate: values[6],
    premium: values[7],
    coverages,
    parties: [],
    endorsementSupport: normalizeRawEndorsementSupport(
      (candidate as { endorsementSupport?: unknown }).endorsementSupport,
      validNodeIds,
      validSpanIds,
    ),
    sourceNodeIds,
    sourceSpanIds,
    warnings: Array.isArray(candidate.warnings)
      ? (candidate.warnings as unknown[]).filter((warning): warning is string => typeof warning === "string")
      : [],
  });
}

export function normalizeOperationalProfile(
  rawProfile: unknown,
  sourceTree: DocumentSourceNode[],
  sourceSpans: SourceSpanLike[],
): PolicyOperationalProfile {
  const sdkSpans = sourceSpansForSdk(sourceSpans, sourceTree[0]?.documentId ?? "document");
  const validNodeIds = new Set(sourceTree.map((node) => node.id));
  const validSpanIds = new Set(sdkSpans.map((span) => span.id));
  const normalized = normalizeRawOperationalProfile(rawProfile, validNodeIds, validSpanIds);
  return preserveOperationalProfileExtensions(
    finalizeOperationalProfile(normalized),
    rawProfile,
  );
}

export function normalizeStoredOperationalProfile(
  rawProfile: unknown,
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
  return normalizeOperationalProfile(rawProfile, sourceTree, sourceSpans);
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
  existingPolicyTypes?: unknown;
}): Record<string, unknown> {
  const { sourceTree } = params;
  const resolvedTypes = resolvePolicyTypes(params.operationalProfile.policyTypes, params.existingPolicyTypes);
  const carriedPolicyTypesWarning = "Policy types carried forward from preliminary classification because final extraction returned only other.";
  const operationalProfile: PolicyOperationalProfile = resolvedTypes.carriedForward
    ? {
        ...params.operationalProfile,
        policyTypes: resolvedTypes.policyTypes,
        warnings: params.operationalProfile.warnings.includes(carriedPolicyTypesWarning)
          ? params.operationalProfile.warnings
          : [...params.operationalProfile.warnings, carriedPolicyTypesWarning],
      }
    : params.operationalProfile;
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
  const premiumField = profileField(operationalProfile, "premium");
  const premium = premiumField?.value;
  const premiumNormalizedValue = premiumField
    ? sourceBackedString(premiumField, "normalizedValue")
    : undefined;
  const premiumAmount = moneyNumberFromString(premiumNormalizedValue)
    ?? moneyNumberFromString(premium);
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
  if (premiumAmount !== undefined) fields.premiumAmount = premiumAmount;
  if (operationalProfile.documentType) fields.documentType = operationalProfile.documentType;
  if (operationalProfile.policyTypes.length > 0) fields.policyTypes = operationalProfile.policyTypes;
  const summary = [
    insurer && insurer !== "Unknown" ? insurer : undefined,
    policyNumber && policyNumber !== "Unknown" ? `policy #${policyNumber}` : "policy",
    namedInsured && namedInsured !== "Unknown" ? `for ${namedInsured}` : undefined,
    operationalProfile.policyTypes.length > 0 ? `covering ${operationalProfile.policyTypes.slice(0, 5).join(", ")}` : undefined,
  ].filter(Boolean).join(" ");
  if (summary) fields.summary = summary;
  if (operationalProfile.coverages.length > 0) {
    fields.coverages = operationalProfile.coverages.map((coverage: OperationalCoverageLine) => {
      const coverageRecord = coverage as OperationalCoverageLine & {
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
