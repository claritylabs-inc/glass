"use client";

import {
  useState,
  useEffect,
  useMemo,
  Children,
  cloneElement,
  isValidElement,
} from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import dayjs from "dayjs";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { DocSection } from "./doc-section";
import { CoverageRow } from "./coverage-row";
import { buildSectionContent, matchesCitation } from "./section-utils";
import { PillButton } from "@/components/ui/pill-button";
import { useCachedPolicyDetail } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

interface DocSection {
  title: string;
  type?: string;
  pageStart?: number;
  pageEnd?: number;
  content?: string;
  subsections?: Array<{ title?: string; content?: string }>;
}

interface DocEndorsement {
  title: string;
  pageStart?: number;
  content?: string;
}

interface DocCondition {
  title?: string;
  name?: string;
  pageNumber?: number;
  content?: string;
}

interface DocExclusion {
  title?: string;
  name?: string;
  content?: string;
  description?: string;
}

interface PolicyDocument {
  sections?: DocSection[];
  endorsements?: DocEndorsement[];
  conditions?: DocCondition[];
  exclusions?: DocExclusion[];
}

interface PolicyCoverage {
  name: string;
  limit?: string;
  deductible?: string;
}

type SourceSpanDoc = {
  spanId: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  text: string;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  metadata?: Record<string, unknown>;
};

interface PolicyPreviewProps {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  onHeaderInfo?: (info: { carrier: string; policyNum?: string }) => void;
  onHeaderActions?: (actions: {
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

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function PolicyPreview({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
  onHeaderInfo,
  onHeaderActions,
}: PolicyPreviewProps) {
  const policy = useCachedPolicyDetail(id as Id<"policies">);
  const fileUrl = useCachedQuery(
    "policies.getFileUrl.preview",
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId } : "skip",
  );
  const [showAllTypes, setShowAllTypes] = useState(false);
  const citedSourceSpans = useCachedQuery(
    "sourceSpans.listSpansByPolicyAndSpanIds.preview",
    api.sourceSpans.listSpansByPolicyAndSpanIds,
    citedSourceSpanIds?.length
      ? {
          policyId: id as Id<"policies">,
          spanIds: citedSourceSpanIds,
        }
      : "skip",
  ) as SourceSpanDoc[] | undefined;

  // Notify parent of header info
  const carrier = policy?.carrier || "Unknown carrier";
  const policyNum = policy?.policyNumber;

  useEffect(() => {
    if (policy && onHeaderInfo) {
      onHeaderInfo({ carrier, policyNum });
    }
  }, [carrier, policyNum, policy, onHeaderInfo]);

  const highlightBoxes = useMemo(
    () =>
      (citedSourceSpans ?? []).flatMap((span) =>
        (span.bbox ?? []).map((box) => ({
          ...box,
          coordinateWidth: readNumber(span.metadata?.bboxCoordinateWidth ?? span.metadata?.pageWidth),
          coordinateHeight: readNumber(span.metadata?.bboxCoordinateHeight ?? span.metadata?.pageHeight),
        })),
      ),
    [citedSourceSpans],
  );
  const citedPage = page ?? highlightBoxes[0]?.page;

  useEffect(() => {
    if (fileUrl && onHeaderActions) {
      onHeaderActions({ fileUrl, policyId: id, page: citedPage, highlightBoxes });
    }
  }, [fileUrl, id, citedPage, onHeaderActions, highlightBoxes]);

  if (!policy) {
    return <div className="min-h-24" />;
  }

  const types = policy.policyTypes ?? [];
  const fileCount = (policy as { files?: unknown[] }).files?.length ?? 0;
  const doc = policy.document as PolicyDocument | undefined;

  const allSections: DocSection[] = doc?.sections ?? [];
  const allEndorsements: DocEndorsement[] = doc?.endorsements ?? [];
  const allConditions: DocCondition[] = doc?.conditions ?? [];
  const allExclusions: DocExclusion[] = doc?.exclusions ?? [];

  const hasCitations = citedSections && citedSections.length > 0;
  const hasCoverageCitations = !!(
    citedCoverageNames && citedCoverageNames.length > 0
  );

  const sections = allSections.filter((s) =>
    matchesCitation(s.title, citedSections, s.content),
  );
  const endorsements = allEndorsements.filter((e) =>
    matchesCitation(e.title, citedSections, e.content),
  );
  const conditions = allConditions.filter((c) =>
    matchesCitation(c.title ?? c.name ?? "", citedSections, c.content),
  );
  const exclusions = allExclusions.filter((ex) =>
    matchesCitation(
      ex.title ?? ex.name ?? "",
      citedSections,
      ex.content ?? ex.description,
    ),
  );

  const visibleTypes = showAllTypes ? types : types.slice(0, 2);
  const hasMoreTypes = types.length > 2;

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      {/* Summary - at top, always expanded */}
      {policy.summary && (
        <div className="min-w-0">
          <p className="wrap-break-word text-body-sm leading-relaxed text-foreground/90">
            {policy.summary}
          </p>
        </div>
      )}

      {/* Multi-file indicator */}
      {fileCount > 1 && (
        <p className="text-xs text-muted-foreground/50">
          Combined from {fileCount} files
        </p>
      )}

      {citedSourceSpans && citedSourceSpans.length > 0 && (
        <div className="min-w-0 rounded-md border border-foreground/8 bg-foreground/[0.02]">
          <div className="border-b border-foreground/6 px-3 py-2">
            <p className="text-label-sm font-medium text-foreground">
              Exact source locations
            </p>
          </div>
          <div className="divide-y divide-foreground/6">
            {citedSourceSpans.slice(0, 5).map((span) => (
              <div key={span.spanId} className="px-3 py-2">
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <span className="text-label-sm font-medium text-muted-foreground">
                    p.{span.pageStart ?? span.bbox?.[0]?.page ?? "?"}
                  </span>
                  <span className="truncate text-label-sm text-muted-foreground/50">
                    {span.sectionId ?? span.formNumber ?? (span.metadata?.elementType as string | undefined) ?? "Source span"}
                  </span>
                </div>
                <p className="line-clamp-3 text-body-sm leading-relaxed text-foreground/80">
                  {span.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Policy Details with Labels */}
      <div className="min-w-0 space-y-3">
        {/* Coverage Types */}
        {types.length > 0 && (
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground/50 mb-1.5">
              Coverage types
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {visibleTypes.map((t) => (
                <span
                  key={t}
                  className="text-body-sm px-2.5 py-1 rounded-full bg-secondary text-muted-foreground"
                >
                  {POLICY_TYPE_LABELS[t] ?? t}
                </span>
              ))}
              {hasMoreTypes && !showAllTypes && (
                <PillButton
                  size="compact"
                  variant="secondary"
                  onClick={() => setShowAllTypes(true)}
                >
                  +{types.length - 2} more
                </PillButton>
              )}
            </div>
          </div>
        )}

        {/* Policy Period */}
        {(policy.effectiveDate || policy.expirationDate) && (
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground/50 mb-1">
              Policy period
            </p>
            <p className="text-body-sm text-muted-foreground">
              {policy.effectiveDate
                ? dayjs(policy.effectiveDate).format("MMM D, YYYY")
                : "—"}
              {" — "}
              {policy.expirationDate
                ? dayjs(policy.expirationDate).format("MMM D, YYYY")
                : "—"}
            </p>
          </div>
        )}

        {/* Insured */}
        {policy.insuredName && (
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground/50 mb-1">Insured</p>
            <p className="wrap-break-word text-body-sm text-muted-foreground">
              {policy.insuredName}
            </p>
          </div>
        )}
      </div>

      {/* Coverages — filtered by citations like other sections */}
      {policy.coverages &&
        policy.coverages.length > 0 &&
        (!hasCitations || hasCoverageCitations) && (
          <CoverageGroup
            coverages={policy.coverages as PolicyCoverage[]}
            citedCoverageNames={citedCoverageNames}
          />
        )}

      {/* Document sections — grouped by type like the detail page */}
      {(sections.length > 0 || (!hasCitations && allSections.length > 0)) && (
        <SectionGroup
          label={hasCitations ? "Cited sections" : "Sections"}
          count={hasCitations ? sections.length : undefined}
          totalCount={hasCitations ? allSections.length : undefined}
          allChildren={allSections.map((s, i) => (
            <DocSection
              key={`s-${i}`}
              title={s.title}
              type={s.type}
              pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`}
              content={buildSectionContent(s)}
            />
          ))}
        >
          {sections.map((s, i) => (
            <DocSection
              key={`s-${i}`}
              title={s.title}
              type={s.type}
              pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`}
              content={buildSectionContent(s)}
              defaultOpen={hasCitations}
            />
          ))}
        </SectionGroup>
      )}

      {(endorsements.length > 0 ||
        (!hasCitations && allEndorsements.length > 0)) && (
        <SectionGroup
          label="Endorsements"
          count={hasCitations ? endorsements.length : undefined}
          totalCount={hasCitations ? allEndorsements.length : undefined}
          allChildren={allEndorsements.map((e, i) => (
            <DocSection
              key={`e-${i}`}
              title={e.title}
              type="endorsement"
              pages={e.pageStart ? `${e.pageStart}` : undefined}
              content={e.content || "No content extracted"}
            />
          ))}
        >
          {endorsements.map((e, i) => (
            <DocSection
              key={`e-${i}`}
              title={e.title}
              type="endorsement"
              pages={e.pageStart ? `${e.pageStart}` : undefined}
              content={e.content || "No content extracted"}
              defaultOpen={hasCitations}
            />
          ))}
        </SectionGroup>
      )}

      {(conditions.length > 0 ||
        (!hasCitations && allConditions.length > 0)) && (
        <SectionGroup
          label="Conditions"
          count={hasCitations ? conditions.length : undefined}
          totalCount={hasCitations ? allConditions.length : undefined}
          allChildren={allConditions.map((c, i) => (
            <DocSection
              key={`c-${i}`}
              title={c.title || c.name || "Condition"}
              type="condition"
              pages={c.pageNumber ? `${c.pageNumber}` : undefined}
              content={c.content || "No content extracted"}
            />
          ))}
        >
          {conditions.map((c, i) => (
            <DocSection
              key={`c-${i}`}
              title={c.title || c.name || "Condition"}
              type="condition"
              pages={c.pageNumber ? `${c.pageNumber}` : undefined}
              content={c.content || "No content extracted"}
              defaultOpen={hasCitations}
            />
          ))}
        </SectionGroup>
      )}

      {(exclusions.length > 0 ||
        (!hasCitations && allExclusions.length > 0)) && (
        <SectionGroup
          label="Exclusions"
          count={hasCitations ? exclusions.length : undefined}
          totalCount={hasCitations ? allExclusions.length : undefined}
          allChildren={allExclusions.map((ex, i) => (
            <DocSection
              key={`ex-${i}`}
              title={ex.title || ex.name || "Exclusion"}
              type="exclusion"
              content={ex.content || ex.description || "No content extracted"}
            />
          ))}
        >
          {exclusions.map((ex, i) => (
            <DocSection
              key={`ex-${i}`}
              title={ex.title || ex.name || "Exclusion"}
              type="exclusion"
              content={ex.content || ex.description || "No content extracted"}
              defaultOpen={hasCitations}
            />
          ))}
        </SectionGroup>
      )}
    </div>
  );
}

function CoverageGroup({
  coverages,
  citedCoverageNames,
}: {
  coverages: PolicyCoverage[];
  citedCoverageNames?: string[];
}) {
  const [showAll, setShowAll] = useState(false);
  const hasCoverageCitations = !!(
    citedCoverageNames && citedCoverageNames.length > 0
  );

  const cited = hasCoverageCitations
    ? coverages.filter((c) => matchesCitation(c.name, citedCoverageNames))
    : coverages;
  const hasMore = hasCoverageCitations && cited.length < coverages.length;
  const visible = showAll ? coverages : cited;
  const visibleWithNames = visible.map((cov, index) => {
    const trimmedName = cov.name?.trim();
    if (trimmedName) return cov;

    const previousNamed = visible
      .slice(0, index)
      .findLast((candidate) => candidate.name?.trim());

    return {
      ...cov,
      name: previousNamed?.name?.trim() || "Coverage",
    };
  });

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-body-sm font-medium text-muted-foreground/60">
          Coverages
          {hasMore && (
            <span className="text-muted-foreground/40 font-normal ml-1">
              {cited.length} of {coverages.length}
            </span>
          )}
        </p>
      </div>
      <div className="min-w-0 divide-y divide-foreground/6 overflow-hidden rounded-lg border border-foreground/8 bg-card text-card-foreground">
        {visibleWithNames.map((cov, i) => (
          <CoverageRow
            key={i}
            name={cov.name}
            limit={cov.limit}
            deductible={cov.deductible}
          />
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="text-body-sm text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors pl-1 mt-1.5"
        >
          {showAll
            ? "Only show cited"
            : `Show all ${coverages.length} coverages`}
        </button>
      )}
    </div>
  );
}

function SectionGroup({
  label,
  count,
  totalCount,
  children,
  allChildren,
}: {
  label: string;
  count?: number;
  totalCount?: number;
  children: React.ReactNode;
  allChildren?: React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const [forceOpen, setForceOpen] = useState<boolean | undefined>(undefined);
  const hasMore = count != null && totalCount != null && totalCount > count;
  const visibleChildren = showAll ? allChildren : children;

  const withForceOpen =
    forceOpen !== undefined
      ? Children.map(visibleChildren, (child) =>
          isValidElement(child)
            ? cloneElement(
                child as React.ReactElement<{ forceOpen?: boolean }>,
                { forceOpen },
              )
            : child,
        )
      : visibleChildren;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-body-sm font-medium text-muted-foreground/60">
          {label}
          {hasMore && (
            <span className="text-muted-foreground/40 font-normal ml-1">
              {count} of {totalCount}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setForceOpen(forceOpen === true ? false : true)}
          className="shrink-0 text-body-sm text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
        >
          {forceOpen === true ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="space-y-1.5">
        {withForceOpen}
        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-body-sm text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors pl-1"
          >
            {showAll
              ? "Only show cited"
              : `Show all ${totalCount} ${label.toLowerCase()}`}
          </button>
        )}
      </div>
    </div>
  );
}
