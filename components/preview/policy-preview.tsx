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
import { CoverageRow } from "./coverage-row";

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

function coverageTerms(row: CoverageBreakdownRow) {
  const terms = row.limits
    ?.map((term) => {
      const label = realText(term.label);
      const value = realText(term.value);
      if (!label || !value) return undefined;
      return `${label} ${value}`;
    })
    .filter((term): term is string => Boolean(term));

  if (terms?.length) return terms;
  return row.limit ? [`Limit ${row.limit}`] : [];
}

function coveragePrimaryLimit(row: CoverageBreakdownRow) {
  const terms = coverageTerms(row);
  return terms.length ? terms.slice(0, 2).join(" / ") : undefined;
}

function coverageDetailItems(row: CoverageBreakdownRow) {
  return [
    ...coverageTerms(row).slice(2),
    row.deductible ? `Deductible ${row.deductible}` : undefined,
    row.premium ? `Premium ${row.premium}` : undefined,
    row.retroactiveDate ? `Retroactive ${row.retroactiveDate}` : undefined,
    [row.formNumber, row.sectionRef].filter(Boolean).join(" | ") || undefined,
  ].filter((item): item is string => Boolean(item));
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

      <CoverageListPreview rows={coverageBreakdown.all} />
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

function CoverageListPreview({ rows }: { rows: CoverageBreakdownRow[] }) {
  const [showAllCoverages, setShowAllCoverages] = useState(false);
  const visibleRows = showAllCoverages ? rows : rows.slice(0, 8);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);

  return (
    <section className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-base font-medium text-muted-foreground/60">
          Coverage schedules
        </p>
        {rows.length > 0 && (
          <span className="shrink-0 text-label text-muted-foreground/45">
            {rows.length}
          </span>
        )}
      </div>
      {rows.length > 0 ? (
        <>
          <div className="min-w-0 divide-y divide-foreground/6 overflow-hidden rounded-md border border-foreground/8 bg-card text-card-foreground">
            {visibleRows.map((row, index) => (
              <CoverageScheduleRow
                key={`${row.name}:${row.limit ?? ""}:${index}`}
                row={row}
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

function CoverageScheduleRow({ row }: { row: CoverageBreakdownRow }) {
  const details = coverageDetailItems(row);

  return (
    <div className="min-w-0">
      <CoverageRow name={row.name} limit={coveragePrimaryLimit(row)} />
      {details.length > 0 && (
        <p className="-mt-1 px-3 pb-2 text-label leading-5 text-muted-foreground/55 [overflow-wrap:anywhere]">
          {details.join(" | ")}
        </p>
      )}
    </div>
  );
}
