"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { FileText } from "lucide-react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";

/** Convex document IDs are base32-encoded and always contain non-digit chars */
function isConvexId(id: string): boolean {
  return id.length > 0 && !/^\d+$/.test(id);
}

function extractIdAndType(href: string): { id: string; type: "policy"; page?: number } | null {
  const policyMatch = href.match(/^\/policies\/([a-z0-9]+)/);
  if (policyMatch && isConvexId(policyMatch[1])) {
    const page = href.match(/[?&]page=(\d+)/);
    return { id: policyMatch[1], type: "policy", page: page ? parseInt(page[1]) : undefined };
  }
  return null;
}

/** Extract all internal entity references from markdown content */
export function extractEntityRefs(content: string): { type: "policy"; id: string; page?: number }[] {
  const refs: { type: "policy"; id: string; page?: number }[] = [];
  const seen = new Set<string>();
  // Match markdown links and plain URLs
  const linkRegex = /(?:\[.*?\]\(|)(\/policies\/[a-z0-9]+(?:\?[^)\s]*)?)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const parsed = extractIdAndType(match[1]);
    if (parsed && !seen.has(`${parsed.type}:${parsed.id}`)) {
      seen.add(`${parsed.type}:${parsed.id}`);
      refs.push(parsed);
    }
  }
  return refs;
}

export function PolicyReferenceCard({
  id,
  page,
  citedSections,
  citedCoverageNames,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
}) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const { openPreview } = useEntityPreview();

  if (!policy) {
    return (
      <div className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-md border border-foreground/6 bg-card px-2 py-1.5 text-label-sm">
        <span className="text-muted-foreground/50">Loading…</span>
      </div>
    );
  }

  const administrator =
    (policy as { mga?: string }).mga || policy.carrier || policy.security || "Unknown";
  const policyNum = policy.policyNumber;
  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  const primaryType = types[0] ? (POLICY_TYPE_LABELS[types[0]] ?? types[0]) : null;

  const summaryParts = [administrator, policyNum].filter(Boolean).join(" ");
  const summary = primaryType ? `${summaryParts} — ${primaryType}` : summaryParts;

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "policy", id, page, citedSections, citedCoverageNames })}
      className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-md border border-foreground/6 bg-card px-2 py-1.5 text-left transition-colors hover:border-foreground/10 hover:bg-foreground/2"
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground/4">
        <FileText className="h-3 w-3 text-muted-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 text-[10px] font-medium leading-none text-muted-foreground/40">Policy</p>
        <p className="truncate text-label-sm leading-4 text-foreground">{summary}</p>
      </div>
    </button>
  );
}

export function PolicyCitation({
  id,
  page,
  citedSections,
  citedCoverageNames,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
}) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const { openPreview } = useEntityPreview();

  const label = policy
    ? [policy.carrier || policy.security || "Policy", policy.policyNumber].filter(Boolean).join(" ")
    : "Policy";

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "policy", id, page, citedSections, citedCoverageNames })}
      className="mx-0.5 inline-flex h-5 max-w-40 -translate-y-px items-center gap-1 rounded-full border border-foreground/8 bg-foreground/3 px-1.5 align-middle text-[10px] font-medium leading-none text-muted-foreground/65 no-underline transition-colors hover:border-foreground/12 hover:bg-foreground/5 hover:text-foreground/80"
      title={label}
    >
      <FileText className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function PolicySourcePill({
  id,
  page,
  citedSections,
  citedCoverageNames,
  index,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  index: number;
}) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const { openPreview } = useEntityPreview();

  const label = policy
    ? [policy.carrier || policy.security || "Policy", policy.policyNumber].filter(Boolean).join(" ")
    : "Policy";

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "policy", id, page, citedSections, citedCoverageNames })}
      className="inline-flex h-6 max-w-48 items-center gap-1.5 rounded-full border border-foreground/8 bg-transparent px-2 text-label-sm font-medium text-muted-foreground/60 transition-colors hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
      title={label}
    >
      <span className="text-muted-foreground/35">{index}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Renders a rich reference card — opens entity preview sidebar on click */
export function ContextReferenceCard({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const match = extractIdAndType(href);

  if (!match) {
    return (
      <a href={href} className="text-primary-light underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return <PolicyCitation id={match.id} page={match.page} />;
}

/** Standalone reference card strip — renders below agent messages */
export function ReferenceCardStrip({
  refs,
  citedSections,
  citedCoverageNames,
  rightAligned,
}: {
  refs: { type: "policy"; id: string; page?: number }[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  rightAligned?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (refs.length === 0) return null;

  if (refs.length === 1) {
    const ref = refs[0];
    return (
      <div
        className={`flex flex-wrap items-start gap-1.5 ${
          rightAligned ? "justify-end" : ""
        }`}
      >
        <PolicySourcePill
          key={`${ref.type}:${ref.id}`}
          id={ref.id}
          page={ref.page}
          citedSections={citedSections}
          citedCoverageNames={citedCoverageNames}
          index={1}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-start gap-1.5 ${
        rightAligned ? "justify-end" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        className="inline-flex h-6 items-center rounded-full border border-foreground/8 bg-transparent px-2 text-label-sm font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
      >
        {refs.length} sources
      </button>
      {isExpanded ? (
        <div className="flex flex-wrap items-start gap-1.5">
          {refs.map((ref, index) => (
            <span
              key={`${ref.type}:${ref.id}`}
              className="transition-[opacity,transform] duration-200 ease-out"
              style={{
                transitionDelay: `${Math.min(index * 25, 100)}ms`,
              }}
            >
              <PolicySourcePill
                id={ref.id}
                page={ref.page}
                citedSections={citedSections}
                citedCoverageNames={citedCoverageNames}
                index={index + 1}
              />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
