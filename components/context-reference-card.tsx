"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ArrowRight, FileText, ClipboardList } from "lucide-react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";

function extractIdAndType(href: string): { id: string; type: "policy" | "quote"; page?: number } | null {
  const policyMatch = href.match(/^\/policies\/([a-z0-9]+)/);
  if (policyMatch) {
    const page = href.match(/[?&]page=(\d+)/);
    return { id: policyMatch[1], type: "policy", page: page ? parseInt(page[1]) : undefined };
  }
  const quoteMatch = href.match(/^\/quotes\/([a-z0-9]+)/);
  if (quoteMatch) {
    const page = href.match(/[?&]page=(\d+)/);
    return { id: quoteMatch[1], type: "quote", page: page ? parseInt(page[1]) : undefined };
  }
  return null;
}

/** Extract all internal entity references from markdown content */
export function extractEntityRefs(content: string): { type: "policy" | "quote"; id: string; page?: number }[] {
  const refs: { type: "policy" | "quote"; id: string; page?: number }[] = [];
  const seen = new Set<string>();
  // Match markdown links and plain URLs
  const linkRegex = /(?:\[.*?\]\(|)(\/(?:policies|quotes)\/[a-z0-9]+(?:\?[^)\s]*)?)/g;
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
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] text-body-sm">
        <span className="text-foreground/70">Loading…</span>
      </div>
    );
  }

  const carrier = policy.security || policy.carrier || "Unknown carrier";
  const policyNum = policy.policyNumber;
  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  const isQuoteDoc = policy.documentType === "quote";

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "policy", id, page, citedSections })}
      className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] hover:border-foreground/12 transition-colors cursor-pointer text-left group w-[260px] shrink-0"
    >
      <div className="w-7 h-7 rounded-md bg-foreground/[0.04] flex items-center justify-center shrink-0 mt-0.5">
        {isQuoteDoc ? (
          <ClipboardList className="w-3.5 h-3.5 text-muted-foreground/40" />
        ) : (
          <FileText className="w-3.5 h-3.5 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
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
      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/15 group-hover:text-muted-foreground/40 transition-colors shrink-0 mt-1" />
    </button>
  );
}

function QuoteReferenceCard({ id, page, citedSections }: { id: string; page?: number; citedSections?: string[] }) {
  const quote = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const { openPreview } = useEntityPreview();

  if (!quote) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] text-body-sm">
        <span className="text-foreground/70">Loading…</span>
      </div>
    );
  }

  const carrier = quote.security || quote.carrier || "Unknown carrier";
  const quoteNum = (quote as any).quoteNumber ?? quote.policyNumber;
  const types = quote.policyTypes ?? [];

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "quote", id, page, citedSections })}
      className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] hover:border-foreground/12 transition-colors cursor-pointer text-left group w-[260px] shrink-0"
    >
      <div className="w-7 h-7 rounded-md bg-foreground/[0.04] flex items-center justify-center shrink-0 mt-0.5">
        <ClipboardList className="w-3.5 h-3.5 text-muted-foreground/40" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-body-sm font-medium text-foreground leading-tight truncate !my-0">
          {carrier}
        </p>
        <p className="text-label-sm text-muted-foreground/50 truncate !my-0">
          #{quoteNum}
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
      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/15 group-hover:text-muted-foreground/40 transition-colors shrink-0 mt-1" />
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
      <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  if (match.type === "quote") {
    return <QuoteReferenceCard id={match.id} page={match.page} />;
  }

  return <PolicyReferenceCard id={match.id} page={match.page} />;
}

/** Standalone reference card strip — renders below agent messages */
export function ReferenceCardStrip({
  refs,
  citedSections,
}: {
  refs: { type: "policy" | "quote"; id: string; page?: number }[];
  citedSections?: string[];
}) {
  if (refs.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-2 ml-[38px]">
      {refs.map((ref) =>
        ref.type === "quote" ? (
          <QuoteReferenceCard key={`${ref.type}:${ref.id}`} id={ref.id} page={ref.page} citedSections={citedSections} />
        ) : (
          <PolicyReferenceCard key={`${ref.type}:${ref.id}`} id={ref.id} page={ref.page} citedSections={citedSections} />
        ),
      )}
    </div>
  );
}
