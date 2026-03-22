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

function PolicyReferenceCard({ id, page }: { id: string; page?: number }) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const { openPreview } = useEntityPreview();

  if (!policy) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] text-body-sm">
        <span className="text-foreground/70">Loading…</span>
      </div>
    );
  }

  const carrier = policy.carrier ?? "Unknown carrier";
  const policyNum = policy.policyNumber;
  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  const isQuoteDoc = policy.documentType === "quote";

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "policy", id, page })}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.02] hover:border-foreground/12 transition-colors cursor-pointer text-left group max-w-[320px] shrink-0"
    >
      <div className="w-8 h-8 rounded-md bg-foreground/[0.04] flex items-center justify-center shrink-0">
        {isQuoteDoc ? (
          <ClipboardList className="w-4 h-4 text-muted-foreground/50" />
        ) : (
          <FileText className="w-4 h-4 text-muted-foreground/50" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-foreground truncate !my-0">
          {carrier}
        </p>
        <div className="flex items-center gap-1.5 !my-0">
          {policyNum && (
            <span className="text-[11px] text-muted-foreground/50 truncate">{policyNum}</span>
          )}
          {types.length > 0 && policyNum && (
            <span className="text-muted-foreground/20">·</span>
          )}
          {types.slice(0, 2).map((t) => (
            <span key={t} className="text-[10px] text-muted-foreground/50">
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
        </div>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors shrink-0" />
    </button>
  );
}

function QuoteReferenceCard({ id, page }: { id: string; page?: number }) {
  const quote = useQuery(api.quotes.get, { id: id as Id<"quotes"> });
  const { openPreview } = useEntityPreview();

  if (!quote) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] text-body-sm">
        <span className="text-foreground/70">Loading…</span>
      </div>
    );
  }

  const carrier = quote.carrier ?? "Unknown carrier";
  const quoteNum = quote.quoteNumber;
  const types = quote.policyTypes ?? [];

  return (
    <button
      type="button"
      onClick={() => openPreview({ type: "quote", id, page })}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.02] hover:border-foreground/12 transition-colors cursor-pointer text-left group max-w-[320px] shrink-0"
    >
      <div className="w-8 h-8 rounded-md bg-foreground/[0.04] flex items-center justify-center shrink-0">
        <ClipboardList className="w-4 h-4 text-muted-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-foreground truncate !my-0">
          {carrier}
        </p>
        <div className="flex items-center gap-1.5 !my-0">
          {quoteNum && (
            <span className="text-[11px] text-muted-foreground/50 truncate">{quoteNum}</span>
          )}
          {types.length > 0 && quoteNum && (
            <span className="text-muted-foreground/20">·</span>
          )}
          {types.slice(0, 2).map((t) => (
            <span key={t} className="text-[10px] text-muted-foreground/50">
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
        </div>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors shrink-0" />
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
export function ReferenceCardStrip({ refs }: { refs: { type: "policy" | "quote"; id: string; page?: number }[] }) {
  if (refs.length === 0) return null;

  return (
    <div
      className="flex gap-2 overflow-x-auto scrollbar-hide mt-2 ml-9 -mx-2 px-2"
      style={{ maskImage: "linear-gradient(to right, transparent, black 16px, black calc(100% - 24px), transparent)", WebkitMaskImage: "linear-gradient(to right, transparent, black 16px, black calc(100% - 24px), transparent)" }}
    >
      {refs.map((ref) =>
        ref.type === "quote" ? (
          <QuoteReferenceCard key={`${ref.type}:${ref.id}`} id={ref.id} page={ref.page} />
        ) : (
          <PolicyReferenceCard key={`${ref.type}:${ref.id}`} id={ref.id} page={ref.page} />
        ),
      )}
    </div>
  );
}
