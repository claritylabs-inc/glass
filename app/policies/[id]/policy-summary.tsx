"use client";

import { lobBadgeClass, lobLabel, toLobCodes } from "@/convex/lib/linesOfBusiness";
import dayjs from "dayjs";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { Loader2, Pencil } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { normalizeExtractedDate } from "@/convex/lib/valueNormalization";
import { formatDisplayDate } from "@/lib/date-format";

const PolicyPdfThumbnail = dynamic(
  () =>
    import("./policy-pdf-thumbnail").then((module) => ({
      default: module.PolicyPdfThumbnail,
    })),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="hidden aspect-8.5/11 w-40 shrink-0 bg-white sm:block" />
    ),
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

function StatusBadge({
  expirationDate,
}: {
  effectiveDate?: string;
  expirationDate?: string;
}) {
  const now = dayjs();
  const expiry = dayjs(
    expirationDate,
    ["MM/DD/YYYY", "YYYY-MM-DD", "M/D/YYYY"],
    true,
  );
  if (!expiry.isValid()) {
    return null;
  }

  const isExpired = expiry.isBefore(now, "day");
  const isExpiringSoon = !isExpired && expiry.diff(now, "day") <= 30;

  if (isExpired) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-tag font-medium bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
        Expired
      </span>
    );
  }
  if (isExpiringSoon) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-tag font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        Expiring Soon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-tag font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
      Active
    </span>
  );
}

function isPendingValue(value: unknown) {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
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

function formatPolicyDate(value: string | undefined) {
  const text = realText(value);
  if (!text) return undefined;
  const normalized = normalizeExtractedDate(text);
  return normalized ? formatDisplayDate(normalized) : text;
}

function moneyAmount(value: string | undefined) {
  if (!value) return undefined;
  const amount = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function formattedMoney(amount: number) {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isRealLineOfBusiness(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized && normalized !== "un" && normalized !== "other" && !isPendingValue(normalized);
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
        {[
          "Policy number",
          "Lines of business",
          "Policy period",
          "Premium",
        ].map((label, index) => (
          <div
            key={label}
            className={index === 0 ? "sm:col-span-2" : undefined}
          >
            <p className="mb-1.5 text-label text-muted-foreground/55">
              {label}
            </p>
            <Skeleton className="h-4 w-full max-w-56 bg-foreground/6" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PolicySummaryProps {
  policyNumber?: string;
  effectiveDate?: string;
  expirationDate?: string;
  premium?: string;
  totalCost?: string;
  taxesAndFees?: Array<{ amount?: string; amountValue?: number }>;
  linesOfBusiness: string[];
  policyTermType?: string;
  operationsDescription?: string;
  summary?: string;
  isRenewal?: boolean;
  pdfUrl?: string | null;
  onEdit?: () => void;
}

export function PolicySummary({
  policyNumber,
  effectiveDate,
  expirationDate,
  premium,
  totalCost,
  taxesAndFees,
  linesOfBusiness,
  policyTermType,
  operationsDescription,
  summary: _summary,
  isRenewal,
  pdfUrl,
  onEdit,
}: PolicySummaryProps) {
  const realPolicyNumber = realText(policyNumber);
  const realEffectiveDate = realText(effectiveDate);
  const realExpirationDate = realText(expirationDate);
  const displayEffectiveDate = formatPolicyDate(realEffectiveDate);
  const displayExpirationDate = formatPolicyDate(realExpirationDate);
  const realPremium = realText(premium);
  const realTotalCost = realText(totalCost);
  const taxesAndFeesAmount = taxesAndFees?.reduce((sum, row) =>
    sum + (typeof row.amountValue === "number" ? row.amountValue : moneyAmount(row.amount) ?? 0), 0);
  const realTaxesAndFees = taxesAndFeesAmount && taxesAndFeesAmount > 0
    ? formattedMoney(taxesAndFeesAmount)
    : undefined;
  const realOperationsDescription = realText(operationsDescription);
  const realLinesOfBusiness = toLobCodes(linesOfBusiness).filter(isRealLineOfBusiness);
  const periodValue =
    policyTermType === "continuous" && displayEffectiveDate
        ? `${displayEffectiveDate} — Until Cancelled`
        : displayEffectiveDate || displayExpirationDate
          ? `${displayEffectiveDate ?? "—"} – ${displayExpirationDate ?? "—"}`
          : undefined;

  const hasExtractedDetails =
    !!realPolicyNumber ||
    realLinesOfBusiness.length > 0 ||
    !!periodValue ||
    !!realPremium ||
    !!realTaxesAndFees ||
    !!realTotalCost ||
    !!realOperationsDescription;

  return (
    <OperationalPanel className="mb-6 @container">
      {/* Header row */}
      <div className="px-5 py-3 border-b border-foreground/6 flex items-center gap-3">
        <h2 className="text-base font-semibold text-foreground flex-1">
          Policy Overview
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isRenewal && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-tag font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
              Renewal
            </span>
          )}
          <StatusBadge
            effectiveDate={realEffectiveDate}
            expirationDate={realExpirationDate}
          />
          {onEdit ? (
            <PillButton
              type="button"
              size="compact"
              variant="secondary"
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
              Edit
            </PillButton>
          ) : null}
        </div>
      </div>

      {/* Body — stacks when narrow, side-by-side when wide */}
      <OperationalPanelBody className="flex flex-col @lg:flex-row gap-5 p-5">
        {/* PDF thumbnail */}
        {pdfUrl && <PolicyPdfThumbnail url={pdfUrl} />}

        {/* Details column */}
        <div className="flex-1 min-w-0 space-y-2.5 self-start pt-1">
          {!hasExtractedDetails && <ExtractionPendingDetails />}

          {/* Policy number */}
          {realPolicyNumber && (
            <SummaryRow label="Policy number" value={realPolicyNumber} />
          )}

          {realLinesOfBusiness.length > 0 && (
            <SummaryRow
              label="Lines of business"
              value={
                <span className="flex flex-wrap justify-end gap-1">
                  {realLinesOfBusiness.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-tag font-medium ${lobBadgeClass(t)}`}
                    >
                      {lobLabel(t)}
                    </span>
                  ))}
                  {realLinesOfBusiness.length > 4 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-tag font-medium bg-foreground/5 text-muted-foreground">
                      +{realLinesOfBusiness.length - 4} more
                    </span>
                  )}
                </span>
              }
            />
          )}

          {periodValue && (
            <SummaryRow label="Policy period" value={periodValue} />
          )}
          {realPremium && <SummaryRow label="Premium" value={realPremium} />}
          {realTaxesAndFees && (
            <SummaryRow label="Taxes & fees" value={realTaxesAndFees} />
          )}
          {realTotalCost && (
            <SummaryRow label="Total payable" value={realTotalCost} />
          )}
        </div>
      </OperationalPanelBody>
      {realOperationsDescription ? (
        <dl className="border-t border-foreground/6">
          <OperationalLabelValueRow
            label="Description of operations"
            value={realOperationsDescription}
          />
        </dl>
      ) : null}
    </OperationalPanel>
  );
}
