"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ArrowRight } from "lucide-react";
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

function PolicyReferenceCard({ id, page, citedSections }: { id: string; page?: number; citedSections?: string[] }) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const { openPreview } = useEntityPreview();

  if (!policy) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/8 bg-card text-body-sm">
        <span className="text-foreground/70">Loading…</span>
      </div>
    );
  }

  const carrier = policy.security || policy.carrier || "Unknown carrier";
  const policyNum = policy.policyNumber;
  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "policy", id, page, citedSections })}
      className="relative flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-foreground/8 bg-card hover:border-foreground/12 transition-all duration-150 cursor-pointer text-left group w-[260px] shrink-0 overflow-hidden"
    >
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/[0.04] transition-colors duration-150 pointer-events-none" />
      <div className="min-w-0 flex-1 space-y-0.5 relative">
        <p className="text-body-sm font-medium text-foreground leading-tight truncate !my-0">
          {carrier}
        </p>
        <p className="text-label-sm text-muted-foreground/50 truncate !my-0">
          #{policyNum}
        </p>
        {types.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5 !my-0">
            {types.slice(0, 3).map((t) => (
              <span
                key={t}
                className="inline-block px-1.5 py-px rounded text-label-sm text-muted-foreground/60 bg-foreground/[0.04] leading-tight"
              >
                {POLICY_TYPE_LABELS[t] ?? t}
              </span>
            ))}
          </div>
        )}
      </div>
      <ArrowRight className="relative w-3.5 h-3.5 text-muted-foreground/15 group-hover:text-primary/50 transition-colors shrink-0 mt-1" />
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
}: {
  refs: { type: "policy"; id: string; page?: number }[];
  citedSections?: string[];
}) {
  if (refs.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-2 ml-[38px]">
      {refs.map((ref) => (
        <PolicyReferenceCard key={`${ref.type}:${ref.id}`} id={ref.id} page={ref.page} citedSections={citedSections} />
      ))}
    </div>
  );
}
