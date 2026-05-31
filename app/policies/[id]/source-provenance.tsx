"use client";

import { useMemo } from "react";
import { LocateFixed } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf, type PdfHighlightBox } from "@/components/pdf-context";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export type SourceSpanDoc = {
  spanId: string;
  pageStart?: number;
  pageEnd?: number;
  text?: string;
  bbox?: Array<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  metadata?: Record<string, unknown>;
};

export function sourceSpanIdsFrom(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { sourceSpanIds?: unknown }).sourceSpanIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

export function collectSourceSpanIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    for (const id of sourceSpanIdsFrom(item)) ids.add(id);
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    for (const child of Object.values(item as Record<string, unknown>))
      visit(child);
  };
  visit(value);
  return [...ids];
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function relatedParentId(span: SourceSpanDoc): string | undefined {
  const metadata = span.metadata ?? {};
  const parent = metadata.parentSpanId ?? metadata.rowSpanId;
  return typeof parent === "string" && parent.length > 0 ? parent : undefined;
}

function sourceUnit(span: SourceSpanDoc): string | undefined {
  const value = span.metadata?.sourceUnit ?? span.metadata?.elementType;
  return typeof value === "string" ? value : undefined;
}

export function usePolicySourceSpans(
  policyId: Id<"policies"> | undefined,
  sourceSpanIds: string[],
) {
  const uniqueIds = useMemo(
    () => [...new Set(sourceSpanIds)].sort(),
    [sourceSpanIds],
  );
  return useCachedQuery(
    "sourceSpans.listSpansByPolicyAndSpanIds.policy-detail",
    api.sourceSpans.listSpansByPolicyAndSpanIds,
    policyId && uniqueIds.length > 0
      ? { policyId, spanIds: uniqueIds }
      : "skip",
  ) as SourceSpanDoc[] | undefined;
}

export function evidenceSpansForIds(
  spans: SourceSpanDoc[] | undefined,
  sourceSpanIds: string[],
) {
  if (!spans?.length || sourceSpanIds.length === 0) return [];
  const requested = new Set(sourceSpanIds);
  const direct = spans.filter((span) => requested.has(span.spanId));
  const parentIds = new Set(
    direct.map(relatedParentId).filter((id): id is string => Boolean(id)),
  );
  const parentRows = spans.filter((span) => parentIds.has(span.spanId));
  if (parentRows.length > 0) return parentRows;

  const exactNonPage = direct.filter((span) => sourceUnit(span) !== "page");
  return exactNonPage.length > 0 ? exactNonPage : direct;
}

export function highlightBoxesForSpans(
  spans: SourceSpanDoc[],
): PdfHighlightBox[] {
  return spans.flatMap((span) =>
    (span.bbox ?? []).map((box) => ({
      ...box,
      coordinateWidth: readNumber(
        span.metadata?.bboxCoordinateWidth ?? span.metadata?.pageWidth,
      ),
      coordinateHeight: readNumber(
        span.metadata?.bboxCoordinateHeight ?? span.metadata?.pageHeight,
      ),
    })),
  );
}

export function firstEvidencePage(
  spans: SourceSpanDoc[],
  fallbackPage?: number,
) {
  return (
    spans.find((span) => typeof span.pageStart === "number")?.pageStart ??
    spans
      .flatMap((span) => span.bbox ?? [])
      .find((box) => typeof box.page === "number")?.page ??
    fallbackPage
  );
}

export function SourceEvidenceButton({
  sourceSpanIds,
  sourceSpans,
  fallbackPage,
  label = "Source",
  className = "",
}: {
  sourceSpanIds?: string[];
  sourceSpans?: SourceSpanDoc[];
  fallbackPage?: number;
  label?: string;
  className?: string;
}) {
  const pdf = usePdf();
  const evidenceSpans = evidenceSpansForIds(sourceSpans, sourceSpanIds ?? []);
  const page = firstEvidencePage(evidenceSpans, fallbackPage);
  const highlightBoxes = highlightBoxesForSpans(evidenceSpans);

  if (
    !pdf.fileUrl ||
    page == null ||
    (!sourceSpanIds?.length && highlightBoxes.length === 0)
  )
    return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (highlightBoxes.length > 0) {
          pdf.openWithUrl(pdf.fileUrl!, page, highlightBoxes);
        } else {
          pdf.navigateToPage(page);
        }
      }}
      className={`inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300 ${className}`}
      title={
        highlightBoxes.length > 0
          ? `Highlight source on page ${page}`
          : `Open page ${page}`
      }
    >
      <LocateFixed className="size-3" />
      {label} p.{page}
    </button>
  );
}
