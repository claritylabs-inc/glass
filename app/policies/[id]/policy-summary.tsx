"use client";

import { Calendar, Shield, DollarSign, Users, FileText } from "lucide-react";
import { POLICY_TYPE_LABELS, POLICY_TYPE_COLORS } from "@/convex/lib/policyTypes";
import dayjs from "dayjs";

function SummaryField({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </p>
      <p className={`text-body-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ effectiveDate, expirationDate }: { effectiveDate?: string; expirationDate?: string }) {
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

export interface PolicySummaryProps {
  policyNumber?: string;
  carrier?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  premium?: string;
  totalCost?: string;
  policyTypes: string[];
  policyTermType?: string;
  /** top-level limits object (per-occurrence, aggregate, etc.) */
  limits?: Record<string, unknown>;
  /** top-level deductibles object */
  deductibles?: Record<string, unknown>;
  summary?: string;
  isRenewal?: boolean;
  documentType?: string;
}

export function PolicySummary({
  policyNumber,
  carrier,
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

  // Extract key limits for display
  const keyLimits: { label: string; value: string }[] = [];
  if (limits && typeof limits === "object") {
    const l = limits as any;
    if (l.perOccurrence) keyLimits.push({ label: "Per Occurrence", value: l.perOccurrence });
    if (l.aggregate) keyLimits.push({ label: "Aggregate", value: l.aggregate });
    if (l.perClaim) keyLimits.push({ label: "Per Claim", value: l.perClaim });
    if (l.eachOccurrence) keyLimits.push({ label: "Each Occurrence", value: l.eachOccurrence });
    if (l.generalAggregate) keyLimits.push({ label: "General Aggregate", value: l.generalAggregate });
  }

  const keyDeductibles: { label: string; value: string }[] = [];
  if (deductibles && typeof deductibles === "object") {
    const d = deductibles as any;
    if (d.perOccurrence) keyDeductibles.push({ label: "Deductible", value: d.perOccurrence });
    else if (d.perClaim) keyDeductibles.push({ label: "Deductible", value: d.perClaim });
    else if (d.aggregate) keyDeductibles.push({ label: "Deductible (Agg)", value: d.aggregate });
  }

  return (
    <div className="rounded-xl border border-foreground/8 bg-white/70 dark:bg-white/[0.04] overflow-hidden shadow-sm mb-6">
      {/* Header row */}
      <div className="px-5 py-4 border-b border-foreground/6 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
            <h2 className="text-body-sm font-semibold text-foreground truncate">
              {policyNumber ?? "Unknown Policy"}
            </h2>
            {isRenewal && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
                Renewal
              </span>
            )}
            <StatusBadge effectiveDate={effectiveDate} expirationDate={expirationDate} />
          </div>
          {/* Policy type badges */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {policyTypes.slice(0, 4).map((t) => (
              <span
                key={t}
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium ${
                  POLICY_TYPE_COLORS[t] ?? POLICY_TYPE_COLORS.other
                }`}
              >
                {POLICY_TYPE_LABELS[t] ?? t}
              </span>
            ))}
            {policyTypes.length > 4 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-foreground/5 text-muted-foreground">
                +{policyTypes.length - 4} more
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Key facts grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-foreground/6">
        {carrier && (
          <div className="bg-white/80 dark:bg-[#0d0d0d]/80 px-4 py-3">
            <SummaryField label="Carrier" value={carrier} />
          </div>
        )}
        {insuredName && (
          <div className="bg-white/80 dark:bg-[#0d0d0d]/80 px-4 py-3">
            <SummaryField
              label="Named Insured"
              value={
                <span className="flex items-center gap-1.5">
                  <Users className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  {insuredName}
                </span>
              }
            />
          </div>
        )}
        {(effectiveDate || expirationDate) && (
          <div className="bg-white/80 dark:bg-[#0d0d0d]/80 px-4 py-3">
            <SummaryField
              label="Policy Period"
              value={
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  {periodValue}
                </span>
              }
            />
          </div>
        )}
        {displayPremium && (
          <div className="bg-white/80 dark:bg-[#0d0d0d]/80 px-4 py-3">
            <SummaryField
              label="Premium"
              value={
                <span className="flex items-center gap-1.5">
                  <DollarSign className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  {displayPremium}
                </span>
              }
              mono
            />
          </div>
        )}
        {keyLimits.map(({ label, value }) => (
          <div key={label} className="bg-white/80 dark:bg-[#0d0d0d]/80 px-4 py-3">
            <SummaryField label={label} value={value} mono />
          </div>
        ))}
        {keyDeductibles.map(({ label, value }) => (
          <div key={label} className="bg-white/80 dark:bg-[#0d0d0d]/80 px-4 py-3">
            <SummaryField label={label} value={value} mono />
          </div>
        ))}
      </div>

      {/* AI summary if available */}
      {summary && (
        <div className="px-5 py-3 border-t border-foreground/6 bg-foreground/[0.01]">
          <div className="flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
            <p className="text-body-sm text-muted-foreground leading-relaxed">{summary}</p>
          </div>
        </div>
      )}
    </div>
  );
}
