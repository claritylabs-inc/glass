"use client";

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
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/6 bg-card text-label-sm max-w-sm">
        <span className="text-muted-foreground/50">Loading…</span>
      </div>
    );
  }

  const carrier = policy.security || policy.carrier || "Unknown carrier";
  const policyNum = policy.policyNumber;
  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  const primaryType = types[0] ? (POLICY_TYPE_LABELS[types[0]] ?? types[0]) : null;

  const summaryParts = [carrier, policyNum].filter(Boolean).join(" ");
  const summary = primaryType ? `${summaryParts} — ${primaryType}` : summaryParts;

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "policy", id, page, citedSections, citedCoverageNames })}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/6 bg-card hover:bg-foreground/[0.02] hover:border-foreground/10 transition-colors text-left max-w-sm cursor-pointer"
    >
      <div className="w-6 h-6 rounded-md bg-foreground/[0.04] flex items-center justify-center shrink-0">
        <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-label-sm text-muted-foreground/40 font-medium leading-none mb-0.5">Policy</p>
        <p className="text-label-sm text-foreground truncate">{summary}</p>
      </div>
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

  return <PolicyReferenceCard id={match.id} page={match.page} />;
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
  if (refs.length === 0) return null;

  return (
    <div
      className={`flex gap-2 flex-wrap mt-2 ${
        rightAligned ? "mr-[38px] justify-end" : "ml-[38px]"
      }`}
    >
      {refs.map((ref) => (
        <PolicyReferenceCard key={`${ref.type}:${ref.id}`} id={ref.id} page={ref.page} citedSections={citedSections} citedCoverageNames={citedCoverageNames} />
      ))}
    </div>
  );
}
