import type { SourceSpanLike } from "./sourceTree";

type PromotionSourceNode = {
  id: string;
  sourceSpanIds: string[];
  order: number;
  title: string;
  description?: string;
  path: string;
  kind: string;
};

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hashA = 0x811c9dc5;
  let hashB = 0x45d9f3b;
  for (let index = 0; index < input.length; index += 1) {
    const character = input.charCodeAt(index);
    hashA ^= character;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= character + index;
    hashB = Math.imul(hashB, 0x27d4eb2d);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}

export function extractionContractHash(value: unknown): string {
  return stableHash(value);
}

export type PromotionEvidenceField =
  | "policy_number"
  | "named_insured"
  | "carrier"
  | "effective_date"
  | "expiration_date";

export type PromotionEvidenceCandidate = {
  value: string;
  normalizedValue: string;
  sourceSpanIds: string[];
  sourceNodeIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type PromotionEvidenceLedger = {
  version: "evidence-ledger-v1";
  sourceFingerprint: string;
  ledgerHash: string;
  completeSourceCoverage: boolean;
  eligibleSourceSpanIds: string[];
  projectedSourceSpanIds: string[];
  fields: Record<PromotionEvidenceField, {
    status: "observed" | "not_observed";
    candidates: PromotionEvidenceCandidate[];
    ambiguous: boolean;
  }>;
  coverageRegions: {
    status: "observed" | "not_observed";
    candidates: Array<{
      label: string;
      sourceSpanIds: string[];
      sourceNodeIds: string[];
      pageStart?: number;
      pageEnd?: number;
    }>;
  };
  ambiguous: boolean;
};

export type ExtractionSectionId =
  | "legacy_monolith"
  | "extraction_policy_core"
  | "extraction_policy_coverage"
  | "extraction_coverage_cleanup";

export type PromotionSourceCoverageMap = {
  version: "source-coverage-v1";
  sourceFingerprint: string;
  eligibleSourceSpanIds: string[];
  entries: Array<{
    sourceSpanId: string;
    assignment: "core" | "coverage" | "both" | "catch_all";
  }>;
  shards: {
    core: string[];
    coverage: string[];
    both: string[];
    catchAll: string[];
  };
  complete: boolean;
};

export type ExtractionCompletionManifest = {
  version: "extraction-completion-manifest-v1";
  protocolVersion: "source-tree-v1" | "source-tree-v2";
  extractorVersion: string;
  sourceFingerprint: string;
  eligibleSourceSpanIds: string[];
  sourceCoverageMap?: PromotionSourceCoverageMap;
  sections: Array<{
    id: ExtractionSectionId;
    status: "complete" | "not_applicable" | "degraded";
    sourceSpanIds: string[];
    resultHash?: string;
  }>;
  processedSourceSpanIds: string[];
  completeSourceCoverage: boolean;
  evidenceLedgerHash: string;
  manifestHash: string;
};

export type PromotionGateDecision = {
  allowed: boolean;
  reasons: string[];
  postCutoverViolation: boolean;
};

const FIELD_PATTERNS: Record<PromotionEvidenceField, RegExp[]> = {
  policy_number: [/\bpolicy\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n|;]{2,80})/i],
  named_insured: [
    /\b(?:first\s+)?named\s+insured(?:\s+name)?\s*[:#-]?\s*([^\n|;]{2,160})/i,
    /\binsured\s+name\s*[:#-]?\s*([^\n|;]{2,160})/i,
  ],
  carrier: [
    /\b(?:carrier|insurer|insurance\s+company|company\s+name)\s*[:#-]?\s*([^\n|;]{2,180})/i,
  ],
  effective_date: [
    /\b(?:policy\s+)?effective\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*([^\n|;]{4,80})/i,
    /\b(?:policy\s+)?(?:period|term)\s+(?:from|begin(?:s|ning)?)\s*[:#-]?\s*([^\n|;]{4,80})/i,
  ],
  expiration_date: [
    /\b(?:policy\s+)?(?:expiration|expiry)\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*([^\n|;]{4,80})/i,
    /\b(?:policy\s+)?(?:period|term)\s+(?:to|end(?:s|ing)?)\s*[:#-]?\s*([^\n|;]{4,80})/i,
  ],
};

const LABEL_ONLY: Record<PromotionEvidenceField, RegExp> = {
  policy_number: /^\s*policy\s*(?:number|no\.?|#)\s*[:#-]?\s*$/i,
  named_insured: /^\s*(?:first\s+)?named\s+insured(?:\s+name)?\s*[:#-]?\s*$/i,
  carrier: /^\s*(?:carrier|insurer|insurance\s+company|company\s+name)\s*[:#-]?\s*$/i,
  effective_date: /^\s*(?:policy\s+)?effective\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*$/i,
  expiration_date: /^\s*(?:policy\s+)?(?:expiration|expiry)\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*$/i,
};

const COVERAGE_PATTERN = /\b(?:coverage|coverages|covered|limit(?:s)?\s+of\s+(?:insurance|liability)|deductible|retention|insuring\s+agreement|schedule\s+of|vehicle\s+schedule|auto\s+schedule|property\s+schedule|location\s+schedule|coverage\s+part|premium\s+schedule)\b/i;
const CORE_CONTEXT = /\b(?:policy\s*(?:number|no\.?|#)|named\s+insured|insured\s+name|carrier|insurer|insurance\s+company|policy\s+period|effective\s+date|expiration\s+date|expiry\s+date|producer|broker|general\s+agent|declarations?)\b/i;
const COVERAGE_CONTEXT = /\b(?:coverage|coverages|covered|limit(?:s)?\s+of\s+(?:insurance|liability)|deductible|retention|insuring\s+agreement|schedule\s+of|vehicle\s+schedule|auto\s+schedule|property\s+schedule|location\s+schedule|coverage\s+part|premium\s+schedule)\b/i;
const PARTY_CHANGING_ENDORSEMENT = /\b(?:endorsement|additional\s+insured|named\s+insured|loss\s+payee|mortgagee|carrier|insurer|producer|broker|general\s+agent|changes?\s+the\s+policy)\b/i;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function spanId(span: SourceSpanLike): string | undefined {
  return clean(span.id) || clean(span.spanId) || undefined;
}

function spanPageStart(span: SourceSpanLike): number | undefined {
  const location = span.location as Record<string, unknown> | undefined;
  return span.pageStart ?? (typeof location?.page === "number" ? location.page : undefined)
    ?? (typeof location?.startPage === "number" ? location.startPage : undefined);
}

function spanPageEnd(span: SourceSpanLike): number | undefined {
  const location = span.location as Record<string, unknown> | undefined;
  return span.pageEnd ?? (typeof location?.endPage === "number" ? location.endPage : undefined)
    ?? spanPageStart(span);
}

function numericRecordValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sourceSpanOrdinal(span: SourceSpanLike): number | undefined {
  const match = spanId(span)?.match(/:span:[^:]+:(\d+):[^:]+$/);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

function eligibleSpans(sourceSpans: readonly SourceSpanLike[]) {
  return sourceSpans
    .map((span, inputIndex) => ({ span, inputIndex }))
    .filter((item): item is {
      span: SourceSpanLike & { text: string };
      inputIndex: number;
    } => Boolean(spanId(item.span) && clean(item.span.text)))
    .sort((left, right) => {
      const pageOrder = (spanPageStart(left.span) ?? Number.MAX_SAFE_INTEGER)
        - (spanPageStart(right.span) ?? Number.MAX_SAFE_INTEGER);
      if (pageOrder !== 0) return pageOrder;
      const leftTableId = clean(left.span.table?.tableId);
      const rightTableId = clean(right.span.table?.tableId);
      if (leftTableId && leftTableId === rightTableId) {
        const rowOrder = (numericRecordValue(left.span.table, "rowIndex") ?? 0)
          - (numericRecordValue(right.span.table, "rowIndex") ?? 0);
        if (rowOrder !== 0) return rowOrder;
        const columnOrder = (numericRecordValue(left.span.table, "columnIndex") ?? 0)
          - (numericRecordValue(right.span.table, "columnIndex") ?? 0);
        if (columnOrder !== 0) return columnOrder;
      }
      const leftLocation = left.span.location as Record<string, unknown> | undefined;
      const rightLocation = right.span.location as Record<string, unknown> | undefined;
      const lineOrder = (numericRecordValue(leftLocation, "lineStart") ?? Number.MAX_SAFE_INTEGER)
        - (numericRecordValue(rightLocation, "lineStart") ?? Number.MAX_SAFE_INTEGER);
      if (lineOrder !== 0) return lineOrder;
      const characterOrder = (numericRecordValue(leftLocation, "charStart") ?? Number.MAX_SAFE_INTEGER)
        - (numericRecordValue(rightLocation, "charStart") ?? Number.MAX_SAFE_INTEGER);
      if (characterOrder !== 0) return characterOrder;
      const ordinalOrder = (sourceSpanOrdinal(left.span) ?? Number.MAX_SAFE_INTEGER)
        - (sourceSpanOrdinal(right.span) ?? Number.MAX_SAFE_INTEGER);
      return ordinalOrder || left.inputIndex - right.inputIndex;
    })
    .map(({ span }) => span);
}

export function extractionSourceFingerprint(sourceSpans: readonly SourceSpanLike[]): string {
  return stableHash(eligibleSpans(sourceSpans).map((span) => ({
    id: spanId(span),
    hash: clean(span.textHash) || clean(span.hash) || stableHash(clean(span.text)),
    pageStart: spanPageStart(span),
    pageEnd: spanPageEnd(span),
  })));
}

function normalizedValue(field: PromotionEvidenceField, value: string) {
  const cleaned = clean(value).replace(/^[\s:#-]+/, "").replace(/[\s|;,]+$/, "");
  if (field === "policy_number") return cleaned.replace(/\s+/g, "").toUpperCase();
  if (field === "effective_date" || field === "expiration_date") return cleaned.toUpperCase();
  return cleaned.toLowerCase();
}

function plausible(field: PromotionEvidenceField, value: string) {
  const cleaned = clean(value);
  if (!cleaned || cleaned.length > 180) return false;
  if (LABEL_ONLY[field].test(cleaned)) return false;
  if (field === "effective_date" || field === "expiration_date") {
    return /\d/.test(cleaned) && /(?:\d{1,2}[/-]\d{1,2}|\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(cleaned);
  }
  return /[a-z0-9]/i.test(cleaned);
}

function projections(
  sourceSpans: readonly SourceSpanLike[],
  sourceTree: readonly PromotionSourceNode[],
) {
  const nodesBySpan = new Map<string, PromotionSourceNode[]>();
  for (const node of sourceTree) {
    for (const id of node.sourceSpanIds) {
      const nodes = nodesBySpan.get(id) ?? [];
      nodes.push(node);
      nodesBySpan.set(id, nodes);
    }
  }
  return eligibleSpans(sourceSpans).map((span) => ({
    span,
    id: spanId(span)!,
    nodes: (nodesBySpan.get(spanId(span)!) ?? [])
      .slice()
      .sort((left, right) => left.order - right.order || compareText(left.id, right.id)),
  }));
}

export function buildPromotionSourceCoverageMap(args: {
  sourceSpans: readonly SourceSpanLike[];
  sourceTree: readonly PromotionSourceNode[];
}): PromotionSourceCoverageMap {
  const projected = projections(args.sourceSpans, args.sourceTree);
  const entries = projected.map((item): PromotionSourceCoverageMap["entries"][number] => {
    const spanText = clean(item.span.text);
    const nodeContext = clean(item.nodes.flatMap((node) => [
      node.title,
      node.description,
      node.path,
    ]).join(" "));
    const context = `${spanText} ${nodeContext}`;
    const inEndorsement = item.nodes.some((node) =>
      node.kind === "endorsement" || /\bendorsement\b/i.test(`${node.title} ${node.path}`));
    const core = CORE_CONTEXT.test(context);
    const coverage = COVERAGE_CONTEXT.test(context);
    const partyChangingEndorsement = inEndorsement &&
      PARTY_CHANGING_ENDORSEMENT.test(context);
    return {
      sourceSpanId: item.id,
      assignment: partyChangingEndorsement || (core && coverage)
        ? "both"
        : core
          ? "core"
          : coverage
            ? "coverage"
            : "catch_all",
    };
  });
  const eligibleSourceSpanIds = projected.map((item) => item.id);
  const assigned = new Set(entries.map((entry) => entry.sourceSpanId));
  return {
    version: "source-coverage-v1",
    sourceFingerprint: extractionSourceFingerprint(args.sourceSpans),
    eligibleSourceSpanIds,
    entries,
    shards: {
      core: entries.filter((entry) => entry.assignment === "core").map((entry) => entry.sourceSpanId),
      coverage: entries.filter((entry) => entry.assignment === "coverage").map((entry) => entry.sourceSpanId),
      both: entries.filter((entry) => entry.assignment === "both").map((entry) => entry.sourceSpanId),
      catchAll: entries.filter((entry) => entry.assignment === "catch_all").map((entry) => entry.sourceSpanId),
    },
    complete: eligibleSourceSpanIds.every((id) => assigned.has(id)),
  };
}

function fieldCandidates(
  field: PromotionEvidenceField,
  projected: ReturnType<typeof projections>,
) {
  const byKey = new Map<string, PromotionEvidenceCandidate>();
  const addCandidate = (
    valueInput: string,
    evidence: typeof projected,
  ) => {
    if (!plausible(field, valueInput)) return;
    const value = clean(valueInput);
    const sourceSpanIds = [...new Set(evidence.map((item) => item.id))].sort();
    const sourceNodeIds = [...new Set(
      evidence.flatMap((item) => item.nodes.map((node) => node.id)),
    )].sort();
    if (sourceSpanIds.length === 0 || sourceNodeIds.length === 0) return;
    const pages = evidence.flatMap((item) => [
      spanPageStart(item.span),
      spanPageEnd(item.span),
    ]).filter((page): page is number => typeof page === "number");
    const candidate: PromotionEvidenceCandidate = {
      value,
      normalizedValue: normalizedValue(field, value),
      sourceSpanIds,
      sourceNodeIds,
      ...(pages.length
        ? { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) }
        : {}),
    };
    const key = `${candidate.normalizedValue}\u0000${candidate.sourceSpanIds.join(",")}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  };
  for (const projection of projected) {
    if (projection.nodes.length === 0) continue;
    for (const pattern of FIELD_PATTERNS[field]) {
      const match = pattern.exec(projection.span.text);
      if (match?.[1]) addCandidate(match[1], [projection]);
    }
  }
  for (let index = 0; index < projected.length - 1; index += 1) {
    const label = projected[index]!;
    const value = projected[index + 1]!;
    if (label.nodes.length === 0 || value.nodes.length === 0) continue;
    if (!LABEL_ONLY[field].test(label.span.text)) continue;
    const labelPage = spanPageStart(label.span);
    const valuePage = spanPageStart(value.span);
    if (labelPage !== undefined && valuePage !== undefined && labelPage !== valuePage) continue;
    const labelRow = label.span.table?.rowSpanId;
    const valueRow = value.span.table?.rowSpanId;
    const sameRow = typeof labelRow === "string" && labelRow === valueRow;
    if (
      !sameRow &&
      label.span.table?.tableId &&
      label.span.table.tableId !== value.span.table?.tableId
    ) {
      continue;
    }
    addCandidate(value.span.text, [label, value]);
  }
  return [...byKey.values()].sort((left, right) =>
    (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.normalizedValue, right.normalizedValue)
    || compareText(left.sourceSpanIds.join(","), right.sourceSpanIds.join(",")));
}

export function buildPromotionEvidenceLedger(args: {
  sourceSpans: readonly SourceSpanLike[];
  sourceTree: readonly PromotionSourceNode[];
  processedSourceSpanIds?: readonly string[];
}): PromotionEvidenceLedger {
  const projected = projections(args.sourceSpans, args.sourceTree);
  const eligibleSourceSpanIds = projected.map((item) => item.id);
  const projectedSourceSpanIds = projected.filter((item) => item.nodes.length > 0).map((item) => item.id);
  const processed = args.processedSourceSpanIds
    ? new Set(args.processedSourceSpanIds)
    : undefined;
  const completeSourceCoverage = eligibleSourceSpanIds.length > 0
    && projectedSourceSpanIds.length === eligibleSourceSpanIds.length
    && (!processed || eligibleSourceSpanIds.every((id) => processed.has(id)));
  const fields = Object.fromEntries(
    (["policy_number", "named_insured", "carrier", "effective_date", "expiration_date"] as const)
      .map((field) => {
        const candidates = fieldCandidates(field, projected);
        return [field, {
          status: candidates.length ? "observed" as const : "not_observed" as const,
          candidates,
          ambiguous: new Set(candidates.map((candidate) => candidate.normalizedValue)).size > 1,
        }];
      }),
  ) as PromotionEvidenceLedger["fields"];
  const coverageCandidates = projected
    .filter((item) => item.nodes.length > 0 && COVERAGE_PATTERN.test([
      item.span.text,
      ...item.nodes.flatMap((node) => [node.title, node.description, node.path]),
    ].join(" ")))
    .map((item) => ({
      label: clean(item.span.text).slice(0, 240),
      sourceSpanIds: [item.id],
      sourceNodeIds: [...new Set(item.nodes.map((node) => node.id))].sort(),
      ...(spanPageStart(item.span) === undefined
        ? {}
        : { pageStart: spanPageStart(item.span), pageEnd: spanPageEnd(item.span) }),
    }))
    .sort((left, right) =>
      (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER)
      || compareText(left.sourceSpanIds[0] ?? "", right.sourceSpanIds[0] ?? ""));
  const withoutHash = {
    version: "evidence-ledger-v1" as const,
    sourceFingerprint: extractionSourceFingerprint(args.sourceSpans),
    completeSourceCoverage,
    eligibleSourceSpanIds,
    projectedSourceSpanIds,
    fields,
    coverageRegions: {
      status: coverageCandidates.length ? "observed" as const : "not_observed" as const,
      candidates: coverageCandidates,
    },
    ambiguous: Object.values(fields).some((field) => field.ambiguous),
  };
  return { ...withoutHash, ledgerHash: stableHash(withoutHash) };
}

export function buildExtractionCompletionManifest(args: {
  protocolVersion: "source-tree-v1" | "source-tree-v2";
  extractorVersion: string;
  ledger: PromotionEvidenceLedger;
  sourceCoverageMap?: PromotionSourceCoverageMap;
  sections?: ExtractionCompletionManifest["sections"];
}): ExtractionCompletionManifest {
  const sections = args.sections ?? [{
    id: "legacy_monolith" as const,
    status: "complete" as const,
    sourceSpanIds: args.ledger.eligibleSourceSpanIds,
  }];
  const processedSourceSpanIds = [...new Set(
    sections
      .filter((section) => section.status !== "degraded")
      .flatMap((section) => section.sourceSpanIds),
  )].sort();
  const withoutHash = {
    version: "extraction-completion-manifest-v1" as const,
    protocolVersion: args.protocolVersion,
    extractorVersion: args.extractorVersion,
    sourceFingerprint: args.ledger.sourceFingerprint,
    eligibleSourceSpanIds: args.ledger.eligibleSourceSpanIds,
    ...(args.sourceCoverageMap ? { sourceCoverageMap: args.sourceCoverageMap } : {}),
    sections,
    processedSourceSpanIds,
    completeSourceCoverage:
      args.ledger.completeSourceCoverage
      && args.ledger.eligibleSourceSpanIds.every((id) => processedSourceSpanIds.includes(id)),
    evidenceLedgerHash: args.ledger.ledgerHash,
  };
  return { ...withoutHash, manifestHash: stableHash(withoutHash) };
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && clean(id).length > 0)
    : [];
}

function sourceBackedProjectionCitesCandidate(
  value: unknown,
  candidates: readonly {
    sourceSpanIds: string[];
    sourceNodeIds: string[];
  }[],
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (clean(record.value).length === 0 && clean(record.name).length === 0) return false;
  const citedSpanIds = stringIds(record.sourceSpanIds);
  const citedNodeIds = stringIds(record.sourceNodeIds);
  if (citedSpanIds.length > 0) {
    const cited = new Set(citedSpanIds);
    return candidates.some((candidate) =>
      candidate.sourceSpanIds.some((id) => cited.has(id)));
  }
  if (citedNodeIds.length > 0) {
    const cited = new Set(citedNodeIds);
    return candidates.some((candidate) =>
      candidate.sourceNodeIds.some((id) => cited.has(id)));
  }
  return false;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return stableHash([...new Set(left)].sort()) === stableHash([...new Set(right)].sort());
}

export function evaluateExtractionPromotion(args: {
  manifest: ExtractionCompletionManifest;
  ledger: PromotionEvidenceLedger;
  operationalProfile: unknown;
  hasValidCarrierIdentity: boolean;
  postCutover: boolean;
}): PromotionGateDecision {
  const reasons: string[] = [];
  if (args.manifest.sourceFingerprint !== args.ledger.sourceFingerprint) {
    reasons.push("manifest source fingerprint does not match the evidence ledger");
  }
  if (args.manifest.evidenceLedgerHash !== args.ledger.ledgerHash) {
    reasons.push("manifest evidence-ledger hash does not match recomputed evidence");
  }
  if (!args.manifest.completeSourceCoverage || !args.ledger.completeSourceCoverage) {
    reasons.push("source coverage is incomplete");
  }
  if (args.manifest.protocolVersion === "source-tree-v2") {
    const coverageMap = args.manifest.sourceCoverageMap;
    if (!coverageMap) {
      reasons.push("source-tree-v2 manifest is missing its source-coverage map");
    } else {
      const entryIds = coverageMap.entries.map((entry) => entry.sourceSpanId);
      if (
        coverageMap.sourceFingerprint !== args.ledger.sourceFingerprint ||
        !sameIds(coverageMap.eligibleSourceSpanIds, args.ledger.eligibleSourceSpanIds) ||
        !sameIds(entryIds, args.ledger.eligibleSourceSpanIds) ||
        new Set(entryIds).size !== entryIds.length ||
        !coverageMap.complete
      ) {
        reasons.push("source-coverage map does not cover the complete source bundle");
      }
      const coreSection = args.manifest.sections.find((section) =>
        section.id === "extraction_policy_core");
      const coverageSection = args.manifest.sections.find((section) =>
        section.id === "extraction_policy_coverage");
      const expectedCore = coverageMap.entries
        .filter((entry) => entry.assignment !== "coverage")
        .map((entry) => entry.sourceSpanId);
      const expectedCoverage = coverageMap.entries
        .filter((entry) => entry.assignment === "coverage" || entry.assignment === "both")
        .map((entry) => entry.sourceSpanId);
      if (!coreSection || !sameIds(coreSection.sourceSpanIds, expectedCore)) {
        reasons.push("core section span IDs do not match the deterministic source-coverage map");
      }
      if (!coverageSection || !sameIds(coverageSection.sourceSpanIds, expectedCoverage)) {
        reasons.push("coverage section span IDs do not match the deterministic source-coverage map");
      }
    }
  }
  if (args.manifest.sections.some((section) => section.status === "degraded")) {
    reasons.push("one or more extraction sections are degraded");
  }
  const profile = args.operationalProfile && typeof args.operationalProfile === "object"
    ? args.operationalProfile as Record<string, unknown>
    : {};
  const modelFields: Record<Exclude<PromotionEvidenceField, "carrier">, unknown> = {
    policy_number: profile.policyNumber,
    named_insured: profile.namedInsured,
    effective_date: profile.effectiveDate,
    expiration_date: profile.expirationDate,
  };
  for (const [field, evidence] of Object.entries(args.ledger.fields) as Array<
    [PromotionEvidenceField, PromotionEvidenceLedger["fields"][PromotionEvidenceField]]
  >) {
    if (evidence.ambiguous) {
      reasons.push(`${field} evidence is ambiguous`);
      continue;
    }
    if (evidence.status !== "observed") continue;
    if (field === "carrier") {
      if (!args.hasValidCarrierIdentity) {
        reasons.push("carrier evidence is present without a valid carrier identity");
      }
    } else if (!sourceBackedProjectionCitesCandidate(
      modelFields[field],
      evidence.candidates,
    )) {
      reasons.push(`${field} evidence is present but the extracted profile omitted a cited value`);
    }
  }
  const coverages = Array.isArray(profile.coverages) ? profile.coverages : [];
  if (args.ledger.coverageRegions.status === "observed") {
    if (coverages.length === 0) {
      reasons.push("coverage evidence is present but the extracted profile has no coverage rows");
    } else if (!coverages.some((coverage) => sourceBackedProjectionCitesCandidate(
      coverage,
      args.ledger.coverageRegions.candidates,
    ))) {
      reasons.push("coverage evidence is present but the extracted profile has no cited coverage row");
    }
  }
  const coverageSection = args.manifest.sections.find((section) =>
    section.id === "extraction_policy_coverage");
  if (
    coverageSection?.status === "not_applicable"
    && (
      args.ledger.coverageRegions.status === "observed"
      || !args.ledger.completeSourceCoverage
    )
  ) {
    reasons.push("coverage cannot be not_applicable when candidates exist or source coverage is incomplete");
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    postCutoverViolation: args.postCutover && reasons.length > 0,
  };
}
