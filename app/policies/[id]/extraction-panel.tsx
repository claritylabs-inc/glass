"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { usePdf } from "@/components/pdf-context";
import { ProseMarkdown } from "@/components/prose-markdown";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SourceEvidenceButton,
  collectSourceSpanIds,
  sourceSpanIdsFrom,
  usePolicySourceSpans,
  type SourceSpanDoc,
} from "./source-provenance";

// ─── Internal types for policy document data ──────────────────────────────────

type PolicySubsection = {
  sectionNumber?: string;
  title?: string;
  content: string;
  pageNumber?: number;
  documentNodeId?: string;
  sourceSpanIds?: string[];
};

type PolicySection = {
  type: string;
  title?: string;
  sectionNumber?: string;
  content: string;
  pageStart: number;
  pageEnd?: number;
  subsections?: PolicySubsection[];
  documentNodeId?: string;
  sourceSpanIds?: string[];
  sourceTextHash?: string;
};

type DocumentOutlineNode = {
  id: string;
  title?: string;
  originalTitle?: string;
  sectionNumber?: string;
  pageStart?: number;
  pageEnd?: number;
  formNumber?: string;
  formTitle?: string;
  excerpt?: string;
  content?: string;
  sourceSpanIds?: string[];
  children?: DocumentOutlineNode[];
};

type DocumentMetadata = {
  tableOfContents?: Array<{
    title?: string;
    level?: number;
    pageStart?: number;
    pageEnd?: number;
    documentNodeId?: string;
    sourceSpanIds?: string[];
  }>;
  pageMap?: Array<{
    page?: number;
    label?: string;
    formNumber?: string;
    formTitle?: string;
    sectionTitle?: string;
    extractorNames?: string[];
    sourceSpanIds?: string[];
  }>;
};

type ContactEntry = {
  name?: string;
  title?: string;
  type?: string;
  phone?: string;
  fax?: string;
  email?: string;
  hours?: string;
  address?: string;
};

type PolicyExclusion = {
  name?: string;
  title?: string;
  content?: string;
  isAbsolute?: boolean;
  buybackAvailable?: boolean;
  buybackEndorsement?: string;
  appliesTo?: string | string[];
  formNumber?: string;
  pageNumber?: number;
  pageStart?: number;
};

type PolicyCondition = {
  name?: string;
  title?: string;
  content?: string;
  conditionType?: string;
  keyValues?: { key: string; value: string }[];
  pageNumber?: number;
};

type PolicyEndorsement = {
  title?: string;
  name?: string;
  formNumber?: string;
  editionDate?: string;
  effectiveDate?: string;
  premiumImpact?: string;
  endorsementType?: string;
  content?: string;
  pageStart?: number;
};

type FeeEntry = {
  name: string;
  amount?: string;
  type?: string;
  description?: string;
  sourceSpanIds?: string[];
};

type PolicyFee = {
  content?: string;
  pageNumber?: number;
  fees?: FeeEntry[];
};

type CoverageEntry = {
  name?: string;
  coverageCode?: string;
  limit?: string;
  limitType?: string;
  deductible?: string;
  formNumber?: string;
  pageNumber?: number;
  sectionRef?: string;
  originalContent?: string;
  sourceSpanIds?: string[];
};

type DefinitionEntry = {
  term?: string;
  definition?: string;
  pageNumber?: number;
  formNumber?: string;
  formTitle?: string;
  sectionRef?: string;
  originalContent?: string;
  sourceSpanIds?: string[];
};

type CoveredReasonEntry = {
  coverageName?: string;
  reasonNumber?: string;
  title?: string;
  content?: string;
  conditions?: string[];
  exceptions?: string[];
  appliesTo?: string[];
  pageNumber?: number;
  formNumber?: string;
  formTitle?: string;
  sectionRef?: string;
  originalContent?: string;
  sourceSpanIds?: string[];
};

type DeclarationField = {
  field?: string;
  value?: string;
  section?: string;
  pageNumber?: number;
  pageStart?: number;
  sourceSpanIds?: string[];
};

type FormInventoryEntry = {
  formNumber?: string;
  editionDate?: string;
  title?: string;
  formType?: string;
  pageStart?: number;
  pageEnd?: number;
  sourceSpanIds?: string[];
};

type SupplementaryFact = {
  key?: string;
  value?: string;
  subject?: string;
  context?: string;
  sourceSpanIds?: string[];
};

type PremiumLine = {
  line?: string;
  amount?: string;
  sourceSpanIds?: string[];
};

type RegulatoryDetail = { label: string; value: string };

type RegulatoryContext = {
  content: string;
  pageNumber?: number;
  jurisdiction?: string;
  regulatoryBody?: string;
  governingLaw?: string;
  details?: RegulatoryDetail[];
  sourceSpanIds?: string[];
};

type ClaimsContact = {
  content: string;
  pageNumber?: number;
  contacts?: ContactEntry[];
  processSteps?: string[];
  reportingTimeLimit?: string;
  sourceSpanIds?: string[];
};

type ComplaintContact = {
  content: string;
  pageNumber?: number;
  contacts?: ContactEntry[];
  sourceSpanIds?: string[];
};

type PolicyDocument = {
  carrier?: string;
  carrierLegalName?: string;
  security?: string;
  mga?: string;
  policyNumber?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  policyTypes?: string[];
  coverages?: CoverageEntry[];
  premium?: string;
  taxesAndFees?: FeeEntry[];
  premiumBreakdown?: PremiumLine[];
  limits?: Record<string, unknown>;
  deductibles?: Record<string, unknown>;
  declarations?: { fields?: DeclarationField[] } | Record<string, unknown>;
  formInventory?: FormInventoryEntry[];
  supplementaryFacts?: SupplementaryFact[];
  sections?: PolicySection[];
  definitions?: DefinitionEntry[];
  coveredReasons?: CoveredReasonEntry[];
  endorsements?: PolicyEndorsement[];
  costsAndFees?: PolicyFee;
  exclusions?: (PolicyExclusion | string)[];
  conditions?: PolicyCondition[];
  claimsContact?: ClaimsContact;
  complaintContact?: ComplaintContact;
  regulatoryContext?: RegulatoryContext;
  documentMetadata?: DocumentMetadata;
  documentOutline?: DocumentOutlineNode[];
};

// ─── Shared sub-components (moved from page.tsx) ─────────────────────────────

function PageRef({ page }: { page: number }) {
  const pdf = usePdf();

  if (!pdf.fileUrl) {
    return (
      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-foreground/5 text-muted-foreground/60">
        p.{page}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        pdf.navigateToPage(page);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          pdf.navigateToPage(page);
        }
      }}
      className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-foreground/5 text-muted-foreground/60 hover:bg-blue-100 hover:text-blue-600 transition-colors"
    >
      p.{page}
    </span>
  );
}

function DocContent({ children }: { children: string }) {
  return (
    <ProseMarkdown gfm className="text-foreground !text-sm !leading-relaxed">
      {children}
    </ProseMarkdown>
  );
}

function formatStructuredLabel(value?: string | null) {
  if (!value) return null;
  const acronyms = new Set(["dba", "fein", "vin", "naic", "mga"]);
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function stringifyValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.map(stringifyValue).filter(Boolean).join(", ");
  return JSON.stringify(value);
}

function objectEntries(value?: Record<string, unknown>) {
  if (!value) return [] as { label: string; value: string }[];
  return Object.entries(value)
    .map(([key, raw]) => ({
      label: formatStructuredLabel(key) ?? key,
      value: stringifyValue(raw),
    }))
    .filter((entry) => entry.value);
}

function compactRows(rows: unknown[]) {
  return rows.filter(
    (row): row is DataRow =>
      typeof row === "object" &&
      row !== null &&
      "label" in row &&
      "value" in row &&
      Boolean(row.label && row.value),
  );
}

type DataRow = {
  label: string;
  value: string;
  section?: string;
  pageNumber?: number;
  sourceSpanIds?: string[];
};
type DataSection = { label: string; rows: DataRow[] };

const STRUCTURED_BODY_LABEL_CLASS = "sm:pl-[2.625rem]";
const STRUCTURED_BODY_VALUE_CLASS = "sm:pr-5";
const STRUCTURED_BODY_TEXT_CLASS =
  "border-t border-foreground/4 px-5 pt-3 sm:pl-[2.625rem] sm:pr-5";

function firstNumericPage(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function declarationsFallbackPage(sections: PolicySection[]) {
  const declarationsSection = sections.find((section) => {
    const title = section.title?.toLowerCase() ?? "";
    return section.type === "declarations" || title.includes("declaration");
  });
  return declarationsSection?.pageStart;
}

function groupRowsBySection(rows: DataRow[]) {
  const sections: DataSection[] = [];
  const sectionIndexes = new Map<string, number>();

  for (const row of rows) {
    const label = row.section || "Other";
    const index = sectionIndexes.get(label);
    const rowWithoutSection = { ...row, section: undefined };

    if (index == null) {
      sectionIndexes.set(label, sections.length);
      sections.push({ label, rows: [rowWithoutSection] });
    } else {
      sections[index]?.rows.push(rowWithoutSection);
    }
  }

  return sections;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function nodeIdsFromOutline(nodes: DocumentOutlineNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: DocumentOutlineNode) => {
    ids.add(node.id);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return ids;
}

function extractedFactRowsForNode(
  policyDocument: PolicyDocument,
  nodeId: string,
): DataRow[] {
  const rows: DataRow[] = [];
  const push = (row: DataRow) => {
    if (row.label && row.value) rows.push(row);
  };

  for (const coverage of policyDocument.coverages ?? []) {
    if ((coverage as { documentNodeId?: string }).documentNodeId !== nodeId)
      continue;
    push({
      label: coverage.name ?? "Coverage",
      value: [
        coverage.limit ? `Limit ${coverage.limit}` : undefined,
        coverage.deductible ? `Deductible ${coverage.deductible}` : undefined,
      ]
        .filter(Boolean)
        .join(" | "),
      sourceSpanIds: sourceSpanIdsFrom(coverage),
      pageNumber: coverage.pageNumber,
    });
  }

  for (const definition of policyDocument.definitions ?? []) {
    if ((definition as { documentNodeId?: string }).documentNodeId !== nodeId)
      continue;
    push({
      label: definition.term ?? "Definition",
      value: definition.definition ?? definition.originalContent ?? "",
      sourceSpanIds: sourceSpanIdsFrom(definition),
      pageNumber: definition.pageNumber,
    });
  }

  for (const reason of policyDocument.coveredReasons ?? []) {
    if ((reason as { documentNodeId?: string }).documentNodeId !== nodeId)
      continue;
    push({
      label: reason.title ?? reason.coverageName ?? "Covered reason",
      value: reason.content ?? "",
      sourceSpanIds: sourceSpanIdsFrom(reason),
      pageNumber: reason.pageNumber,
    });
  }

  for (const item of [
    ...recordArray(policyDocument.endorsements),
    ...recordArray(policyDocument.exclusions),
    ...recordArray(policyDocument.conditions),
    ...recordArray(policyDocument.taxesAndFees),
    ...recordArray(policyDocument.premiumBreakdown),
    ...recordArray(policyDocument.supplementaryFacts),
  ]) {
    if (item.documentNodeId !== nodeId) continue;
    push({
      label:
        stringifyValue(
          item.title ?? item.name ?? item.line ?? item.key ?? item.term,
        ) || "Extracted detail",
      value:
        stringifyValue(
          item.content ??
            item.value ??
            item.amount ??
            item.description ??
            item.excerpt,
        ) || stringifyValue(item),
      sourceSpanIds: sourceSpanIdsFrom(item),
      pageNumber: firstNumericPage(item.pageNumber, item.pageStart),
    });
  }

  return rows;
}

function unlinkedExtractedFactRows(
  policyDocument: PolicyDocument,
  outlineNodeIds: Set<string>,
): DataRow[] {
  const rows: DataRow[] = [];
  const push = (
    label: string | undefined,
    value: string | undefined,
    item: unknown,
    pageNumber?: number,
  ) => {
    if (!label || !value) return;
    const nodeId =
      item && typeof item === "object"
        ? (item as { documentNodeId?: unknown }).documentNodeId
        : undefined;
    if (typeof nodeId === "string" && outlineNodeIds.has(nodeId)) return;
    rows.push({ label, value, sourceSpanIds: sourceSpanIdsFrom(item), pageNumber });
  };

  for (const coverage of policyDocument.coverages ?? []) {
    push(
      coverage.name ?? "Coverage",
      [
        coverage.limit ? `Limit ${coverage.limit}` : undefined,
        coverage.deductible ? `Deductible ${coverage.deductible}` : undefined,
      ]
        .filter(Boolean)
        .join(" | "),
      coverage,
      coverage.pageNumber,
    );
  }
  for (const line of policyDocument.premiumBreakdown ?? []) {
    push(line.line ?? "Premium line", line.amount, line);
  }
  for (const fee of policyDocument.taxesAndFees ?? []) {
    push(fee.name ?? "Tax or fee", fee.amount, fee);
  }

  return rows;
}

// ─── Exclusion / Condition / Endorsement cards ───────────────────────────────

function ExclusionBody({ ex }: { ex: PolicyExclusion }) {
  const metaItems = [
    ex?.formNumber && { label: "Form", value: ex.formNumber },
    ex?.appliesTo && {
      label: "Applies to",
      value: Array.isArray(ex.appliesTo)
        ? ex.appliesTo.join(", ")
        : ex.appliesTo,
    },
    ex?.buybackAvailable &&
      ex?.buybackEndorsement && {
        label: "Buyback",
        value: ex.buybackEndorsement,
      },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {ex?.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{ex.content}</DocContent>
        </div>
      )}
    </div>
  );
}

function ConditionBody({ c }: { c: PolicyCondition }) {
  const keyValues = c?.keyValues as
    | { key: string; value: string }[]
    | undefined;
  return (
    <div className="space-y-3">
      {keyValues && keyValues.length > 0 && (
        <KeyValueTable
          rows={keyValues.map((entry) => ({
            label: formatStructuredLabel(entry.key) ?? entry.key,
            value: entry.value,
          }))}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {c?.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{c.content}</DocContent>
        </div>
      )}
    </div>
  );
}

function EndorsementBody({ e }: { e: PolicyEndorsement }) {
  const metaItems = [
    e?.formNumber && { label: "Form", value: e.formNumber },
    e?.editionDate && { label: "Edition", value: e.editionDate },
    e?.effectiveDate && { label: "Effective", value: e.effectiveDate },
    e?.premiumImpact && { label: "Premium", value: e.premiumImpact },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {e?.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{e.content}</DocContent>
        </div>
      )}
    </div>
  );
}

function CoverageBody({
  coverage,
  sourceSpans,
}: {
  coverage: CoverageEntry;
  sourceSpans?: SourceSpanDoc[];
}) {
  const metaItems = [
    coverage.coverageCode && { label: "Code", value: coverage.coverageCode },
    coverage.limit && { label: "Limit", value: coverage.limit },
    coverage.limitType && {
      label: "Limit type",
      value: formatStructuredLabel(coverage.limitType) ?? coverage.limitType,
    },
    coverage.deductible && { label: "Deductible", value: coverage.deductible },
    coverage.formNumber && { label: "Form", value: coverage.formNumber },
    coverage.sectionRef && { label: "Section", value: coverage.sectionRef },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      <SourceEvidenceButton
        sourceSpanIds={coverage.sourceSpanIds}
        sourceSpans={sourceSpans}
        fallbackPage={coverage.pageNumber}
        className="ml-[2.625rem]"
      />
      {coverage.originalContent && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{coverage.originalContent}</DocContent>
        </div>
      )}
    </div>
  );
}

function DefinitionBody({ definition }: { definition: DefinitionEntry }) {
  const metaItems = [
    definition.formNumber && { label: "Form", value: definition.formNumber },
    definition.formTitle && {
      label: "Form title",
      value: definition.formTitle,
    },
    definition.sectionRef && { label: "Section", value: definition.sectionRef },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {definition.definition && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{definition.definition}</DocContent>
        </div>
      )}
    </div>
  );
}

function splitLabeledText(value: string) {
  const match = value.match(/^([^:]{2,64}):\s*(.+)$/);
  if (!match) return null;
  return {
    label: match[1].trim(),
    value: match[2].trim(),
  };
}

function CoveredReasonDetailSection({
  title,
  items,
}: {
  title: string;
  items?: string[];
}) {
  if (!items?.length) return null;
  const labeledRows = items
    .map(splitLabeledText)
    .filter((row): row is { label: string; value: string } => Boolean(row));
  const shouldUseTable = labeledRows.length === items.length;

  return (
    <div className="border-t border-foreground/4 px-5 pt-3 sm:pl-[2.625rem] sm:pr-5">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {shouldUseTable ? (
        <div className="overflow-hidden rounded-md border border-foreground/6">
          <KeyValueTable
            rows={labeledRows}
            labelCellClassName="!pl-3 sm:!pl-3"
            valueCellClassName="!pr-3 sm:!pr-3"
          />
        </div>
      ) : (
        <div className="space-y-1.5 text-sm leading-relaxed text-foreground">
          {items.map((item, i) => (
            <p key={`${title}-${i}`}>{item}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function CoveredReasonBody({ reason }: { reason: CoveredReasonEntry }) {
  const metaItems = [
    reason.coverageName && { label: "Coverage", value: reason.coverageName },
    reason.formNumber && { label: "Form", value: reason.formNumber },
    reason.formTitle && { label: "Form title", value: reason.formTitle },
    reason.sectionRef && { label: "Section", value: reason.sectionRef },
    reason.appliesTo?.length && {
      label: "Applies to",
      value: reason.appliesTo.join(", "),
    },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {reason.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{reason.content}</DocContent>
        </div>
      )}
      <CoveredReasonDetailSection
        title="Conditions"
        items={reason.conditions}
      />
      <CoveredReasonDetailSection
        title="Exceptions"
        items={reason.exceptions}
      />
    </div>
  );
}

function StructuredItemsCard<T>({
  id,
  title,
  items,
  getTitle,
  getPage,
  getBadges,
  renderBody,
  getSourceSpanIds,
  sourceSpans,
}: {
  id: string;
  title: string;
  items: T[];
  getTitle: (item: T) => string;
  getPage?: (item: T) => number | undefined;
  getBadges?: (item: T) => { label: string; className: string }[];
  renderBody: (item: T) => React.ReactNode;
  getSourceSpanIds?: (item: T) => string[] | undefined;
  sourceSpans?: SourceSpanDoc[];
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  if (!items?.length) return null;

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });

  return (
    <div id={id}>
      <div className="px-5 py-3 border-b border-foreground/4">
        <p className="text-sm font-medium text-foreground">
          {title} ({items.length})
        </p>
      </div>
      {items.map((item, i) => {
        const badges = getBadges?.(item) ?? [];
        const page = getPage?.(item);
        const sourceSpanIds = getSourceSpanIds?.(item) ?? [];
        return (
          <div
            key={i}
            className="border-t border-foreground/4 first:border-t-0"
          >
            <div className="flex items-center gap-2 px-5 py-2.5 hover:bg-foreground/[0.015] transition-colors">
              <button
                type="button"
                onClick={() => toggle(i)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {expanded.has(i) ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm font-normal text-foreground flex-1 min-w-0 truncate">
                  {getTitle(item)}
                </span>
                {badges.length > 0 && (
                  <div className="hidden md:flex items-center gap-1.5 shrink-0">
                    {badges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}
              </button>
              <SourceEvidenceButton
                sourceSpanIds={sourceSpanIds}
                sourceSpans={sourceSpans}
                fallbackPage={page}
              />
              {page != null && sourceSpanIds.length === 0 && (
                <PageRef page={page} />
              )}
            </div>
            {expanded.has(i) && (
              <div className="space-y-3 pt-2 pb-3">
                {badges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-5 md:hidden">
                    {badges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}
                {renderBody(item)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Supplementary cards ──────────────────────────────────────────────────────

function ContactCard({
  contact,
  showType,
}: {
  contact: ContactEntry;
  showType?: boolean;
}) {
  const fields = [
    contact.phone && { label: "Phone", value: contact.phone },
    contact.fax && { label: "Fax", value: contact.fax },
    contact.email && { label: "Email", value: contact.email },
    contact.hours && { label: "Hours", value: contact.hours },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="border-t border-foreground/4 first:border-t-0 px-4 py-3">
      <div className="flex items-center gap-2">
        {contact.name && (
          <p className="text-sm font-medium text-foreground">{contact.name}</p>
        )}
        {showType && contact.type && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/5 text-muted-foreground">
            {contact.type}
          </span>
        )}
      </div>
      {contact.title && (
        <p className="text-sm text-muted-foreground mt-0.5">{contact.title}</p>
      )}
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 mt-1">
          {fields.map((f) => (
            <p key={f.label} className="text-sm text-foreground">
              <span className="text-muted-foreground">{f.label}:</span>{" "}
              {f.value}
            </p>
          ))}
        </div>
      )}
      {contact.address && (
        <p className="text-sm text-muted-foreground mt-1">{contact.address}</p>
      )}
    </div>
  );
}

function SupplementaryCard({
  title,
  icon: _Icon,
  pageNumber,
  content,
  hasStructured,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  pageNumber?: number;
  content: string;
  hasStructured: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-5 py-3 border-b border-foreground/4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {pageNumber != null && <PageRef page={pageNumber} />}
        </div>
      </div>
      {hasStructured ? (
        <>
          <div className="px-5 py-3">{children}</div>
          <details className="group/raw border-t border-foreground/4">
            <summary className="flex items-center gap-2 px-5 py-2.5 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none">
              <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/raw:rotate-90" />
              View raw text
            </summary>
            <div className="px-5 pt-1 pb-3">
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
                {content}
              </p>
            </div>
          </details>
        </>
      ) : (
        <div className="px-5 py-3">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground leading-relaxed [overflow-wrap:anywhere]">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

function RegulatoryContextStructured({ data }: { data: RegulatoryContext }) {
  const gridItems = [
    { label: "Jurisdiction", value: data.jurisdiction },
    { label: "Regulatory Body", value: data.regulatoryBody },
    { label: "Governing Law", value: data.governingLaw },
  ].filter((item) => item.value);

  return (
    <div className="-mx-4 -mt-3">
      {gridItems.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:divide-x divide-foreground/6 border-b border-foreground/4">
          {gridItems.map((item) => (
            <div key={item.label} className="flex-1 px-4 py-2.5">
              <p className="text-xs font-semibold text-muted-foreground mb-0.5">
                {item.label}
              </p>
              <p className="text-sm text-foreground font-medium">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}
      {(data.details?.length ?? 0) > 0 && (
        <table className="w-full text-left">
          <tbody>
            {(data.details ?? []).map((d: RegulatoryDetail, i: number) => (
              <tr
                key={i}
                className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors"
              >
                <td className="px-4 py-2.5 text-sm text-muted-foreground align-top">
                  {d.label}
                </td>
                <td className="px-4 py-2.5 text-sm text-foreground font-medium">
                  {d.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ComplaintContactStructured({
  contacts,
}: {
  contacts?: ContactEntry[];
}) {
  if (!contacts?.length) return null;
  return (
    <div className="-mx-4 -mt-3">
      {contacts.map((c: ContactEntry, i: number) => (
        <ContactCard key={i} contact={c} showType />
      ))}
    </div>
  );
}

function ClaimsContactStructured({ data }: { data: ClaimsContact }) {
  return (
    <div className="-mx-4 -mt-3">
      {(data.contacts?.length ?? 0) > 0 && (
        <div>
          {(data.contacts ?? []).map((c: ContactEntry, i: number) => (
            <ContactCard key={i} contact={c} />
          ))}
        </div>
      )}
      {(data.processSteps?.length ?? 0) > 0 && (
        <div className="border-t border-foreground/4 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Claims Process
          </p>
          <ol className="space-y-1.5">
            {(data.processSteps ?? []).map((step: string, i: number) => (
              <li key={i} className="flex gap-2.5 text-sm text-foreground">
                <span className="text-muted-foreground/60 text-xs mt-px shrink-0">
                  {i + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.reportingTimeLimit && (
        <div className="border-t border-foreground/4 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            Reporting Time Limit
          </p>
          <p className="text-sm text-foreground font-medium">
            {data.reportingTimeLimit}
          </p>
        </div>
      )}
    </div>
  );
}

function KeyValueTable({
  rows,
  sourceSpans,
  className = "",
  labelCellClassName = "",
  valueCellClassName = "",
}: {
  rows: DataRow[];
  sourceSpans?: SourceSpanDoc[];
  className?: string;
  labelCellClassName?: string;
  valueCellClassName?: string;
}) {
  if (!rows.length) return null;
  return (
    <table className={`w-full text-left ${className}`}>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={`${row.section ?? ""}-${row.label}-${i}`}
            className="block border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors sm:table-row"
          >
            <td
              className={`block px-5 pt-3 pb-1 text-xs font-medium text-muted-foreground align-top sm:table-cell sm:w-1/3 sm:py-2.5 sm:text-sm sm:font-normal ${labelCellClassName}`}
            >
              <span>{row.label}</span>
              {row.section && (
                <span className="block text-[11px] text-muted-foreground/60 mt-0.5">
                  {row.section}
                </span>
              )}
            </td>
            <td
              className={`block px-5 pt-0 pb-3 text-sm text-foreground font-normal sm:table-cell sm:py-2.5 ${valueCellClassName}`}
            >
              <span className="inline-flex items-center gap-1.5 break-words">
                <span>{row.value}</span>
                <SourceEvidenceButton
                  sourceSpanIds={row.sourceSpanIds}
                  sourceSpans={sourceSpans}
                  fallbackPage={row.pageNumber}
                />
                {row.pageNumber != null && !row.sourceSpanIds?.length && (
                  <PageRef page={row.pageNumber} />
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DataCard({
  title,
  rows,
  sourceSpans,
}: {
  title: string;
  rows: DataRow[];
  sourceSpans?: SourceSpanDoc[];
}) {
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-foreground/4">
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      <KeyValueTable rows={rows} sourceSpans={sourceSpans} />
    </div>
  );
}

function SectionedDataCard({
  title,
  sections,
  sourceSpans,
}: {
  title: string;
  sections: DataSection[];
  sourceSpans?: SourceSpanDoc[];
}) {
  const nonEmptySections = sections.filter(
    (section) => section.rows.length > 0,
  );
  if (!nonEmptySections.length) return null;

  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-foreground/4">
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      {nonEmptySections.map((section, index) => (
        <GroupSection
          key={`${section.label}-${index}`}
          label={`${section.label} (${section.rows.length})`}
          defaultOpen={index === 0}
        >
          <KeyValueTable
            rows={section.rows}
            sourceSpans={sourceSpans}
            labelCellClassName="sm:pl-11"
          />
        </GroupSection>
      ))}
    </div>
  );
}

function DocumentMetadataPanel({
  metadata,
  sourceSpans,
}: {
  metadata?: DocumentMetadata;
  sourceSpans?: SourceSpanDoc[];
}) {
  const toc = metadata?.tableOfContents ?? [];
  const pageMap = metadata?.pageMap ?? [];
  if (toc.length === 0 && pageMap.length === 0) return null;

  return (
    <div className="rounded-lg border border-foreground/6 bg-card">
      <div className="border-b border-foreground/4 px-5 py-3">
        <p className="text-sm font-medium text-foreground">
          Document navigation
        </p>
      </div>
      <div className="divide-y divide-foreground/6">
        {toc.length > 0 && (
          <div className="px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
              Table of contents
            </p>
            <div className="mt-2 space-y-1.5">
              {toc.slice(0, 12).map((entry, index) => (
                <div
                  key={`${entry.documentNodeId ?? entry.title ?? "toc"}:${index}`}
                  className="flex min-w-0 items-center gap-2 text-label-sm"
                  style={{ paddingLeft: `${Math.max((entry.level ?? 1) - 1, 0) * 12}px` }}
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {entry.title ?? "Untitled section"}
                  </span>
                  <SourceEvidenceButton
                    sourceSpanIds={entry.sourceSpanIds}
                    sourceSpans={sourceSpans}
                    fallbackPage={entry.pageStart}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        {pageMap.length > 0 && (
          <div className="px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
              Page map
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pageMap.slice(0, 24).map((entry, index) => (
                <SourceEvidenceButton
                  key={`${entry.page ?? index}:${entry.formNumber ?? ""}`}
                  sourceSpanIds={entry.sourceSpanIds}
                  sourceSpans={sourceSpans}
                  fallbackPage={entry.page}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OutlineNodeRow({
  node,
  policyDocument,
  sourceSpans,
  depth = 0,
}: {
  node: DocumentOutlineNode;
  policyDocument: PolicyDocument;
  sourceSpans?: SourceSpanDoc[];
  depth?: number;
}) {
  const factRows = extractedFactRowsForNode(policyDocument, node.id);
  const children = node.children ?? [];
  const sourceSpanIds = sourceSpanIdsFrom(node);

  return (
    <div className="border-t border-foreground/6 first:border-t-0">
      <div className="px-5 py-3" style={{ paddingLeft: `${20 + depth * 18}px` }}>
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-foreground">
                {node.title ?? node.originalTitle ?? "Untitled section"}
              </p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              {node.formNumber ? <span>{node.formNumber}</span> : null}
              {node.pageStart ? (
                <span>
                  p.{node.pageStart}
                  {node.pageEnd && node.pageEnd !== node.pageStart
                    ? `-${node.pageEnd}`
                    : ""}
                </span>
              ) : null}
            </div>
          </div>
          <SourceEvidenceButton
            sourceSpanIds={sourceSpanIds}
            sourceSpans={sourceSpans}
            fallbackPage={node.pageStart}
          />
        </div>
        {node.excerpt || node.content ? (
          <div className="mt-2 text-label-sm leading-5 text-muted-foreground">
            <DocContent>{node.excerpt ?? node.content ?? ""}</DocContent>
          </div>
        ) : null}
        {factRows.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-md border border-foreground/6">
            <KeyValueTable
              rows={factRows}
              sourceSpans={sourceSpans}
              className="border-0"
            />
          </div>
        ) : null}
      </div>
      {children.map((child) => (
        <OutlineNodeRow
          key={child.id}
          node={child}
          policyDocument={policyDocument}
          sourceSpans={sourceSpans}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function SourceBackedBreakdown({
  policyDocument,
  sourceSpans,
  topLevelRows,
}: {
  policyDocument: PolicyDocument;
  sourceSpans?: SourceSpanDoc[];
  topLevelRows: DataRow[];
}) {
  const outline = policyDocument.documentOutline ?? [];
  const outlineNodeIds = nodeIdsFromOutline(outline);
  const unlinkedRows = unlinkedExtractedFactRows(policyDocument, outlineNodeIds);

  return (
    <div className="space-y-4">
      <DocumentMetadataPanel
        metadata={policyDocument.documentMetadata}
        sourceSpans={sourceSpans}
      />
      {topLevelRows.length > 0 && (
        <DataCard
          title="Policy facts"
          rows={topLevelRows}
          sourceSpans={sourceSpans}
        />
      )}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="border-b border-foreground/4 px-5 py-3">
          <p className="text-sm font-medium text-foreground">
            Source document outline
          </p>
        </div>
        <div>
          {outline.map((node) => (
            <OutlineNodeRow
              key={node.id}
              node={node}
              policyDocument={policyDocument}
              sourceSpans={sourceSpans}
            />
          ))}
        </div>
      </div>
      {unlinkedRows.length > 0 && (
        <DataCard
          title="Unlinked extracted facts"
          rows={unlinkedRows}
          sourceSpans={sourceSpans}
        />
      )}
    </div>
  );
}

function SourceNativeBreakdownUnavailable() {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-50/60 p-4 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
      <div className="flex gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Source document outline unavailable</p>
          <p className="mt-1 text-label-sm leading-5 opacity-80">
            This policy does not have the top-level document outline generated by
            the current extraction pipeline. Re-extract it from the original PDF
            to see the source-order breakdown. The legacy extracted fields below
            are shown for reference.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Group wrapper ─────────────────────────────────────────────────────────────

export function GroupSection({
  label,
  children,
  defaultOpen,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-t border-foreground/6 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-foreground/[0.02] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground flex-1">
          {label}
        </span>
      </button>
      {open && <div className="space-y-0">{children}</div>}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ExtractionPanelProps {
  policyId?: Id<"policies">;
  /** The full `document` field from the policy record */
  policyDocument: PolicyDocument | null | undefined;
  /** page number that triggered the URL (for section highlighting) */
  initialPage?: number;
}

/** Renders extraction details as separate, flat cards — one per data type */
export function ExtractionCards({
  policyId,
  policyDocument,
  initialPage: _initialPage,
}: ExtractionPanelProps) {
  const allSourceSpanIds = useMemo(
    () => collectSourceSpanIds(policyDocument),
    [policyDocument],
  );
  const sourceSpans = usePolicySourceSpans(policyId, allSourceSpanIds);
  const coverages = policyDocument?.coverages ?? [];
  const declarations = Array.isArray(
    (
      policyDocument?.declarations as
        | { fields?: DeclarationField[] }
        | undefined
    )?.fields,
  )
    ? ((policyDocument?.declarations as { fields?: DeclarationField[] })
        .fields ?? [])
    : [];
  const premiumRows = [
    policyDocument?.premium && {
      label: "Premium",
      value: policyDocument.premium,
    },
  ].filter(Boolean) as { label: string; value: string }[];
  const taxesAndFees = policyDocument?.taxesAndFees ?? [];
  const premiumBreakdown = policyDocument?.premiumBreakdown ?? [];
  const limits = objectEntries(policyDocument?.limits);
  const deductibles = objectEntries(policyDocument?.deductibles);
  const formInventory = policyDocument?.formInventory ?? [];
  const supplementaryFacts = policyDocument?.supplementaryFacts ?? [];
  const sections = policyDocument?.sections ?? [];
  const declarationsPage = declarationsFallbackPage(sections);
  const definitions = policyDocument?.definitions ?? [];
  const coveredReasons = policyDocument?.coveredReasons ?? [];
  const endorsements = policyDocument?.endorsements ?? [];
  const costsAndFees = policyDocument?.costsAndFees;
  const fees = costsAndFees?.fees ?? [];
  const exclusions = policyDocument?.exclusions ?? [];
  const conditions = policyDocument?.conditions ?? [];
  const documentOutline = policyDocument?.documentOutline ?? [];
  const carrierDisplay =
    policyDocument?.carrierLegalName ||
    policyDocument?.security ||
    policyDocument?.carrier;
  const topLevelRows = compactRows([
    carrierDisplay && { label: "Carrier", value: carrierDisplay },
    policyDocument?.mga && {
      label: "Administrator",
      value: policyDocument.mga,
    },
    policyDocument?.policyNumber && {
      label: "Policy number",
      value: policyDocument.policyNumber,
    },
    policyDocument?.insuredName && {
      label: "Named insured",
      value: policyDocument.insuredName,
    },
    (policyDocument?.effectiveDate || policyDocument?.expirationDate) && {
      label: "Policy period",
      value: `${policyDocument.effectiveDate ?? "—"} – ${policyDocument.expirationDate ?? "—"}`,
    },
    policyDocument?.policyTypes?.length && {
      label: "Coverage types",
      value: policyDocument.policyTypes
        .map(
          (type) =>
            POLICY_TYPE_LABELS[type] ?? formatStructuredLabel(type) ?? type,
        )
        .join(", "),
    },
    policyDocument?.premium && {
      label: "Premium",
      value: policyDocument.premium,
    },
  ]);
  const declarationRows = declarations
    .map((field) => ({
      label: formatStructuredLabel(field.field) ?? field.field ?? "Field",
      value: field.value ?? "",
      section: field.section
        ? (formatStructuredLabel(field.section) ?? field.section)
        : undefined,
      pageNumber: firstNumericPage(
        field.pageNumber,
        field.pageStart,
        declarationsPage,
      ),
      sourceSpanIds: sourceSpanIdsFrom(field),
    }))
    .filter((row) => row.value);

  const hasAnyData =
    documentOutline.length > 0 ||
    Boolean(policyDocument?.documentMetadata) ||
    topLevelRows.length > 0 ||
    coverages.length > 0 ||
    declarations.length > 0 ||
    premiumRows.length > 0 ||
    taxesAndFees.length > 0 ||
    premiumBreakdown.length > 0 ||
    limits.length > 0 ||
    deductibles.length > 0 ||
    formInventory.length > 0 ||
    supplementaryFacts.length > 0 ||
    definitions.length > 0 ||
    coveredReasons.length > 0 ||
    endorsements.length > 0 ||
    costsAndFees ||
    exclusions.length > 0 ||
    conditions.length > 0 ||
    policyDocument?.claimsContact ||
    policyDocument?.complaintContact ||
    policyDocument?.regulatoryContext;

  if (!hasAnyData) return null;
  if (!policyDocument) return null;

  if (documentOutline.length > 0) {
    return (
      <SourceBackedBreakdown
        policyDocument={policyDocument}
        sourceSpans={sourceSpans}
        topLevelRows={topLevelRows}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SourceNativeBreakdownUnavailable />

      {topLevelRows.length > 0 && (
        <DataCard
          title="Policy details"
          rows={topLevelRows}
          sourceSpans={sourceSpans}
        />
      )}

      {coverages.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-coverages"
            title="Coverages"
            items={coverages}
            getTitle={(coverage) => coverage.name ?? "Unnamed coverage"}
            getPage={(coverage) => coverage.pageNumber}
            getSourceSpanIds={(coverage) => coverage.sourceSpanIds}
            sourceSpans={sourceSpans}
            getBadges={(coverage) =>
              [
                coverage.coverageCode
                  ? {
                      label: coverage.coverageCode,
                      className: "bg-foreground/5 text-muted-foreground",
                    }
                  : undefined,
                coverage.formNumber
                  ? {
                      label: coverage.formNumber,
                      className: "bg-foreground/5 text-muted-foreground",
                    }
                  : undefined,
              ].filter(Boolean) as { label: string; className: string }[]
            }
            renderBody={(coverage) => (
              <CoverageBody coverage={coverage} sourceSpans={sourceSpans} />
            )}
          />
        </div>
      )}

      {limits.length > 0 && (
        <DataCard title="Limits" rows={limits} sourceSpans={sourceSpans} />
      )}
      {deductibles.length > 0 && (
        <DataCard
          title="Deductibles"
          rows={deductibles}
          sourceSpans={sourceSpans}
        />
      )}

      {(premiumRows.length > 0 ||
        taxesAndFees.length > 0 ||
        premiumBreakdown.length > 0) && (
        <SectionedDataCard
          title="Premium"
          sourceSpans={sourceSpans}
          sections={[
            {
              label: "Summary",
              rows: premiumRows,
            },
            {
              label: "Taxes & fees",
              rows: taxesAndFees
                .map((item) => ({
                  label: item.name,
                  value: item.amount ?? "",
                  section: item.type
                    ? (formatStructuredLabel(item.type) ?? item.type)
                    : item.description,
                  sourceSpanIds: sourceSpanIdsFrom(item),
                }))
                .filter((row) => row.label && row.value),
            },
            {
              label: "Breakdown",
              rows: premiumBreakdown
                .map((item) => ({
                  label: item.line ?? "Premium line",
                  value: item.amount ?? "",
                  sourceSpanIds: sourceSpanIdsFrom(item),
                }))
                .filter((row) => row.value),
            },
          ]}
        />
      )}

      {declarations.length > 0 && (
        <SectionedDataCard
          title="Declarations"
          sourceSpans={sourceSpans}
          sections={groupRowsBySection(declarationRows)}
        />
      )}

      {definitions.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-definitions"
            title="Definitions"
            items={definitions}
            getTitle={(definition) => definition.term ?? "Unnamed definition"}
            getPage={(definition) => definition.pageNumber}
            getSourceSpanIds={(definition) => definition.sourceSpanIds}
            sourceSpans={sourceSpans}
            getBadges={(definition) =>
              definition.sectionRef
                ? [
                    {
                      label: definition.sectionRef,
                      className:
                        "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
                    },
                  ]
                : []
            }
            renderBody={(definition) => (
              <DefinitionBody definition={definition} />
            )}
          />
        </div>
      )}

      {coveredReasons.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-covered-reasons"
            title="Covered reasons"
            items={coveredReasons}
            getTitle={(reason) =>
              [
                reason.reasonNumber,
                reason.title ?? reason.coverageName ?? "Covered reason",
              ]
                .filter(Boolean)
                .join(". ")
            }
            getPage={(reason) => reason.pageNumber}
            getSourceSpanIds={(reason) => reason.sourceSpanIds}
            sourceSpans={sourceSpans}
            getBadges={(reason) =>
              [
                reason.coverageName
                  ? {
                      label: reason.coverageName,
                      className:
                        "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
                    }
                  : undefined,
                reason.conditions?.length
                  ? {
                      label: "Conditions",
                      className:
                        "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                    }
                  : undefined,
              ].filter(Boolean) as { label: string; className: string }[]
            }
            renderBody={(reason) => <CoveredReasonBody reason={reason} />}
          />
        </div>
      )}

      {formInventory.length > 0 && (
        <DataCard
          sourceSpans={sourceSpans}
          title="Form inventory"
          rows={formInventory
            .map((form) => ({
              label: form.title || form.formNumber || "Untitled form",
              value: [
                form.formType
                  ? (formatStructuredLabel(form.formType) ?? form.formType)
                  : null,
                form.formNumber,
                form.editionDate,
                form.pageStart != null
                  ? `Pages ${form.pageStart}${form.pageEnd && form.pageEnd !== form.pageStart ? `-${form.pageEnd}` : ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(" | "),
              sourceSpanIds: sourceSpanIdsFrom(form),
            }))
            .filter((row) => row.value)}
        />
      )}

      {supplementaryFacts.length > 0 && (
        <DataCard
          sourceSpans={sourceSpans}
          title="Supplementary facts"
          rows={supplementaryFacts
            .map((fact) => ({
              label: formatStructuredLabel(fact.key) ?? fact.key ?? "Fact",
              value: fact.value ?? "",
              section:
                [fact.subject, fact.context].filter(Boolean).join(" | ") ||
                undefined,
              sourceSpanIds: sourceSpanIdsFrom(fact),
            }))
            .filter((row) => row.value)}
        />
      )}

      {/* Endorsements */}
      {endorsements.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-endorsements"
            title="Endorsements"
            items={endorsements}
            getTitle={(e) =>
              e.title ?? e.name ?? e.formNumber ?? "Unnamed endorsement"
            }
            getPage={(e) => e.pageStart}
            getBadges={(e) =>
              [
                e?.endorsementType
                  ? {
                      label:
                        formatStructuredLabel(e.endorsementType) ??
                        e.endorsementType,
                      className:
                        e.endorsementType === "restriction" ||
                        e.endorsementType === "exclusion"
                          ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                          : e.endorsementType === "broadening"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
                    }
                  : undefined,
                e?.effectiveDate
                  ? {
                      label: `Eff. ${e.effectiveDate}`,
                      className: "bg-foreground/5 text-muted-foreground",
                    }
                  : undefined,
              ].filter(Boolean) as { label: string; className: string }[]
            }
            renderBody={(e) => <EndorsementBody e={e} />}
          />
        </div>
      )}

      {/* Costs & Fees */}
      {costsAndFees && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Costs & fees"
            pageNumber={costsAndFees.pageNumber}
            content={costsAndFees.content ?? ""}
            hasStructured={fees.length > 0}
          >
            {fees.length > 0 && (
              <div className="-mx-4 -mt-3">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-foreground/[0.02]">
                      <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                        Name
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">
                        Amount
                      </th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                        Type
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fees as Record<string, unknown>[]).map((f, i: number) => (
                      <tr
                        key={i}
                        className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                      >
                        <td className="px-4 py-2.5 text-sm text-foreground font-medium">
                          {String(f.name ?? "—")}
                        </td>
                        <td className="px-4 py-2.5 text-sm font-medium text-foreground text-right">
                          {String(f.amount ?? "—")}
                        </td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-muted-foreground">
                          {String(f.type ?? "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SupplementaryCard>
        </div>
      )}

      {/* Exclusions */}
      {exclusions.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-exclusions"
            title="Exclusions"
            items={exclusions}
            getTitle={(ex) =>
              typeof ex === "string"
                ? ex
                : (ex?.name ?? ex?.title ?? "Unnamed exclusion")
            }
            getPage={(ex) =>
              typeof ex === "string"
                ? undefined
                : (ex.pageNumber ?? ex.pageStart)
            }
            getBadges={(ex) => {
              if (typeof ex === "string") return [];
              return [
                ex?.buybackAvailable
                  ? {
                      label: "Buyback",
                      className:
                        "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
                    }
                  : undefined,
              ].filter(Boolean) as { label: string; className: string }[];
            }}
            renderBody={(ex) => {
              if (typeof ex === "string") {
                return <DocContent>{ex}</DocContent>;
              }
              return <ExclusionBody ex={ex} />;
            }}
          />
        </div>
      )}

      {/* Conditions */}
      {conditions.length > 0 && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <StructuredItemsCard
            id="ep-conditions"
            title="Conditions"
            items={conditions}
            getTitle={(c) => c.name ?? c.title ?? "Unnamed condition"}
            getPage={(c) => c.pageNumber}
            getBadges={(c) =>
              c?.conditionType
                ? [
                    {
                      label:
                        formatStructuredLabel(c.conditionType) ??
                        c.conditionType,
                      className:
                        "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                    },
                  ]
                : []
            }
            renderBody={(c) => <ConditionBody c={c} />}
          />
        </div>
      )}

      {/* Claims contact */}
      {policyDocument?.claimsContact && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Claims contact"
            pageNumber={policyDocument.claimsContact.pageNumber}
            content={policyDocument.claimsContact.content}
            hasStructured={
              !!(
                policyDocument.claimsContact.contacts?.length ||
                policyDocument.claimsContact.processSteps?.length ||
                policyDocument.claimsContact.reportingTimeLimit
              )
            }
          >
            <ClaimsContactStructured data={policyDocument.claimsContact} />
          </SupplementaryCard>
        </div>
      )}

      {/* Complaint contact */}
      {policyDocument?.complaintContact && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Complaint contact"
            pageNumber={policyDocument.complaintContact.pageNumber}
            content={policyDocument.complaintContact.content}
            hasStructured={!!policyDocument.complaintContact.contacts?.length}
          >
            <ComplaintContactStructured
              contacts={policyDocument.complaintContact.contacts}
            />
          </SupplementaryCard>
        </div>
      )}

      {/* Regulatory context */}
      {policyDocument?.regulatoryContext && (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          <SupplementaryCard
            title="Regulatory context"
            pageNumber={policyDocument.regulatoryContext.pageNumber}
            content={policyDocument.regulatoryContext.content}
            hasStructured={
              !!(
                policyDocument.regulatoryContext.jurisdiction ||
                policyDocument.regulatoryContext.regulatoryBody ||
                policyDocument.regulatoryContext.governingLaw ||
                policyDocument.regulatoryContext.details?.length
              )
            }
          >
            <RegulatoryContextStructured
              data={policyDocument.regulatoryContext}
            />
          </SupplementaryCard>
        </div>
      )}
    </div>
  );
}
