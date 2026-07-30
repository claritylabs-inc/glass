"use client";

import { lobLabel, toLobCodes } from "@/convex/lib/linesOfBusiness";
import dayjs from "dayjs";
import dynamic from "next/dynamic";
import { BrandIcon } from "@/components/ui/brand-icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { Loader2, Pencil } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { normalizeExtractedDate } from "@/convex/lib/valueNormalization";
import {
  formatDisplayDate,
  formatDisplayPolicyPeriod,
} from "@/lib/date-format";
import { policyCardBranding } from "@/lib/policy-card-branding";
import {
  readCarrierIdentity,
  type CarrierIdentity,
} from "@/convex/lib/carrierIdentity";
import { policyProductName } from "@/convex/lib/policyProductIdentity";

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

function StatusBadge({ expirationDate }: { expirationDate?: string }) {
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
  const className =
    "inline-flex items-center rounded-full border border-current/20 bg-transparent px-2.5 py-0.5 text-tag font-medium text-current";

  if (isExpired) {
    return <span className={className}>Expired</span>;
  }
  if (isExpiringSoon) {
    return <span className={className}>Expiring Soon</span>;
  }
  return <span className={className}>Active</span>;
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
  return (
    normalized &&
    normalized !== "un" &&
    normalized !== "other" &&
    !isPendingValue(normalized)
  );
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
        {["Policy number", "Lines of business", "Policy period", "Premium"].map(
          (label, index) => (
            <div
              key={label}
              className={index === 0 ? "sm:col-span-2" : undefined}
            >
              <p className="mb-1.5 text-label text-muted-foreground/55">
                {label}
              </p>
              <Skeleton className="h-4 w-full max-w-56 bg-foreground/6" />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export interface PolicySummaryProps {
  carrier?: string;
  carrierIdentity?: CarrierIdentity | null;
  policyNumber?: string;
  productIdentity?: unknown;
  programName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  premium?: string;
  totalCost?: string;
  taxesAndFees?: Array<{ amount?: string; amountValue?: number }>;
  linesOfBusiness: string[];
  operationsDescription?: string;
  summary?: string;
  isRenewal?: boolean;
  pdfUrl?: string | null;
  onEdit?: () => void;
}

export function PolicySummary({
  carrier,
  carrierIdentity: carrierIdentityValue,
  policyNumber,
  productIdentity,
  programName,
  effectiveDate,
  expirationDate,
  premium,
  totalCost,
  taxesAndFees,
  linesOfBusiness,
  operationsDescription,
  summary: _summary,
  isRenewal,
  pdfUrl,
  onEdit,
}: PolicySummaryProps) {
  const realPolicyNumber = realText(policyNumber);
  const realProductName = realText(
    policyProductName({ productIdentity, programName }),
  );
  const carrierIdentity = readCarrierIdentity(carrierIdentityValue);
  const branding = carrierIdentity?.branding;
  const issuerName =
    realText(carrierIdentity?.displayName) ??
    realText(carrier) ??
    "Insurance carrier";
  const realEffectiveDate = realText(effectiveDate);
  const realExpirationDate = realText(expirationDate);
  const displayEffectiveDate = formatPolicyDate(realEffectiveDate);
  const displayExpirationDate = formatPolicyDate(realExpirationDate);
  const realPremium = realText(premium);
  const realTotalCost = realText(totalCost);
  const taxesAndFeesAmount = taxesAndFees?.reduce(
    (sum, row) =>
      sum +
      (typeof row.amountValue === "number"
        ? row.amountValue
        : (moneyAmount(row.amount) ?? 0)),
    0,
  );
  const realTaxesAndFees =
    taxesAndFeesAmount && taxesAndFeesAmount > 0
      ? formattedMoney(taxesAndFeesAmount)
      : undefined;
  const realOperationsDescription = realText(operationsDescription);
  const realLinesOfBusiness =
    toLobCodes(linesOfBusiness).filter(isRealLineOfBusiness);
  const periodValue =
    formatDisplayPolicyPeriod(displayEffectiveDate, displayExpirationDate) ||
    undefined;

  const hasExtractedDetails =
    !!realPolicyNumber ||
    !!realProductName ||
    realLinesOfBusiness.length > 0 ||
    !!periodValue ||
    !!realPremium ||
    !!realTaxesAndFees ||
    !!realTotalCost ||
    !!realOperationsDescription;
  const hasOverviewRows =
    !!realPolicyNumber ||
    !!realProductName ||
    realLinesOfBusiness.length > 0 ||
    !!periodValue ||
    !!realPremium ||
    !!realTaxesAndFees ||
    !!realTotalCost;
  const { patternStyle, surfaceStyle } = policyCardBranding(
    issuerName,
    branding?.accentColor,
  );

  return (
    <OperationalPanel className="mb-6 @container">
      <div className="relative overflow-hidden px-5 py-4" style={surfaceStyle}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={patternStyle}
        />
        <div className="relative z-10 flex items-start gap-3">
          <BrandIcon
            src={branding?.iconUrl}
            name={issuerName}
            size="lg"
            className="size-9 rounded-md bg-background"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-label font-medium text-current opacity-75">
              {issuerName}
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-current">
              Policy overview
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {isRenewal ? (
              <span className="inline-flex items-center rounded-full border border-current/20 bg-transparent px-2 py-0.5 text-tag font-medium text-current">
                Renewal
              </span>
            ) : null}
            <StatusBadge expirationDate={realExpirationDate} />
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
      </div>

      {pdfUrl || hasOverviewRows || !hasExtractedDetails ? (
        <OperationalPanelBody className="flex flex-col p-0 @lg:flex-row @lg:items-start">
          {pdfUrl ? (
            <div className="shrink-0 p-5 pb-5 @lg:pb-5 @lg:pr-4 border-b @lg:border-r @lg:border-b-0 border-foreground/6">
              <div className="w-fit overflow-clip bg-background">
                <PolicyPdfThumbnail url={pdfUrl} />
              </div>
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            {!hasExtractedDetails ? (
              <div className="p-5">
                <ExtractionPendingDetails />
              </div>
            ) : null}

            {hasOverviewRows ? (
              <dl>
                <OperationalLabelValueRow
                  label="Policy number"
                  value={realPolicyNumber}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Product / plan"
                  value={realProductName}
                  align="right"
                />
                {realLinesOfBusiness.length > 0 ? (
                  <OperationalLabelValueRow
                    label="Product lines"
                    value={
                      <span className="flex flex-col items-start gap-0.5 sm:items-end">
                        {realLinesOfBusiness.slice(0, 4).map((line) => (
                          <span key={line}>{lobLabel(line)}</span>
                        ))}
                        {realLinesOfBusiness.length > 4 ? (
                          <span className="text-muted-foreground">
                            +{realLinesOfBusiness.length - 4} more
                          </span>
                        ) : null}
                      </span>
                    }
                    align="right"
                  />
                ) : null}
                <OperationalLabelValueRow
                  label="Policy period"
                  value={periodValue}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Premium"
                  value={realPremium}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Taxes & fees"
                  value={realTaxesAndFees}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Total payable"
                  value={realTotalCost}
                  align="right"
                />
              </dl>
            ) : null}
          </div>
        </OperationalPanelBody>
      ) : null}
      {realOperationsDescription ? (
        <dl className="border-t border-foreground/6">
          <OperationalLabelValueRow
            label="Description of operations"
            value={realOperationsDescription}
            align="right"
          />
        </dl>
      ) : null}
    </OperationalPanel>
  );
}
