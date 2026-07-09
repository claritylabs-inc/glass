"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  buildCoverageBreakdown,
  type CoverageBreakdown,
} from "@/convex/lib/coverageBreakdown";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import { PillButton } from "@/components/ui/pill-button";
import { useCachedPolicyDetail } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  evidenceSpansForIds,
  highlightBoxesForSpans,
  type SourceSpanDoc,
} from "@/app/policies/[id]/source-provenance";

type CoverageBreakdownRow = CoverageBreakdown["all"][number];

interface PolicyPreviewProps {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  onHeaderInfo?: (info: {
    policyId: string;
    carrier: string;
    policyNum?: string;
  }) => void;
  onFooterActions?: (actions: {
    fileUrl?: string;
    policyId: string;
    page?: number;
    highlightBoxes?: Array<{
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      coordinateWidth?: number;
      coordinateHeight?: number;
    }>;
  }) => void;
}

type MetadataRow = {
  label: string;
  value: string;
};

function realText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "-" || text === "\u2014") return undefined;
  return text;
}

function titleLabel(value: string | undefined) {
  return value
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: unknown) {
  const text = realText(value);
  if (!text) return undefined;
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : text;
}

function formatPolicyPeriod(record: Record<string, unknown>) {
  const effectiveDate = formatDate(record.effectiveDate);
  const expirationDate = formatDate(record.expirationDate);
  if (record.policyTermType === "continuous" && effectiveDate) {
    return `${effectiveDate} - Until Cancelled`;
  }
  if (!effectiveDate && !expirationDate) return undefined;
  return `${effectiveDate ?? "-"} - ${expirationDate ?? "-"}`;
}

function carrierName(record: Record<string, unknown>) {
  return (
    realText(record.carrierLegalName) ??
    realText(record.security) ??
    realText(record.carrier)
  );
}

function policyKind(record: Record<string, unknown>) {
  const parts = [
    titleLabel(realText(record.policyTermType)),
    record.isRenewal === true ? "Renewal" : undefined,
  ].filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(" / ") : undefined;
}

function metadataRows(
  record: Record<string, unknown>,
  fileCount: number,
): MetadataRow[] {
  return [
    { label: "Named insured", value: realText(record.insuredName) },
    { label: "Carrier", value: carrierName(record) },
    { label: "Administrator", value: realText(record.mga) },
    { label: "Broker", value: realText(record.broker) },
    { label: "Policy number", value: realText(record.policyNumber) },
    { label: "Policy period", value: formatPolicyPeriod(record) },
    { label: "Premium", value: realText(record.premium) },
    { label: "Policy type", value: policyKind(record) },
    {
      label: "Files",
      value: fileCount > 1 ? `${fileCount} files combined` : undefined,
    },
  ].filter((row): row is MetadataRow => Boolean(row.value));
}

function normalizedCoverageText(value: string | undefined) {
  return value
    ?.toLowerCase()
    .replace(/[^a-z0-9$.,/%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverageTermRows(row: CoverageBreakdownRow) {
  const terms = [...(row.limits ?? [])];
  const seen = new Set(
    terms.map(
      (term) =>
        `${normalizedCoverageText(term.label)}|${normalizedCoverageText(term.value)}`,
    ),
  );
  const hasLabel = (pattern: RegExp) =>
    terms.some((term) => pattern.test(normalizedCoverageText(term.label) ?? ""));
  const push = (label: string, value: string | undefined) => {
    if (!value) return;
    const key = `${normalizedCoverageText(label)}|${normalizedCoverageText(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ label, value });
  };

  if (!row.limits?.length) push("Limit", row.limit);
  if (!hasLabel(/\bdeductible\b|\bretention\b/)) {
    push("Deductible", row.deductible);
  }
  if (!hasLabel(/\bpremium\b/)) push("Premium", row.premium);
  if (!hasLabel(/\bretroactive\b/)) {
    push("Retroactive Date", row.retroactiveDate);
  }
  return terms;
}

export function PolicyPreview({
  id,
  page,
  citedSourceSpanIds,
  onHeaderInfo,
  onFooterActions,
}: PolicyPreviewProps) {
  const policy = useCachedPolicyDetail(id as Id<"policies">);
  const previewSourceSpanIds = useMemo(
    () => [...new Set(citedSourceSpanIds ?? [])].slice(0, 64),
    [citedSourceSpanIds],
  );
  const fileUrl = useCachedQuery(
    "policies.getPolicyFileUrl.preview",
    api.policies.getPolicyFileUrl,
    policy ? { policyId: policy._id } : "skip",
  );
  const [showAllTypes, setShowAllTypes] = useState(false);
  const sourceSpans = useCachedQuery(
    "sourceSpans.listSpansByPolicyAndSpanIds.preview",
    api.sourceSpans.listSpansByPolicyAndSpanIds,
    previewSourceSpanIds.length
      ? {
          policyId: id as Id<"policies">,
          spanIds: previewSourceSpanIds,
        }
      : "skip",
  ) as SourceSpanDoc[] | undefined;
  const citedSourceSpans = useMemo(
    () =>
      citedSourceSpanIds?.length
        ? evidenceSpansForIds(sourceSpans, citedSourceSpanIds)
        : [],
    [citedSourceSpanIds, sourceSpans],
  );

  const record = policy as Record<string, unknown> | undefined;
  const carrier = record ? carrierName(record) ?? "Unknown carrier" : "Unknown carrier";
  const policyNum = record ? realText(record.policyNumber) : undefined;

  useEffect(() => {
    if (policy && onHeaderInfo) {
      onHeaderInfo({ policyId: id, carrier, policyNum });
    }
  }, [carrier, id, policyNum, policy, onHeaderInfo]);

  const highlightBoxes = useMemo(
    () => highlightBoxesForSpans(citedSourceSpans),
    [citedSourceSpans],
  );
  const citedPage = page ?? highlightBoxes[0]?.page;

  useEffect(() => {
    if (policy && onFooterActions) {
      onFooterActions({
        fileUrl: fileUrl ?? undefined,
        policyId: id,
        page: citedPage,
        highlightBoxes,
      });
    }
  }, [fileUrl, id, citedPage, onFooterActions, highlightBoxes, policy]);

  if (!policy || !record) {
    return <div className="min-h-24" />;
  }

  const types = policyLobCodes(policy).filter((code) => code !== "UN");
  const fileCount = Array.isArray(record.files) ? record.files.length : 0;
  const coverageBreakdown = buildCoverageBreakdown(policy);
  const rows = metadataRows(record, fileCount);

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      <PolicyMetadataPreview
        rows={rows}
        types={types}
        showAllTypes={showAllTypes}
        onShowAllTypes={() => setShowAllTypes(true)}
      />

      {citedSourceSpans.length > 0 && (
        <ExactSourceLocations sourceSpans={citedSourceSpans} />
      )}

      <CoverageListPreview breakdown={coverageBreakdown} />
    </div>
  );
}

function PolicyMetadataPreview({
  rows,
  types,
  showAllTypes,
  onShowAllTypes,
}: {
  rows: MetadataRow[];
  types: string[];
  showAllTypes: boolean;
  onShowAllTypes: () => void;
}) {
  if (!rows.length && !types.length) return null;
  const visibleTypes = showAllTypes ? types : types.slice(0, 3);
  const hiddenTypeCount = Math.max(0, types.length - visibleTypes.length);

  return (
    <section className="min-w-0">
      <p className="mb-2 text-base font-medium text-muted-foreground/60">
        Key details
      </p>
      <dl className="min-w-0 divide-y divide-foreground/6 overflow-hidden rounded-md border border-foreground/8 bg-card text-card-foreground">
        {types.length > 0 && (
          <div className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-3 px-3 py-2.5">
            <dt className="text-label text-muted-foreground/50">
              Lines of business
            </dt>
            <dd className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {visibleTypes.map((type) => (
                  <span
                    key={type}
                    className="rounded-full bg-secondary px-2 py-0.5 text-label font-medium text-muted-foreground"
                  >
                    {lobLabel(type)}
                  </span>
                ))}
                {hiddenTypeCount > 0 && (
                  <PillButton
                    size="compact"
                    variant="secondary"
                    onClick={onShowAllTypes}
                  >
                    +{hiddenTypeCount} more
                  </PillButton>
                )}
              </div>
            </dd>
          </div>
        )}
        {rows.map((row) => (
          <div
            key={`${row.label}:${row.value}`}
            className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-3 px-3 py-2.5"
          >
            <dt className="text-label text-muted-foreground/50">
              {row.label}
            </dt>
            <dd className="min-w-0 text-base leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ExactSourceLocations({
  sourceSpans,
}: {
  sourceSpans: SourceSpanDoc[];
}) {
  return (
    <section className="min-w-0 rounded-md border border-foreground/8 bg-foreground/[0.02]">
      <div className="border-b border-foreground/6 px-3 py-2">
        <p className="text-label font-medium text-foreground">
          Exact source locations
        </p>
      </div>
      <div className="divide-y divide-foreground/6">
        {sourceSpans.slice(0, 5).map((span) => (
          <div key={span.spanId} className="px-3 py-2">
            <div className="mb-1 flex min-w-0 items-center gap-2">
              <span className="text-label font-medium text-muted-foreground">
                p.{span.pageStart ?? span.bbox?.[0]?.page ?? "?"}
              </span>
              <span className="truncate text-label text-muted-foreground/50">
                {span.sectionId ??
                  span.formNumber ??
                  (span.metadata?.elementType as string | undefined) ??
                  "Source span"}
              </span>
            </div>
            <p className="line-clamp-3 text-base leading-relaxed text-foreground/80">
              {span.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

type CoveragePreviewGroup = {
  key: string;
  title: string;
  rows: CoverageBreakdownRow[];
};

function coveragePreviewGroups(breakdown: CoverageBreakdown): CoveragePreviewGroup[] {
  return [
    ...breakdown.groups.map((group) => ({
      key: group.lineOfBusiness,
      title: group.label,
      rows: group.items,
    })),
    ...(breakdown.unassigned.length
      ? [{
          key: "unassigned",
          title: breakdown.groups.length ? "Unassigned" : "Coverage schedules",
          rows: breakdown.unassigned,
        }]
      : []),
  ];
}

function visibleCoveragePreviewGroups(
  groups: CoveragePreviewGroup[],
  maxRows: number,
): CoveragePreviewGroup[] {
  let remaining = maxRows;
  const visible: CoveragePreviewGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const rows = group.rows.slice(0, remaining);
    if (rows.length > 0) visible.push({ ...group, rows });
    remaining -= rows.length;
  }
  return visible;
}

function CoverageListPreview({ breakdown }: { breakdown: CoverageBreakdown }) {
  const [showAllCoverages, setShowAllCoverages] = useState(false);
  const groups = coveragePreviewGroups(breakdown);
  const totalRows = breakdown.all.length;
  const visibleGroups = showAllCoverages
    ? groups
    : visibleCoveragePreviewGroups(groups, 8);
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.rows.length, 0);
  const hiddenCount = Math.max(0, totalRows - visibleCount);

  return (
    <section className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-base font-medium text-muted-foreground/60">
          Coverage schedules
        </p>
        {totalRows > 0 && (
          <span className="shrink-0 text-label text-muted-foreground/45">
            {totalRows}
          </span>
        )}
      </div>
      {totalRows > 0 ? (
        <>
          <div className="space-y-2">
            {visibleGroups.map((group) => (
              <CoveragePreviewGroupList
                key={group.key}
                group={group}
                showTitle={groups.length > 1 || group.title !== "Coverage schedules"}
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <div className="mt-2 flex justify-end">
              <PillButton
                size="compact"
                variant="secondary"
                onClick={() => setShowAllCoverages(true)}
              >
                Show {hiddenCount} more
              </PillButton>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-md border border-foreground/8 bg-card px-3 py-3 text-base text-muted-foreground">
          No coverage schedule extracted yet.
        </div>
      )}
    </section>
  );
}

function CoveragePreviewGroupList({
  group,
  showTitle,
}: {
  group: CoveragePreviewGroup;
  showTitle: boolean;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-foreground/8 bg-card text-card-foreground">
      {showTitle ? (
        <div className="border-b border-foreground/6 px-3 py-2 text-label font-medium text-muted-foreground/60">
          {group.title}
        </div>
      ) : null}
      <div className="divide-y divide-foreground/6">
        {group.rows.map((row, index) => (
          <CoverageScheduleRow
            key={`${row.name}:${row.limit ?? ""}:${index}`}
            row={row}
          />
        ))}
      </div>
    </div>
  );
}

function CoverageScheduleRow({ row }: { row: CoverageBreakdownRow }) {
  const terms = coverageTermRows(row);
  const visibleTerms = terms.length
    ? terms
    : [{ label: "Limit", value: row.limit ?? "\u2014" }];

  return (
    <section className="min-w-0 px-3 py-3">
      <div className="text-base font-medium leading-5 text-foreground [overflow-wrap:anywhere]">
        {row.name}
      </div>
      <dl className="mt-2 divide-y divide-foreground/6">
        {visibleTerms.map((term, termIndex) => (
          <div
            key={`${term.label}:${termIndex}`}
            className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,auto)] gap-3 py-1.5 first:pt-0 last:pb-0"
          >
            <dt className="min-w-0 text-base leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              {term.label}
            </dt>
            <dd className="min-w-0 text-right text-base font-medium leading-5 tabular-nums text-foreground [overflow-wrap:anywhere]">
              {term.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
