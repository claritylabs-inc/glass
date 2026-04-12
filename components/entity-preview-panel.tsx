"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf } from "@/components/pdf-context";
import {
  X,
  ExternalLink,
  FileText,
  Calendar,
  Shield,
  ChevronDown,
  BookOpen,
  ScrollText,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import dayjs from "dayjs";
import Link from "next/link";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ── Collapsible section component ── */
function DocSection({
  title,
  type,
  pages,
  content,
  defaultOpen = false,
}: {
  title: string;
  type?: string;
  pages?: string;
  content: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const icon =
    type === "endorsement" ? <ScrollText className="w-3 h-3" /> :
    type === "exclusion" ? <AlertTriangle className="w-3 h-3" /> :
    <BookOpen className="w-3 h-3" />;

  return (
    <div className="border border-foreground/6 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-foreground/[0.02] transition-colors cursor-pointer"
      >
        <span className="text-muted-foreground/40">{icon}</span>
        <span className="text-[12px] font-medium text-foreground flex-1 truncate">
          {title}
        </span>
        {pages && (
          <span className="text-[10px] text-muted-foreground/30 shrink-0">
            p.{pages}
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground/30 transition-transform duration-150 shrink-0",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="px-3 pb-2.5 border-t border-foreground/4">
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed whitespace-pre-wrap pt-2">
            {content.length > 3000 ? content.slice(0, 3000) + "\n\n[truncated]" : content}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Coverage row ── */
function CoverageRow({ name, limit, deductible }: { name: string; limit?: string; deductible?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 px-2 rounded bg-foreground/[0.02] text-[12px]">
      <span className="text-foreground truncate mr-2">{name}</span>
      <div className="flex items-baseline gap-2 shrink-0">
        {limit && <span className="text-muted-foreground/60 font-mono text-[11px]">{limit}</span>}
        {deductible && (
          <span className="text-muted-foreground/35 font-mono text-[10px]">ded {deductible}</span>
        )}
      </div>
    </div>
  );
}

/* ── Policy Preview (redesigned) ── */
function PolicyPreview({ id, page }: { id: string; page?: number }) {
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

  // Gather document sections for display
  const sections = doc?.sections ?? [];
  const endorsements = doc?.endorsements ?? [];
  const conditions = doc?.conditions ?? [];
  const exclusions = doc?.exclusions ?? [];
  const hasSections = sections.length > 0 || endorsements.length > 0 || conditions.length > 0 || exclusions.length > 0;

  return (
    <div className="space-y-4">
      {/* Header — compact */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
              {isQuoteDoc ? "Quote" : "Policy"}
            </p>
            <h3 className="text-[14px] font-semibold text-foreground leading-tight mt-0.5">{carrier}</h3>
            {policyNum && (
              <p className="text-[12px] text-muted-foreground/50 font-mono mt-0.5">#{policyNum}</p>
            )}
          </div>
        </div>

        {/* Types + period inline */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {types.map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-px rounded bg-foreground/[0.04] text-muted-foreground/50"
            >
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
          {(policy.effectiveDate || policy.expirationDate) && (
            <>
              {types.length > 0 && <span className="text-muted-foreground/15">|</span>}
              <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />
                {policy.effectiveDate ? dayjs(policy.effectiveDate).format("MMM D, YYYY") : "—"}
                {" — "}
                {policy.expirationDate ? dayjs(policy.expirationDate).format("MMM D, YYYY") : "—"}
              </span>
            </>
          )}
        </div>

        {policy.insuredName && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground/40">
            <Shield className="w-2.5 h-2.5" />
            <span>{policy.insuredName}</span>
          </div>
        )}
      </div>

      {/* Document sections — the main value of the preview */}
      {hasSections && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-2">
            Document sections
          </p>
          <div className="space-y-1.5">
            {/* Show sections */}
            {sections.slice(0, 15).map((s: any, i: number) => (
              <DocSection
                key={`s-${i}`}
                title={s.title}
                type={s.type}
                pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`}
                content={buildSectionContent(s)}
              />
            ))}
            {sections.length > 15 && (
              <p className="text-[10px] text-muted-foreground/30 pl-2">
                +{sections.length - 15} more sections
              </p>
            )}

            {/* Show endorsements */}
            {endorsements.map((e: any, i: number) => (
              <DocSection
                key={`e-${i}`}
                title={e.title}
                type="endorsement"
                pages={e.pageStart ? `${e.pageStart}` : undefined}
                content={e.content || "No content extracted"}
              />
            ))}

            {/* Show conditions */}
            {conditions.map((c: any, i: number) => (
              <DocSection
                key={`c-${i}`}
                title={c.title}
                type="condition"
                pages={c.pageNumber ? `${c.pageNumber}` : undefined}
                content={c.content || "No content extracted"}
              />
            ))}

            {/* Show exclusions */}
            {exclusions.map((ex: any, i: number) => (
              <DocSection
                key={`ex-${i}`}
                title={ex.title}
                type="exclusion"
                content={ex.content || ex.description || "No content extracted"}
              />
            ))}
          </div>
        </div>
      )}

      {/* Key coverages — collapsed */}
      {policy.coverages && policy.coverages.length > 0 && (
        <CollapsibleBlock title="Coverages" count={policy.coverages.length}>
          <div className="space-y-1">
            {policy.coverages.slice(0, 10).map((cov: any, i: number) => (
              <CoverageRow key={i} name={cov.name} limit={cov.limit} deductible={cov.deductible} />
            ))}
            {policy.coverages.length > 10 && (
              <p className="text-[10px] text-muted-foreground/30 pl-2">
                +{policy.coverages.length - 10} more
              </p>
            )}
          </div>
        </CollapsibleBlock>
      )}

      {/* Summary — collapsed */}
      {policy.summary && (
        <CollapsibleBlock title="Summary">
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{policy.summary}</p>
        </CollapsibleBlock>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {fileUrl && (
          <button
            type="button"
            onClick={() => {
              openWithUrl(fileUrl, page);
              closePreview();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-[12px] font-medium cursor-pointer"
          >
            <FileText className="w-3 h-3 text-muted-foreground/50" />
            View PDF
          </button>
        )}
        <Link
          href={`/policies/${id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-[12px] font-medium no-underline"
        >
          <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
          Full details
        </Link>
      </div>
    </div>
  );
}

/* ── Quote Preview ── */
function QuotePreview({ id, page }: { id: string; page?: number }) {
  const quote = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    quote?.fileId ? { fileId: quote.fileId } : "skip",
  );
  const { openWithUrl } = usePdf();
  const { closePreview } = useEntityPreview();

  if (!quote) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const carrier = quote.security || quote.carrier || "Unknown carrier";
  const quoteNum = (quote as any).quoteNumber ?? quote.policyNumber;
  const types = quote.policyTypes ?? [];
  const doc = quote.document as any;
  const sections = doc?.sections ?? [];
  const hasSections = sections.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
          Quote
        </p>
        <h3 className="text-[14px] font-semibold text-foreground leading-tight mt-0.5">{carrier}</h3>
        {quoteNum && (
          <p className="text-[12px] text-muted-foreground/50 font-mono mt-0.5">#{quoteNum}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {types.map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-px rounded bg-foreground/[0.04] text-muted-foreground/50"
            >
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
        </div>
        {quote.insuredName && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground/40">
            <Shield className="w-2.5 h-2.5" />
            <span>{quote.insuredName}</span>
          </div>
        )}
      </div>

      {/* Sections */}
      {hasSections && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-2">
            Document sections
          </p>
          <div className="space-y-1.5">
            {sections.slice(0, 15).map((s: any, i: number) => (
              <DocSection
                key={`s-${i}`}
                title={s.title}
                type={s.type}
                pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`}
                content={buildSectionContent(s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Coverages */}
      {quote.coverages && quote.coverages.length > 0 && (
        <CollapsibleBlock title="Coverages" count={quote.coverages.length}>
          <div className="space-y-1">
            {quote.coverages.slice(0, 10).map((cov: any, i: number) => (
              <CoverageRow key={i} name={cov.name} limit={cov.proposedLimit ?? cov.limit} deductible={cov.deductible} />
            ))}
          </div>
        </CollapsibleBlock>
      )}

      {/* Summary */}
      {quote.summary && (
        <CollapsibleBlock title="Summary">
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{quote.summary}</p>
        </CollapsibleBlock>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {fileUrl && (
          <button
            type="button"
            onClick={() => {
              openWithUrl(fileUrl, page);
              closePreview();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-[12px] font-medium cursor-pointer"
          >
            <FileText className="w-3 h-3 text-muted-foreground/50" />
            View PDF
          </button>
        )}
        <Link
          href={`/policies/${id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-[12px] font-medium no-underline"
        >
          <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
          Full details
        </Link>
      </div>
    </div>
  );
}

/* ── Helpers ── */
function buildSectionContent(s: any): string {
  let content = s.content ?? "";
  if (s.subsections?.length) {
    for (const sub of s.subsections) {
      content += `\n\n${sub.title ?? ""}`;
      if (sub.content) content += `\n${sub.content}`;
    }
  }
  return content;
}

function CollapsibleBlock({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full group cursor-pointer"
      >
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground/30 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
        <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
          {title}
        </span>
        {count != null && (
          <span className="text-[10px] text-muted-foreground/25">{count}</span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/* ── Panel Shell ── */
export function EntityPreviewPanel() {
  const { preview, closePreview } = useEntityPreview();

  return (
    <AnimatePresence mode="popLayout">
      {preview && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width: 380 }}
          exit={{ width: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full"
        >
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width: 380 }}
          >
            {/* Toolbar */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-foreground/6 shrink-0">
              <span className="text-[13px] font-medium text-foreground">
                {preview.type === "policy" ? "Policy" : "Quote"} Preview
              </span>
              <button
                type="button"
                onClick={closePreview}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {preview.type === "policy" && (
                <PolicyPreview id={preview.id} page={preview.page} />
              )}
              {preview.type === "quote" && (
                <QuotePreview id={preview.id} page={preview.page} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
