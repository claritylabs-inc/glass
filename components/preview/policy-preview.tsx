"use client";

import { useState, useEffect, Children, cloneElement, isValidElement } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Loader2 } from "lucide-react";
import dayjs from "dayjs";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { DocSection } from "./doc-section";
import { CoverageRow } from "./coverage-row";
import { buildSectionContent, matchesCitation } from "./section-utils";
import { PillButton } from "@/components/ui/pill-button";

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

interface PolicyPreviewProps {
  id: string;
  page?: number;
  citedSections?: string[];
  onHeaderInfo?: (info: { carrier: string; policyNum?: string }) => void;
  onHeaderActions?: (actions: { fileUrl?: string; policyId: string; page?: number }) => void;
}

export function PolicyPreview({ id, page, citedSections, onHeaderInfo, onHeaderActions }: PolicyPreviewProps) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId } : "skip",
  );
  const [showAllTypes, setShowAllTypes] = useState(false);

  // Notify parent of header info
  const carrier = policy?.carrier || "Unknown carrier";
  const policyNum = policy?.policyNumber;

  useEffect(() => {
    if (policy && onHeaderInfo) {
      onHeaderInfo({ carrier, policyNum });
    }
  }, [carrier, policyNum, policy, onHeaderInfo]);

  useEffect(() => {
    if (fileUrl && onHeaderActions) {
      onHeaderActions({ fileUrl, policyId: id, page });
    }
  }, [fileUrl, id, page, onHeaderActions]);

  if (!policy) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  const fileCount = (policy as { files?: unknown[] }).files?.length ?? 0;
  const doc = policy.document as PolicyDocument | undefined;

  const allSections: DocSection[] = doc?.sections ?? [];
  const allEndorsements: DocEndorsement[] = doc?.endorsements ?? [];
  const allConditions: DocCondition[] = doc?.conditions ?? [];
  const allExclusions: DocExclusion[] = doc?.exclusions ?? [];

  const hasCitations = citedSections && citedSections.length > 0;

  const sections = allSections.filter((s) => matchesCitation(s.title, citedSections, s.content));
  const endorsements = allEndorsements.filter((e) => matchesCitation(e.title, citedSections, e.content));
  const conditions = allConditions.filter((c) => matchesCitation(c.title ?? c.name ?? "", citedSections, c.content));
  const exclusions = allExclusions.filter((ex) => matchesCitation(ex.title ?? ex.name ?? "", citedSections, ex.content ?? ex.description));

  const visibleTypes = showAllTypes ? types : types.slice(0, 2);
  const hasMoreTypes = types.length > 2;

  return (
    <div className="space-y-5">
      {/* Summary - at top, always expanded */}
      {policy.summary && (
        <div>
          <p className="text-body-sm text-foreground/90 leading-relaxed">{policy.summary}</p>
        </div>
      )}

      {/* Multi-file indicator */}
      {fileCount > 1 && (
        <p className="text-xs text-muted-foreground/50">Combined from {fileCount} files</p>
      )}

      {/* Policy Details with Labels */}
      <div className="space-y-3">
        {/* Coverage Types */}
        {types.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground/50 mb-1.5">Coverage types</p>
            <div className="flex flex-wrap items-center gap-2">
              {visibleTypes.map((t) => (
                <span key={t} className="text-body-sm px-2.5 py-1 rounded-full bg-secondary text-muted-foreground">
                  {POLICY_TYPE_LABELS[t] ?? t}
                </span>
              ))}
              {hasMoreTypes && !showAllTypes && (
                <PillButton size="compact" variant="secondary" onClick={() => setShowAllTypes(true)}>
                  +{types.length - 2} more
                </PillButton>
              )}
            </div>
          </div>
        )}

        {/* Policy Period */}
        {(policy.effectiveDate || policy.expirationDate) && (
          <div>
            <p className="text-xs text-muted-foreground/50 mb-1">Policy period</p>
            <p className="text-body-sm text-muted-foreground">
              {policy.effectiveDate ? dayjs(policy.effectiveDate).format("MMM D, YYYY") : "—"}
              {" — "}
              {policy.expirationDate ? dayjs(policy.expirationDate).format("MMM D, YYYY") : "—"}
            </p>
          </div>
        )}

        {/* Insured */}
        {policy.insuredName && (
          <div>
            <p className="text-xs text-muted-foreground/50 mb-1">Insured</p>
            <p className="text-body-sm text-muted-foreground">
              {policy.insuredName}
            </p>
          </div>
        )}
      </div>

      {/* Coverages - always expanded, show all */}
      {policy.coverages && policy.coverages.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground/50 mb-2">Coverages</p>
          <div className="space-y-1.5">
            {policy.coverages.map((cov: PolicyCoverage, i: number) => (
              <CoverageRow key={i} name={cov.name} limit={cov.limit} deductible={cov.deductible} />
            ))}
          </div>
        </div>
      )}

      {/* Document sections — grouped by type like the detail page */}
      {(sections.length > 0 || (!hasCitations && allSections.length > 0)) && (
        <SectionGroup
          label={hasCitations ? "Cited sections" : "Sections"}
          count={hasCitations ? sections.length : undefined}
          totalCount={hasCitations ? allSections.length : undefined}
          allChildren={allSections.map((s, i) => (
            <DocSection key={`s-${i}`} title={s.title} type={s.type} pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`} content={buildSectionContent(s)} />
          ))}
        >
          {sections.map((s, i) => (
            <DocSection key={`s-${i}`} title={s.title} type={s.type} pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`} content={buildSectionContent(s)} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}

      {(endorsements.length > 0 || (!hasCitations && allEndorsements.length > 0)) && (
        <SectionGroup
          label="Endorsements"
          count={hasCitations ? endorsements.length : undefined}
          totalCount={hasCitations ? allEndorsements.length : undefined}
          allChildren={allEndorsements.map((e, i) => (
            <DocSection key={`e-${i}`} title={e.title} type="endorsement" pages={e.pageStart ? `${e.pageStart}` : undefined} content={e.content || "No content extracted"} />
          ))}
        >
          {endorsements.map((e, i) => (
            <DocSection key={`e-${i}`} title={e.title} type="endorsement" pages={e.pageStart ? `${e.pageStart}` : undefined} content={e.content || "No content extracted"} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}

      {(conditions.length > 0 || (!hasCitations && allConditions.length > 0)) && (
        <SectionGroup
          label="Conditions"
          count={hasCitations ? conditions.length : undefined}
          totalCount={hasCitations ? allConditions.length : undefined}
          allChildren={allConditions.map((c, i) => (
            <DocSection key={`c-${i}`} title={c.title || c.name || "Condition"} type="condition" pages={c.pageNumber ? `${c.pageNumber}` : undefined} content={c.content || "No content extracted"} />
          ))}
        >
          {conditions.map((c, i) => (
            <DocSection key={`c-${i}`} title={c.title || c.name || "Condition"} type="condition" pages={c.pageNumber ? `${c.pageNumber}` : undefined} content={c.content || "No content extracted"} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}

      {(exclusions.length > 0 || (!hasCitations && allExclusions.length > 0)) && (
        <SectionGroup
          label="Exclusions"
          count={hasCitations ? exclusions.length : undefined}
          totalCount={hasCitations ? allExclusions.length : undefined}
          allChildren={allExclusions.map((ex, i) => (
            <DocSection key={`ex-${i}`} title={ex.title || ex.name || "Exclusion"} type="exclusion" content={ex.content || ex.description || "No content extracted"} />
          ))}
        >
          {exclusions.map((ex, i) => (
            <DocSection key={`ex-${i}`} title={ex.title || ex.name || "Exclusion"} type="exclusion" content={ex.content || ex.description || "No content extracted"} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}
    </div>
  );
}

function SectionGroup({ label, count, totalCount, children, allChildren }: {
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

  const withForceOpen = forceOpen !== undefined
    ? Children.map(visibleChildren, (child) =>
        isValidElement(child) ? cloneElement(child as React.ReactElement<{ forceOpen?: boolean }>, { forceOpen }) : child
      )
    : visibleChildren;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-body-sm font-medium text-muted-foreground/60">
          {label}
          {hasMore && (
            <span className="text-muted-foreground/40 font-normal ml-1">{count} of {totalCount}</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setForceOpen(forceOpen === true ? false : true)}
          className="text-body-sm text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer"
        >
          {forceOpen === true ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="space-y-1.5">
        {withForceOpen}
        {hasMore && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-body-sm text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors cursor-pointer pl-1">
            {showAll ? "Only show cited" : `Show all ${totalCount} ${label.toLowerCase()}`}
          </button>
        )}
      </div>
    </div>
  );
}
