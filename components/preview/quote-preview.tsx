"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf } from "@/components/pdf-context";
import { ExternalLink, FileText, Shield, Loader2 } from "lucide-react";
import Link from "next/link";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { DocSection } from "./doc-section";
import { CollapsibleBlock } from "./collapsible-block";
import { CoverageRow } from "./coverage-row";
import { buildSectionContent } from "./section-utils";

export function QuotePreview({ id, page, citedSections }: { id: string; page?: number; citedSections?: string[] }) {
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
      <div>
        <p className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider">Quote</p>
        <h3 className="text-sm font-semibold text-foreground leading-tight mt-0.5">{carrier}</h3>
        {quoteNum && <p className="text-label text-muted-foreground/50 font-mono mt-0.5">#{quoteNum}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {types.map((t) => (
            <span key={t} className="text-label-sm px-1.5 py-px rounded bg-foreground/[0.04] text-muted-foreground/50">
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

      <div className="flex gap-2">
        {fileUrl && (
          <button type="button" onClick={() => { openWithUrl(fileUrl, page); closePreview(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-label font-medium cursor-pointer">
            <FileText className="w-3 h-3 text-muted-foreground/50" /> View PDF
          </button>
        )}
        <Link href={`/policies/${id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-label font-medium no-underline">
          <ExternalLink className="w-3 h-3 text-muted-foreground/50" /> Full details
        </Link>
      </div>

      {hasSections && (
        <div>
          <p className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider mb-2">Document sections</p>
          <div className="space-y-1.5">
            {sections.slice(0, 15).map((s: any, i: number) => (
              <DocSection key={`s-${i}`} title={s.title} type={s.type} pages={`${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}`} content={buildSectionContent(s)} />
            ))}
          </div>
        </div>
      )}

      {quote.coverages && quote.coverages.length > 0 && (
        <CollapsibleBlock title="Coverages" count={quote.coverages.length}>
          <div className="space-y-1">
            {quote.coverages.slice(0, 10).map((cov: any, i: number) => (
              <CoverageRow key={i} name={cov.name} limit={cov.proposedLimit ?? cov.limit} deductible={cov.deductible} />
            ))}
          </div>
        </CollapsibleBlock>
      )}

      {quote.summary && (
        <CollapsibleBlock title="Summary">
          <p className="text-label-sm text-muted-foreground/60 leading-relaxed">{quote.summary}</p>
        </CollapsibleBlock>
      )}
    </div>
  );
}
