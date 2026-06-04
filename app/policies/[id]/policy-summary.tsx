"use client";

import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import dayjs from "dayjs";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { Loader2 } from "lucide-react";

const PolicyPdfThumbnail = dynamic(
  () =>
    import("./policy-pdf-thumbnail").then((module) => ({
      default: module.PolicyPdfThumbnail,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="hidden aspect-8.5/11 w-40 shrink-0 bg-white sm:block" />,
  },
);

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-base text-muted-foreground shrink-0">{label}</span>
      <span className="text-base font-medium text-foreground text-right">
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ expirationDate }: { effectiveDate?: string; expirationDate?: string }) {
  const now = dayjs();
  const expiry = dayjs(expirationDate, ["MM/DD/YYYY", "YYYY-MM-DD", "M/D/YYYY"], true);
  if (!expiry.isValid()) {
    return null;
  }

  const isExpired = expiry.isBefore(now, "day");
  const isExpiringSoon = !isExpired && expiry.diff(now, "day") <= 30;

  if (isExpired) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label font-medium bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
        Expired
      </span>
    );
  }
  if (isExpiringSoon) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        Expiring Soon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
      Active
    </span>
  );
}

function isPendingValue(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (
    normalized === "extracting" ||
    normalized === "extracting..." ||
    normalized === "unknown" ||
    normalized === "n/a" ||
    normalized === "none" ||
    normalized === "—" ||
    normalized === "-"
  );
}

function realText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && !isPendingValue(trimmed) ? trimmed : undefined;
}

function isRealPolicyType(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized && normalized !== "other" && !isPendingValue(normalized);
}

function pushRealValue(
  rows: { label: string; value: string }[],
  label: string,
  value: unknown,
) {
  const text = realText(typeof value === "string" ? value : undefined);
  if (text) rows.push({ label, value: text });
  return text;
}

function ExtractionPendingDetails() {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/45" />
        <span className="text-base font-medium text-muted-foreground">
          Extracting policy details
        </span>
      </div>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        {["Coverage types", "Carrier", "Named insured", "Policy period", "Premium"].map((label, index) => (
          <div key={label} className={index === 0 ? "sm:col-span-2" : undefined}>
            <p className="mb-1.5 text-label text-muted-foreground/55">{label}</p>
            <Skeleton className="h-4 w-full max-w-56 bg-foreground/6" />
          </div>
        ))}
      </div>
    </div>
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
  policyTypes: string[];
  policyTermType?: string;
  limits?: Record<string, unknown>;
  deductibles?: Record<string, unknown>;
  summary?: string;
  isRenewal?: boolean;
  documentType?: string;
  pdfUrl?: string | null;
}

function buildFactualSummary({
  policyNumber,
  carrier,
  administrator,
  insuredName,
  periodValue,
  premium,
  policyTypes,
}: {
  policyNumber?: string;
  carrier?: string;
  administrator?: string;
  insuredName?: string;
  periodValue?: string;
  premium?: string;
  policyTypes: string[];
}) {
  const issuer = administrator || carrier;
  const coverageLabel = policyTypes
    .map((type) => POLICY_TYPE_LABELS[type] ?? type)
    .filter(Boolean)
    .join(", ");
  const parts = [
    issuer ? `Issued by ${issuer}` : null,
    insuredName ? `for ${insuredName}` : null,
    coverageLabel ? `covering ${coverageLabel}` : null,
    policyNumber ? `under policy ${policyNumber}` : null,
    periodValue && !periodValue.includes("Unknown")
      ? `effective ${periodValue}`
      : null,
    premium ? `with premium ${premium}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? `${parts.join(" ")}.` : null;
}

export function PolicySummary({
  policyNumber,
  carrier,
  administrator,
  insuredName,
  effectiveDate,
  expirationDate,
  premium,
  policyTypes,
  policyTermType,
  limits,
  deductibles,
  summary: _summary,
  isRenewal,
  documentType,
  pdfUrl,
}: PolicySummaryProps) {
  const realPolicyNumber = realText(policyNumber);
  const realCarrier = realText(carrier);
  const realAdministrator = realText(administrator);
  const realInsuredName = realText(insuredName);
  const realEffectiveDate = realText(effectiveDate);
  const realExpirationDate = realText(expirationDate);
  const realPremium = realText(premium);
  const realPolicyTypes = policyTypes.filter(isRealPolicyType);
  const periodValue =
    documentType === "quote" && !realEffectiveDate && !realExpirationDate
      ? undefined
      : policyTermType === "continuous" && realEffectiveDate
        ? `${realEffectiveDate} — Until Cancelled`
        : realEffectiveDate || realExpirationDate
          ? `${realEffectiveDate ?? "—"} – ${realExpirationDate ?? "—"}`
          : undefined;

  const keyLimits: { label: string; value: string }[] = [];
  if (limits && typeof limits === "object") {
    const l = limits as Record<string, unknown>;
    pushRealValue(keyLimits, "Per Occurrence", l.perOccurrence);
    pushRealValue(keyLimits, "Aggregate", l.aggregate);
    pushRealValue(keyLimits, "Per Claim", l.perClaim);
    pushRealValue(keyLimits, "Each Occurrence", l.eachOccurrence);
    pushRealValue(keyLimits, "General Aggregate", l.generalAggregate);
  }

  const keyDeductibles: { label: string; value: string }[] = [];
  if (deductibles && typeof deductibles === "object") {
    const d = deductibles as Record<string, unknown>;
    if (!pushRealValue(keyDeductibles, "Deductible", d.perOccurrence)) {
      if (!pushRealValue(keyDeductibles, "Deductible", d.perClaim)) {
        pushRealValue(keyDeductibles, "Deductible (Agg)", d.aggregate);
      }
    }
  }
  const factualSummary = buildFactualSummary({
    policyNumber: realPolicyNumber,
    carrier: realCarrier,
    administrator: realAdministrator,
    insuredName: realInsuredName,
    periodValue,
    premium: realPremium,
    policyTypes: realPolicyTypes,
  });
  const hasExtractedDetails =
    realPolicyTypes.length > 0 ||
    !!realAdministrator ||
    !!realCarrier ||
    !!realInsuredName ||
    !!periodValue ||
    !!realPremium ||
    keyLimits.length > 0 ||
    keyDeductibles.length > 0;

  return (
    <OperationalPanel className="mb-6 @container">
      {/* Header row */}
      <div className="px-5 py-3 border-b border-foreground/6 flex items-center gap-3">
        <h2 className="text-base font-semibold text-foreground flex-1">
          Policy Overview
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isRenewal && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
              Renewal
            </span>
          )}
          <StatusBadge effectiveDate={realEffectiveDate} expirationDate={realExpirationDate} />
        </div>
      </div>

      {/* Body — stacks when narrow, side-by-side when wide */}
      <OperationalPanelBody className="flex flex-col @lg:flex-row gap-5 p-5">
        {/* PDF thumbnail */}
        {pdfUrl && <PolicyPdfThumbnail url={pdfUrl} />}

        {/* Details column */}
        <div className="flex-1 min-w-0 space-y-2.5 self-start pt-1">
          {!hasExtractedDetails && <ExtractionPendingDetails />}

          {/* Coverage types — same row style as other fields */}
          {realPolicyTypes.length > 0 && (
            <SummaryRow
              label="Coverage types"
              value={
                <span className="flex flex-wrap justify-end gap-1">
                  {realPolicyTypes.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-label font-medium bg-foreground/5 text-foreground/70"
                    >
                      {POLICY_TYPE_LABELS[t] ?? t}
                    </span>
                  ))}
                  {realPolicyTypes.length > 4 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label font-medium bg-foreground/5 text-muted-foreground">
                      +{realPolicyTypes.length - 4} more
                    </span>
                  )}
                </span>
              }
            />
          )}

          {realAdministrator && (
            <SummaryRow label="Administrator" value={realAdministrator} />
          )}
          {realCarrier && (
            <SummaryRow label="Carrier" value={realCarrier} />
          )}
          {realInsuredName && (
            <SummaryRow label="Named insured" value={realInsuredName} />
          )}
          {periodValue && (
            <SummaryRow label="Policy period" value={periodValue} />
          )}
          {realPremium && (
            <SummaryRow label="Premium" value={realPremium} />
          )}
          {keyLimits.map(({ label, value }) => (
            <SummaryRow key={label} label={label} value={value} />
          ))}
          {keyDeductibles.map(({ label, value }) => (
            <SummaryRow key={label} label={label} value={value} />
          ))}
        </div>
      </OperationalPanelBody>

      {factualSummary && (
        <div className="px-5 py-3 border-t border-foreground/6 bg-foreground/1">
          <p className="text-base text-muted-foreground leading-relaxed">{factualSummary}</p>
        </div>
      )}
    </OperationalPanel>
  );
}
