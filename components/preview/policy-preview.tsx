"use client";

import { useState, Children, cloneElement, isValidElement } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf } from "@/components/pdf-context";
import { ExternalLink, FileText, Calendar, Shield, Loader2 } from "lucide-react";
import dayjs from "dayjs";
import Link from "next/link";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { DocSection } from "./doc-section";
import { CollapsibleBlock } from "./collapsible-block";
import { CoverageRow } from "./coverage-row";
import { buildSectionContent, matchesCitation } from "./section-utils";

export function PolicyPreview({ id, page, citedSections }: { id: string; page?: number; citedSections?: string[] }) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId } : "skip",
  );
  const { openWithUrl } = usePdf();
  const { closePreview } = useEntityPreview();

  if (!policy) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const carrier = policy.security || policy.carrier || "Unknown carrier";
  const policyNum = policy.policyNumber;
  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  const isQuoteDoc = policy.documentType === "quote";
  const doc = policy.document as any;

  const allSections = doc?.sections ?? [];
  const allEndorsements = doc?.endorsements ?? [];
  const allConditions = doc?.conditions ?? [];
  const allExclusions = doc?.exclusions ?? [];

  const hasCitations = citedSections && citedSections.length > 0;

  const sections = allSections.filter((s: any) => matchesCitation(s.title, citedSections, s.content));
  const endorsements = allEndorsements.filter((e: any) => matchesCitation(e.title, citedSections, e.content));
  const conditions = allConditions.filter((c: any) => matchesCitation(c.title, citedSections, c.content));
  const exclusions = allExclusions.filter((ex: any) => matchesCitation(ex.title, citedSections, ex.content ?? ex.description));

  const citedCount = sections.length + endorsements.length + conditions.length + exclusions.length;
  const totalCount = allSections.length + allEndorsements.length + allConditions.length + allExclusions.length;
  const hasSections = citedCount > 0 || totalCount > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider">
              {isQuoteDoc ? "Quote" : "Policy"}
            </p>
            <h3 className="text-sm font-semibold text-foreground leading-tight mt-0.5">{carrier}</h3>
            {policyNum && (
              <p className="text-label text-muted-foreground/50 font-mono mt-0.5">#{policyNum}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {types.map((t) => (
            <span key={t} className="text-label-sm px-1.5 py-px rounded bg-foreground/[0.04] text-muted-foreground/50">
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
          {(policy.effectiveDate || policy.expirationDate) && (
            <>
              {types.length > 0 && <span className="text-muted-foreground/15">|</span>}
              <span className="text-label-sm text-muted-foreground/40 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />
                {policy.effectiveDate ? dayjs(policy.effectiveDate).format("MMM D, YYYY") : "—"}
                {" — "}
                {policy.expirationDate ? dayjs(policy.expirationDate).format("MMM D, YYYY") : "—"}
              </span>
            </>
          )}
        </div>
        {policy.insuredName && (
          <div className="flex items-center gap-1.5 mt-1.5 text-label-sm text-muted-foreground/40">
            <Shield className="w-2.5 h-2.5" />
            <span>{policy.insuredName}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {fileUrl && (
          <button
            type="button"
            onClick={() => { openWithUrl(fileUrl, page); closePreview(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-label font-medium cursor-pointer"
          >
            <FileText className="w-3 h-3 text-muted-foreground/50" />
            View PDF
          </button>
        )}
        <Link
          href={`/policies/${id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-label font-medium no-underline"
        >
          <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
          Full details
        </Link>
      </div>

      {/* Document sections — grouped by type like the detail page */}
      {(sections.length > 0 || (!hasCitations && allSections.length > 0)) && (
        <SectionGroup
          label={hasCitations ? "Cited sections" : "Sections"}
          count={hasCitations ? sections.length : undefined}
          totalCount={hasCitations ? allSections.length : undefined}
          allChildren={allSections.map((s: any, i: number) => (
            <DocSection key={`s-${i}`} title={s.title} type={s.type} pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`} content={buildSectionContent(s)} />
          ))}
        >
          {sections.map((s: any, i: number) => (
            <DocSection key={`s-${i}`} title={s.title} type={s.type} pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`} content={buildSectionContent(s)} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}

      {(endorsements.length > 0 || (!hasCitations && allEndorsements.length > 0)) && (
        <SectionGroup
          label="Endorsements"
          count={hasCitations ? endorsements.length : undefined}
          totalCount={hasCitations ? allEndorsements.length : undefined}
          allChildren={allEndorsements.map((e: any, i: number) => (
            <DocSection key={`e-${i}`} title={e.title} type="endorsement" pages={e.pageStart ? `${e.pageStart}` : undefined} content={e.content || "No content extracted"} />
          ))}
        >
          {endorsements.map((e: any, i: number) => (
            <DocSection key={`e-${i}`} title={e.title} type="endorsement" pages={e.pageStart ? `${e.pageStart}` : undefined} content={e.content || "No content extracted"} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}

      {(conditions.length > 0 || (!hasCitations && allConditions.length > 0)) && (
        <SectionGroup
          label="Conditions"
          count={hasCitations ? conditions.length : undefined}
          totalCount={hasCitations ? allConditions.length : undefined}
          allChildren={allConditions.map((c: any, i: number) => (
            <DocSection key={`c-${i}`} title={c.title || c.name || "Condition"} type="condition" pages={c.pageNumber ? `${c.pageNumber}` : undefined} content={c.content || "No content extracted"} />
          ))}
        >
          {conditions.map((c: any, i: number) => (
            <DocSection key={`c-${i}`} title={c.title || c.name || "Condition"} type="condition" pages={c.pageNumber ? `${c.pageNumber}` : undefined} content={c.content || "No content extracted"} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}

      {(exclusions.length > 0 || (!hasCitations && allExclusions.length > 0)) && (
        <SectionGroup
          label="Exclusions"
          count={hasCitations ? exclusions.length : undefined}
          totalCount={hasCitations ? allExclusions.length : undefined}
          allChildren={allExclusions.map((ex: any, i: number) => (
            <DocSection key={`ex-${i}`} title={ex.title || ex.name || "Exclusion"} type="exclusion" content={ex.content || ex.description || "No content extracted"} />
          ))}
        >
          {exclusions.map((ex: any, i: number) => (
            <DocSection key={`ex-${i}`} title={ex.title || ex.name || "Exclusion"} type="exclusion" content={ex.content || ex.description || "No content extracted"} defaultOpen={hasCitations} />
          ))}
        </SectionGroup>
      )}

      {/* Coverages */}
      {policy.coverages && policy.coverages.length > 0 && (
        <CollapsibleBlock title="Coverages" count={policy.coverages.length}>
          <div className="space-y-1">
            {policy.coverages.slice(0, 10).map((cov: any, i: number) => (
              <CoverageRow key={i} name={cov.name} limit={cov.limit} deductible={cov.deductible} />
            ))}
            {policy.coverages.length > 10 && (
              <p className="text-label-sm text-muted-foreground/30 pl-2">+{policy.coverages.length - 10} more</p>
            )}
          </div>
        </CollapsibleBlock>
      )}

      {/* Summary */}
      {policy.summary && (
        <CollapsibleBlock title="Summary">
          <p className="text-label-sm text-muted-foreground/60 leading-relaxed">{policy.summary}</p>
        </CollapsibleBlock>
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
        isValidElement(child) ? cloneElement(child as React.ReactElement<any>, { forceOpen }) : child
      )
    : visibleChildren;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider">
          {label}
          {hasMore && (
            <span className="text-muted-foreground/25 font-normal ml-1">{count} of {totalCount}</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setForceOpen(forceOpen === true ? false : true)}
          className="text-label-sm text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors cursor-pointer"
        >
          {forceOpen === true ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="space-y-1.5">
        {withForceOpen}
        {hasMore && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer pl-1">
            {showAll ? "Only show cited" : `Show all ${totalCount} ${label.toLowerCase()}`}
          </button>
        )}
      </div>
    </div>
  );
}
