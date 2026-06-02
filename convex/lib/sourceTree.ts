"use node";

import {
  buildDeterministicOperationalProfile as buildSdkOperationalProfile,
  buildDocumentSourceTree,
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
  return value.replace(/\s+/g, " ").trim();
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

function sourceNodeGroupId(documentId: string, kind: string, pageStart: number | undefined, pageEnd: number | undefined, title: string) {
  return [
    documentId.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    "source_node",
    kind,
    stableHash(`${pageStart ?? "na"}|${pageEnd ?? "na"}|${title}`).slice(0, 12),
  ].join(":");
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
    .map((span) => {
      const id = spanId(span);
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
  return buildDocumentSourceTree(sourceSpansForSdk(sourceSpans, resolvedDocumentId), resolvedDocumentId);
}

type InferredSourcePage = {
  title?: string;
  kind?: DocumentSourceNodeKind;
  formNumber?: string;
  startsGroup: boolean;
};

function cleanPolicyPageText(value: string | undefined) {
  return normalizeWhitespace(value ?? "")
    .replace(/^SPECIMEN POLICY\s+—\s+FOR TESTING ONLY\s+/i, "")
    .replace(/^NORTHWOODS CONTINENTAL INSURANCE COMPANY\s+/i, "");
}

function cleanSourceTitle(value: string | undefined) {
  const text = normalizeWhitespace(value ?? "")
    .replace(/\s+This endorsement\b.*$/i, "")
    .replace(/\s+This Endorsement\b.*$/i, "")
    .replace(/\s+SCHEDULE\b.*$/i, "")
    .replace(/\s+[A-Z]\.\s+.*$/i, "")
    .replace(/[.;:\s]+$/g, "");
  return /[A-Z]/.test(text) && text === text.toUpperCase()
    ? titleCase(text.toLowerCase())
    : text;
}

function inferFormNumber(text: string) {
  return text.match(/\b(NWC-[A-Z]{2,}(?:\s+[A-Z]{2})?(?:\s+\d{3})?\s+\d{2}\s+\d{2})\b/i)?.[1]
    ?.replace(/\s+/g, " ")
    .toUpperCase();
}

function inferSourcePage(node: DocumentSourceNode): InferredSourcePage {
  const text = cleanPolicyPageText(node.textExcerpt ?? node.description);
  const headingText = text.slice(0, 900);
  const formNumber = inferFormNumber(text);
  const endorsement = headingText.match(/\bENDORSEMENT\s+NO\.?\s+([A-Z0-9 ]+)\s+[—-]\s+(.+?)(?=\s+This endorsement|\s+This Endorsement|\s+SCHEDULE|\s+[A-Z]\.\s+|$)/i);
  if (endorsement) {
    return {
      title: `Endorsement No. ${cleanSourceTitle(endorsement[1])} - ${cleanSourceTitle(endorsement[2])}`,
      kind: "endorsement",
      formNumber,
      startsGroup: true,
    };
  }

  const mainPolicy = headingText.match(/\b(TECHNOLOGY ERRORS\s*&\s*OMISSIONS AND CYBER LIABILITY INSURANCE POLICY)\s+Form\s+NWC-TEC\b/i);
  if (mainPolicy) {
    return {
      title: titleCase(mainPolicy[1].toLowerCase()),
      kind: "form",
      formNumber,
      startsGroup: true,
    };
  }

  if (/\bINSURANCE POLICY\b.*\bIn consideration of the payment of the premium\b/i.test(headingText)) {
    return {
      title: "Policy Cover / Insurance Policy Agreement",
      kind: "form",
      formNumber,
      startsGroup: true,
    };
  }
  if (/\bHOW TO REPORT A CLAIM\b/i.test(headingText)) {
    return {
      title: "Claims-Made Reporting Instructions",
      kind: "form",
      formNumber,
      startsGroup: true,
    };
  }
  if (/\bPrivacy Notice\b|\bPIPEDA\b/i.test(headingText)) {
    return {
      title: "Privacy and Regulatory Notices",
      kind: "form",
      formNumber,
      startsGroup: true,
    };
  }
  if (/\bFederal Terrorism Coverage Disclosure\b/i.test(headingText)) {
    return {
      title: "Federal Terrorism Coverage Disclosure",
      kind: "form",
      formNumber,
      startsGroup: true,
    };
  }
  if (/\bDECLARATIONS\b.*\bCoverage Parts and Limits\b|\bItem\s+1\.\s+Named Insured\b/i.test(headingText)) {
    return {
      title: "Declarations (Specimen) - Coverage Parts and Limits",
      kind: "schedule",
      formNumber,
      startsGroup: true,
    };
  }

  const sanctions = headingText.match(/\b(Trade or Economic Sanctions Limitation)\b/i);
  if (sanctions) {
    return {
      title: cleanSourceTitle(sanctions[1]),
      kind: "form",
      formNumber,
      startsGroup: true,
    };
  }

  if (/\bBilateral Discovery Period\b|\bExtended Reporting Period\b/i.test(text)) {
    return {
      title: "Extended Reporting Period Options",
      kind: "schedule",
      formNumber,
      startsGroup: true,
    };
  }

  return { formNumber, startsGroup: false };
}

function relabelSourcePage(node: DocumentSourceNode, inferred: InferredSourcePage): DocumentSourceNode {
  if (!inferred.title) return node;
  return {
    ...node,
    kind: inferred.kind ?? node.kind,
    title: inferred.title,
    description: nodeDescription({
      kind: inferred.kind ?? node.kind,
      title: inferred.title,
      text: node.textExcerpt,
      page: node.pageStart,
    }),
    metadata: {
      ...node.metadata,
      ...(inferred.formNumber ? { formNumber: inferred.formNumber } : {}),
      organizer: "deterministic_form_grouping",
    },
  };
}

function topLevelRootId(nodes: DocumentSourceNode[]) {
  return nodes.find((node) => node.kind === "document")?.id;
}

function applyDeterministicFormGrouping(nodes: DocumentSourceNode[]): DocumentSourceNode[] {
  const rootId = topLevelRootId(nodes);
  if (!rootId) return nodes;
  const topLevel = nodes
    .filter((node) => node.parentId === rootId)
    .sort((left, right) => left.order - right.order);
  const pageIds = new Set(topLevel.filter((node) => node.kind === "page").map((node) => node.id));
  if (pageIds.size === 0) return nodes;

  const replacements = new Map<string, DocumentSourceNode>();
  const groups: DocumentSourceNode[] = [];
  const pageRuns: DocumentSourceNode[][] = [];
  let currentRun: DocumentSourceNode[] = [];

  for (const node of topLevel) {
    if (!pageIds.has(node.id)) {
      if (currentRun.length) pageRuns.push(currentRun);
      currentRun = [];
      continue;
    }
    const inferred = inferSourcePage(node);
    if (inferred.startsGroup && currentRun.length) {
      pageRuns.push(currentRun);
      currentRun = [];
    }
    currentRun.push(node);
  }
  if (currentRun.length) pageRuns.push(currentRun);

  for (const run of pageRuns) {
    const first = run[0];
    const firstInferred = inferSourcePage(first);
    if (run.length === 1) {
      replacements.set(first.id, relabelSourcePage(first, firstInferred));
      continue;
    }
    if (!firstInferred.title) {
      for (const node of run) {
        replacements.set(node.id, relabelSourcePage(node, inferSourcePage(node)));
      }
      continue;
    }
    const title = firstInferred.title;
    const kind = firstInferred.kind ?? "page_group";
    const pageStarts = run.map((node) => node.pageStart).filter((page): page is number => typeof page === "number");
    const pageEnds = run.map((node) => node.pageEnd ?? node.pageStart).filter((page): page is number => typeof page === "number");
    const pageStart = pageStarts.length ? Math.min(...pageStarts) : undefined;
    const pageEnd = pageEnds.length ? Math.max(...pageEnds) : undefined;
    const id = sourceNodeGroupId(first.documentId, kind, pageStart, pageEnd, title);
    const sourceSpanIds = [...new Set(run.flatMap((node) => node.sourceSpanIds))].slice(0, 80);
    const group: DocumentSourceNode = {
      id,
      documentId: first.documentId,
      parentId: rootId,
      kind,
      title,
      description: nodeDescription({ kind, title, page: pageStart }),
      textExcerpt: undefined,
      sourceSpanIds,
      pageStart,
      pageEnd,
      bbox: run.flatMap((node) => node.bbox ?? []).slice(0, 12),
      order: first.order,
      path: "",
      metadata: {
        sourceTreeVersion: "v3",
        organizer: "deterministic_form_grouping",
        ...(firstInferred.formNumber ? { formNumber: firstInferred.formNumber } : {}),
      },
    };
    groups.push(group);
    for (const node of run) {
      const inferred = inferSourcePage(node);
      replacements.set(node.id, {
        ...relabelSourcePage(node, inferred),
        parentId: id,
        order: node.order + 0.001,
      });
    }
  }

  return [
    ...nodes.map((node) => replacements.get(node.id) ?? node),
    ...groups,
  ];
}

export function normalizeSourceTree(
  rawNodes: unknown,
  sourceSpans: SourceSpanLike[],
  documentId: string,
): DocumentSourceNode[] {
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return normalizeDocumentSourceTreePaths(
      applyDeterministicFormGrouping(buildSourceTreeFromSpans(sourceSpans, documentId)),
    );
  }
  const validSpanIds = new Set(sourceSpans.map(spanId));
  const nodes = rawNodes
    .map((node, index): DocumentSourceNode | undefined => {
      if (!node || typeof node !== "object") return undefined;
      const record = node as Record<string, unknown>;
      const kind = typeof record.kind === "string" && SOURCE_NODE_KINDS.has(record.kind as DocumentSourceNodeKind)
        ? record.kind as DocumentSourceNodeKind
        : "text";
      const id = typeof record.id === "string" && record.id.length > 0
        ? record.id
        : nodeId(documentId, kind, index);
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
      return {
        id,
        documentId: typeof record.documentId === "string" ? record.documentId : documentId,
        parentId: typeof record.parentId === "string" ? record.parentId : undefined,
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
  return normalizeDocumentSourceTreePaths(
    nodes.length ? nodes : applyDeterministicFormGrouping(buildSourceTreeFromSpans(sourceSpans, documentId)),
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
  return /(__{3,}|claims-made|please read|all monetary amounts|page\s+\d+\s+of\s+\d+|in consideration of the payment|subject to the declarations|policy title|signature blocks?|errors?\s+and\s+omissions\s+liability\s+policy)/i.test(text);
}

function isLikelyNamedInsuredValue(value: string): boolean {
  const text = normalizeWhitespace(value);
  if (!text || text.length > 140) return false;
  if (/^(holds|is|are|has|have|with|including|through|provides|administers|licensed|federally)\b/i.test(text)) return false;
  if (/\b(policy|coverage|deductible|premium|claim|limit|retroactive|endorsement)\b/i.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function valueOfSourceBackedValue(value: unknown): string | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && "value" in value && typeof value.value === "string"
    ? value.value
    : undefined;
}

function sanitizeOperationalProfileCandidate(
  candidate: Partial<PolicyOperationalProfile>,
): Partial<PolicyOperationalProfile> {
  const clean = { ...candidate };
  for (const key of ["namedInsured", "insurer", "broker"] as const) {
    if (isBadOperationalIdentityValue(valueOfSourceBackedValue(clean[key]))) {
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

  const brokerNode = nodes.find((node) => /\bItem\s*12\.\s*Broker of Record\b/i.test(node.textExcerpt ?? ""));
  const broker = brokerNode?.textExcerpt?.match(/\bItem\s*12\.\s*Broker of Record\s+(.+?)(?=\s+Item\s*13\.|\s+SLS-[A-Z]|\s+This Policy\b|\s+Countersigned\b|$)/i)?.[1];
  if (brokerNode && broker) {
    candidate.broker = sourceBackedValueFromNode(brokerNode, broker.replace(/\s+RIBO Registration\b.*$/i, ""));
  }

  return candidate;
}

function controlledPolicyTypes(values: unknown): string[] {
  const types = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
  const controlled = types
    .map((type) => type.trim().toLowerCase())
    .filter((type) => POLICY_TYPE_KEYS.has(type));
  const unique = [...new Set(controlled)].slice(0, 6);
  return unique.length ? unique : ["other"];
}

function controlledCoverageTypes(policyTypes: string[]): string[] {
  return policyTypes.map((type) => POLICY_TYPE_LABELS[type] ?? type);
}

function cleanCoverageName(value: string | undefined): string | undefined {
  const text = normalizeWhitespace(value ?? "");
  if (!text) return undefined;
  const columnMatch = text.match(/\bColumn\s+1:\s*([\s\S]*?)(?=\s+\|\s+Column\s+\d+:|\s+Column\s+\d+:|$)/i);
  const candidate = normalizeWhitespace(columnMatch?.[1] ?? text)
    .replace(/^coverage\s*:?\s*/i, "")
    .replace(/\s*\([^)]*$/g, "")
    .replace(/\b(?:table row|text)\s*$/i, "")
    .replace(/^[\s:;#-]+|[\s;,.\\/]+$/g, "");
  if (!candidate) return undefined;
  if (/^(row\s+\d+|table\s+row|text|column\s+\d+)\b/i.test(candidate)) return undefined;
  if (/^(?:table|row|text)\s+(?:table|row|text)$/i.test(candidate)) return undefined;
  if (/\b(?:erodes?|settlements?|parts?\s+combined|subject\s+to|provided\s+that)\b/i.test(candidate)) return undefined;
  if (/\b(?:under|of|and|or|for|to|with|which|that)$/i.test(candidate)) return undefined;
  if (!/[A-Za-z]/.test(candidate)) return undefined;
  return candidate;
}

function cleanOperationalCoverages(coverages: OperationalCoverageLine[]): OperationalCoverageLine[] {
  const cleaned: OperationalCoverageLine[] = [];
  const seen = new Set<string>();
  for (const coverage of coverages) {
    const name = cleanCoverageName(coverage.name);
    if (!name) continue;
    if (!coverage.limit && !coverage.deductible && !coverage.premium) continue;
    if (coverage.sourceNodeIds.length === 0 && coverage.sourceSpanIds.length === 0) continue;
    const normalized: OperationalCoverageLine = {
      ...coverage,
      name,
      sourceNodeIds: [...new Set(coverage.sourceNodeIds)],
      sourceSpanIds: [...new Set(coverage.sourceSpanIds)],
    };
    const key = [
      normalized.name.toLowerCase(),
      normalized.limit ?? "",
      normalized.deductible ?? "",
      normalized.premium ?? "",
      normalized.formNumber ?? "",
      normalized.sectionRef ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(normalized);
  }
  return cleaned;
}

function partiesFromProfile(profile: PolicyOperationalProfile): OperationalParty[] {
  const parties: OperationalParty[] = [];
  const push = (role: OperationalParty["role"], value: SourceBackedValue | undefined) => {
    if (!value || isBadOperationalIdentityValue(value.value)) return;
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

function finalizeSourceBackedIdentity(value: SourceBackedValue | undefined): SourceBackedValue | undefined {
  if (!value || isBadOperationalIdentityValue(value.value)) return undefined;
  return { ...value, value: restoreLegalSuffixPunctuation(value.value) };
}

function finalizeOperationalProfile(profile: PolicyOperationalProfile): PolicyOperationalProfile {
  const policyTypes = controlledPolicyTypes(profile.policyTypes);
  const coverages = cleanOperationalCoverages(profile.coverages);
  const finalized: PolicyOperationalProfile = {
    ...profile,
    policyTypes,
    coverageTypes: controlledCoverageTypes(policyTypes),
    coverages,
    namedInsured: finalizeSourceBackedIdentity(profile.namedInsured),
    insurer: finalizeSourceBackedIdentity(profile.insurer),
    broker: finalizeSourceBackedIdentity(profile.broker),
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
            formNumber: typeof coverage.formNumber === "string" ? coverage.formNumber : undefined,
            sectionRef: typeof coverage.sectionRef === "string" ? coverage.sectionRef : undefined,
            sourceNodeIds: node ? [node.id] : nodeId ? [nodeId] : [],
            sourceSpanIds,
          };
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
  return finalizeOperationalProfile(withDeclarations);
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
  const withRaw = rawProfile && typeof rawProfile === "object" && !Array.isArray(rawProfile)
    ? mergeOperationalProfile(
      withDocument,
      sanitizeOperationalProfileCandidate(rawProfile as Partial<PolicyOperationalProfile>),
      validNodeIds,
      validSpanIds,
    )
    : withDocument;
  const withDeclarations = mergeOperationalProfile(
    withRaw,
    declarationProfileCandidate(sourceTree),
    validNodeIds,
    validSpanIds,
  );
  return finalizeOperationalProfile(withDeclarations);
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
  if (policyNumber) fields.policyNumber = policyNumber;
  if (namedInsured) fields.insuredName = namedInsured;
  if (insurer) {
    fields.security = insurer;
    fields.carrier = insurer;
  }
  if (broker) fields.broker = broker;
  if (effectiveDate) fields.effectiveDate = effectiveDate;
  if (expirationDate) fields.expirationDate = expirationDate;
  if (retroactiveDate) fields.retroactiveDate = retroactiveDate;
  if (premium) fields.premium = premium;
  if (operationalProfile.documentType) fields.documentType = operationalProfile.documentType;
  if (operationalProfile.policyTypes.length > 0) fields.policyTypes = operationalProfile.policyTypes;
  if (operationalProfile.coverages.length > 0) {
    fields.coverages = operationalProfile.coverages.map((coverage: OperationalCoverageLine) => ({
      name: coverage.name,
      coverageCode: coverage.coverageCode,
      limit: coverage.limit,
      deductible: coverage.deductible,
      premium: coverage.premium,
      formNumber: coverage.formNumber,
      sectionRef: coverage.sectionRef,
      documentNodeId: coverage.sourceNodeIds[0],
      sourceSpanIds: coverage.sourceSpanIds,
      originalContent: [coverage.name, coverage.limit, coverage.deductible, coverage.premium].filter(Boolean).join(" | "),
    }));
  }
  return fields;
}
