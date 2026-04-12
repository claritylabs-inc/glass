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
import { useState, useRef, useCallback } from "react";
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
        <span className="text-label font-medium text-foreground flex-1 truncate">
          {title}
        </span>
        {pages && (
          <span className="text-label-sm text-muted-foreground/30 shrink-0">
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
        <div className="px-3 pb-3 border-t border-foreground/4 pt-2.5">
          <FormattedSectionContent content={content} />
        </div>
      )}
    </div>
  );
}

/* ── Coverage row ── */
function CoverageRow({ name, limit, deductible }: { name: string; limit?: string; deductible?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 px-2 rounded bg-foreground/[0.02] text-label">
      <span className="text-foreground truncate mr-2">{name}</span>
      <div className="flex items-baseline gap-2 shrink-0">
        {limit && <span className="text-muted-foreground/60 font-mono text-label-sm">{limit}</span>}
        {deductible && (
          <span className="text-muted-foreground/35 font-mono text-label-sm">ded {deductible}</span>
        )}
      </div>
    </div>
  );
}

/* ── Policy Preview (redesigned) ── */
function PolicyPreview({ id, page, citedSections }: { id: string; page?: number; citedSections?: string[] }) {
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

  // Gather document sections — filter to cited ones if we have citation context
  const allSections = doc?.sections ?? [];
  const allEndorsements = doc?.endorsements ?? [];
  const allConditions = doc?.conditions ?? [];
  const allExclusions = doc?.exclusions ?? [];

  const hasCitations = citedSections && citedSections.length > 0;

  function matchesCitation(title: string, content?: string): boolean {
    if (!hasCitations) return true; // no filter — show all
    const text = `${title} ${content ?? ""}`.toLowerCase();
    return citedSections!.some((ref) => text.includes(ref.toLowerCase()));
  }

  const sections = allSections.filter((s: any) => matchesCitation(s.title, s.content));
  const endorsements = allEndorsements.filter((e: any) => matchesCitation(e.title, e.content));
  const conditions = allConditions.filter((c: any) => matchesCitation(c.title, c.content));
  const exclusions = allExclusions.filter((ex: any) => matchesCitation(ex.title, ex.content ?? ex.description));

  const citedCount = sections.length + endorsements.length + conditions.length + exclusions.length;
  const totalCount = allSections.length + allEndorsements.length + allConditions.length + allExclusions.length;
  const hasSections = citedCount > 0 || totalCount > 0;

  return (
    <div className="space-y-4">
      {/* Header — compact */}
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

        {/* Types + period inline */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {types.map((t) => (
            <span
              key={t}
              className="text-label-sm px-1.5 py-px rounded bg-foreground/[0.04] text-muted-foreground/50"
            >
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

      {/* Actions — at the top so they don't get lost */}
      <div className="flex gap-2">
        {fileUrl && (
          <button
            type="button"
            onClick={() => {
              openWithUrl(fileUrl, page);
              closePreview();
            }}
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

      {/* Document sections — filtered to cited ones when available */}
      {hasSections && (
        <div>
          <p className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider mb-2">
            {hasCitations ? `Cited sections` : "Document sections"}
            {hasCitations && totalCount > citedCount && (
              <span className="text-muted-foreground/25 font-normal ml-1">
                {citedCount} of {totalCount}
              </span>
            )}
          </p>
          <div className="space-y-1.5">
            {/* Show matching sections — default open when cited */}
            {sections.map((s: any, i: number) => (
              <DocSection
                key={`s-${i}`}
                title={s.title}
                type={s.type}
                pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`}
                content={buildSectionContent(s)}
                defaultOpen={hasCitations}
              />
            ))}

            {/* Show matching endorsements — default open when cited */}
            {endorsements.map((e: any, i: number) => (
              <DocSection
                key={`e-${i}`}
                title={e.title}
                type="endorsement"
                pages={e.pageStart ? `${e.pageStart}` : undefined}
                content={e.content || "No content extracted"}
                defaultOpen={hasCitations}
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
                defaultOpen={hasCitations}
              />
            ))}

            {/* Show exclusions */}
            {exclusions.map((ex: any, i: number) => (
              <DocSection
                key={`ex-${i}`}
                title={ex.title}
                type="exclusion"
                content={ex.content || ex.description || "No content extracted"}
                defaultOpen={hasCitations}
              />
            ))}

            {/* Show all sections toggle when filtered */}
            {hasCitations && totalCount > citedCount && (
              <ShowAllSections
                policyId={id}
                allSections={allSections}
                allEndorsements={allEndorsements}
                allConditions={allConditions}
                allExclusions={allExclusions}
              />
            )}
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
              <p className="text-label-sm text-muted-foreground/30 pl-2">
                +{policy.coverages.length - 10} more
              </p>
            )}
          </div>
        </CollapsibleBlock>
      )}

      {/* Summary — collapsed */}
      {policy.summary && (
        <CollapsibleBlock title="Summary">
          <p className="text-label-sm text-muted-foreground/60 leading-relaxed">{policy.summary}</p>
        </CollapsibleBlock>
      )}

    </div>
  );
}

/* ── Quote Preview ── */
function QuotePreview({ id, page, citedSections }: { id: string; page?: number; citedSections?: string[] }) {
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
        <p className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider">
          Quote
        </p>
        <h3 className="text-sm font-semibold text-foreground leading-tight mt-0.5">{carrier}</h3>
        {quoteNum && (
          <p className="text-label text-muted-foreground/50 font-mono mt-0.5">#{quoteNum}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {types.map((t) => (
            <span
              key={t}
              className="text-label-sm px-1.5 py-px rounded bg-foreground/[0.04] text-muted-foreground/50"
            >
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
        </div>
        {quote.insuredName && (
          <div className="flex items-center gap-1.5 mt-1.5 text-label-sm text-muted-foreground/40">
            <Shield className="w-2.5 h-2.5" />
            <span>{quote.insuredName}</span>
          </div>
        )}
      </div>

      {/* Actions — at the top */}
      <div className="flex gap-2">
        {fileUrl && (
          <button
            type="button"
            onClick={() => {
              openWithUrl(fileUrl, page);
              closePreview();
            }}
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

      {/* Sections */}
      {hasSections && (
        <div>
          <p className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider mb-2">
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
          <p className="text-label-sm text-muted-foreground/60 leading-relaxed">{quote.summary}</p>
        </CollapsibleBlock>
      )}
    </div>
  );
}

function ShowAllSections({
  policyId,
  allSections,
  allEndorsements,
  allConditions,
  allExclusions,
}: {
  policyId: string;
  allSections: any[];
  allEndorsements: any[];
  allConditions: any[];
  allExclusions: any[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!expanded) {
    const total = allSections.length + allEndorsements.length + allConditions.length + allExclusions.length;
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer pl-1"
      >
        Show all {total} sections
      </button>
    );
  }
  return (
    <div className="space-y-1.5 pt-1 border-t border-foreground/4">
      <p className="text-label-sm text-muted-foreground/30 uppercase tracking-wider font-medium pt-1">All sections</p>
      {allSections.map((s: any, i: number) => (
        <DocSection key={`all-s-${i}`} title={s.title} type={s.type} pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`} content={buildSectionContent(s)} />
      ))}
      {allEndorsements.map((e: any, i: number) => (
        <DocSection key={`all-e-${i}`} title={e.title} type="endorsement" pages={e.pageStart ? `${e.pageStart}` : undefined} content={e.content || "No content extracted"} />
      ))}
      {allConditions.map((c: any, i: number) => (
        <DocSection key={`all-c-${i}`} title={c.title} type="condition" pages={c.pageNumber ? `${c.pageNumber}` : undefined} content={c.content || "No content extracted"} />
      ))}
      {allExclusions.map((ex: any, i: number) => (
        <DocSection key={`all-ex-${i}`} title={ex.title} type="exclusion" content={ex.content || ex.description || "No content extracted"} />
      ))}
    </div>
  );
}

/* ── Helpers ── */
/**
 * Renders section content with auto-detection of pipe-delimited tables.
 * Lines with 2+ pipe characters are grouped into tables; everything else is plain text.
 */
function FormattedSectionContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: Array<{ type: "text"; lines: string[] } | { type: "table"; rows: string[][] }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Detect pipe-delimited rows (at least 2 pipes, not just a single pipe in prose)
    if ((line.match(/\|/g) || []).length >= 2) {
      // Start collecting table rows
      const rows: string[][] = [];
      while (i < lines.length && (lines[i].match(/\|/g) || []).length >= 2) {
        const cells = lines[i].split("|").map((c) => c.trim()).filter((c) => c.length > 0);
        if (cells.length > 0) rows.push(cells);
        i++;
      }
      if (rows.length > 0) blocks.push({ type: "table", rows });
    } else {
      // Collect text lines
      const textLines: string[] = [];
      while (i < lines.length && (lines[i].match(/\|/g) || []).length < 2) {
        textLines.push(lines[i]);
        i++;
      }
      if (textLines.some((l) => l.trim().length > 0)) {
        blocks.push({ type: "text", lines: textLines });
      }
    }
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, bi) => {
        if (block.type === "text") {
          return (
            <p key={bi} className="text-body-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {block.lines.join("\n")}
            </p>
          );
        }
        // Table block
        const isFirstRowHeader = block.rows.length > 1 && block.rows[0].every((c) => c === c.toUpperCase() && c.length > 1);
        const headerRow = isFirstRowHeader ? block.rows[0] : null;
        const dataRows = isFirstRowHeader ? block.rows.slice(1) : block.rows;
        const colCount = Math.max(...block.rows.map((r) => r.length));

        return (
          <div key={bi} className="overflow-x-auto rounded border border-foreground/6">
            <table className="w-full text-body-sm">
              {headerRow && (
                <thead>
                  <tr className="border-b border-foreground/8 bg-foreground/[0.03]">
                    {headerRow.map((cell, ci) => (
                      <th key={ci} className="px-2.5 py-1.5 text-left text-label-sm font-medium text-muted-foreground/60 whitespace-nowrap">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} className={ri < dataRows.length - 1 ? "border-b border-foreground/4" : ""}>
                    {Array.from({ length: colCount }, (_, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 text-foreground/80 whitespace-nowrap">
                        {row[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

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
        <span className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider">
          {title}
        </span>
        {count != null && (
          <span className="text-label-sm text-muted-foreground/25">{count}</span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/* ── Panel Shell ── */
const PREVIEW_MIN_WIDTH = 320;
const PREVIEW_MAX_WIDTH = 700;
const PREVIEW_DEFAULT_WIDTH = 400;

export function EntityPreviewPanel() {
  const { preview, closePreview } = useEntityPreview();
  const [width, setWidth] = useState(PREVIEW_DEFAULT_WIDTH);
  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX; // dragging left = wider
      setWidth(Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, startWidth + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [width]);

  return (
    <AnimatePresence mode="popLayout">
      {preview && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={isDragging.current ? { duration: 0 } : { duration: 0.4, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full relative"
        >
          {/* Resize handle */}
          <div
            onPointerDown={onPointerDown}
            className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize group hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] -translate-x-[1px]" />
          </div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            {/* Toolbar */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground">
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
                <PolicyPreview id={preview.id} page={preview.page} citedSections={preview.citedSections} />
              )}
              {preview.type === "quote" && (
                <QuotePreview id={preview.id} page={preview.page} citedSections={preview.citedSections} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
