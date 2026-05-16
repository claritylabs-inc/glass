"use client";

import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { usePdf } from "@/components/pdf-context";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import dayjs from "dayjs";
import { useState } from "react";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-body-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-body-sm font-medium text-foreground text-right">
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ expirationDate }: { effectiveDate?: string; expirationDate?: string }) {
  if (!expirationDate || expirationDate === "—") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
        Active
      </span>
    );
  }

  const now = dayjs();
  const expiry = dayjs(expirationDate, ["MM/DD/YYYY", "YYYY-MM-DD", "M/D/YYYY"], true);
  if (!expiry.isValid()) {
    return null;
  }

  const isExpired = expiry.isBefore(now, "day");
  const isExpiringSoon = !isExpired && expiry.diff(now, "day") <= 30;

  if (isExpired) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
        Expired
      </span>
    );
  }
  if (isExpiringSoon) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        Expiring Soon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
      Active
    </span>
  );
}

function PdfThumbnail({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const { openWithUrl } = usePdf();

  return (
    <button
      type="button"
      onClick={() => openWithUrl(url)}
      className="shrink-0 rounded-md border border-foreground/8 bg-foreground/2 overflow-hidden hover:border-foreground/15 transition-colors w-40 aspect-8.5/11"
    >
      <Document
        file={url}
        loading={<div className="w-full h-full animate-pulse bg-foreground/5" />}
        error={null}
        onLoadSuccess={() => setLoaded(true)}
      >
        <Page
          pageNumber={1}
          width={160}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          className={`transition-opacity duration-300 [&_.react-pdf\_\_Page\_\_canvas]:w-full! [&_.react-pdf\_\_Page\_\_canvas]:h-auto! ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </Document>
    </button>
  );
}

export interface PolicySummaryProps {
  policyNumber?: string;
  carrier?: string;
  administrator?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  premium?: string;
  totalCost?: string;
  policyTypes: string[];
  policyTermType?: string;
  limits?: Record<string, unknown>;
  deductibles?: Record<string, unknown>;
  summary?: string;
  isRenewal?: boolean;
  documentType?: string;
  pdfUrl?: string | null;
}

export function PolicySummary({
  policyNumber: _policyNumber,
  carrier,
  administrator,
  insuredName,
  effectiveDate,
  expirationDate,
  premium,
  totalCost,
  policyTypes,
  policyTermType,
  limits,
  deductibles,
  summary,
  isRenewal,
  documentType,
  pdfUrl,
}: PolicySummaryProps) {
  const displayPremium = totalCost || premium;

  const periodValue =
    effectiveDate === "Unknown" && !expirationDate
      ? documentType === "quote"
        ? "Quote"
        : "Unknown"
      : policyTermType === "continuous"
        ? `${effectiveDate} — Until Cancelled`
        : `${effectiveDate ?? "—"} – ${expirationDate ?? "—"}`;

  const keyLimits: { label: string; value: string }[] = [];
  if (limits && typeof limits === "object") {
    const l = limits as Record<string, unknown>;
    if (l.perOccurrence) keyLimits.push({ label: "Per Occurrence", value: l.perOccurrence as string });
    if (l.aggregate) keyLimits.push({ label: "Aggregate", value: l.aggregate as string });
    if (l.perClaim) keyLimits.push({ label: "Per Claim", value: l.perClaim as string });
    if (l.eachOccurrence) keyLimits.push({ label: "Each Occurrence", value: l.eachOccurrence as string });
    if (l.generalAggregate) keyLimits.push({ label: "General Aggregate", value: l.generalAggregate as string });
  }

  const keyDeductibles: { label: string; value: string }[] = [];
  if (deductibles && typeof deductibles === "object") {
    const d = deductibles as Record<string, unknown>;
    if (d.perOccurrence) keyDeductibles.push({ label: "Deductible", value: d.perOccurrence as string });
    else if (d.perClaim) keyDeductibles.push({ label: "Deductible", value: d.perClaim as string });
    else if (d.aggregate) keyDeductibles.push({ label: "Deductible (Agg)", value: d.aggregate as string });
  }

  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden mb-6 @container">
      {/* Header row */}
      <div className="px-5 py-3 border-b border-foreground/6 flex items-center gap-3">
        <h2 className="text-body-sm font-semibold text-foreground flex-1">
          Policy Overview
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isRenewal && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
              Renewal
            </span>
          )}
          <StatusBadge effectiveDate={effectiveDate} expirationDate={expirationDate} />
        </div>
      </div>

      {/* Body — stacks when narrow, side-by-side when wide */}
      <div className="flex flex-col @lg:flex-row gap-5 p-5">
        {/* PDF thumbnail */}
        {pdfUrl && <PdfThumbnail url={pdfUrl} />}

        {/* Details column */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Coverage types — same row style as other fields */}
          {policyTypes.length > 0 && (
            <SummaryRow
              label="Coverage types"
              value={
                <span className="flex flex-wrap justify-end gap-1">
                  {policyTypes.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-foreground/5 text-foreground/70"
                    >
                      {POLICY_TYPE_LABELS[t] ?? t}
                    </span>
                  ))}
                  {policyTypes.length > 4 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-foreground/5 text-muted-foreground">
                      +{policyTypes.length - 4} more
                    </span>
                  )}
                </span>
              }
            />
          )}

          {administrator && (
            <SummaryRow label="Administrator" value={administrator} />
          )}
          {carrier && (
            <SummaryRow label="Carrier" value={carrier} />
          )}
          {insuredName && (
            <SummaryRow label="Named insured" value={insuredName} />
          )}
          {(effectiveDate || expirationDate) && (
            <SummaryRow label="Policy period" value={periodValue} />
          )}
          {displayPremium && (
            <SummaryRow label="Premium" value={displayPremium} />
          )}
          {keyLimits.map(({ label, value }) => (
            <SummaryRow key={label} label={label} value={value} />
          ))}
          {keyDeductibles.map(({ label, value }) => (
            <SummaryRow key={label} label={label} value={value} />
          ))}
        </div>
      </div>

      {/* AI summary if available */}
      {summary && (
        <div className="px-5 py-3 border-t border-foreground/6 bg-foreground/1">
          <p className="text-body-sm text-muted-foreground leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  );
}
