import dayjs from "dayjs";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { CoverageBreakdown } from "@/convex/lib/coverageBreakdown";

export type Policy = {
  id: string;
  title: string;
  insuredName: string;
  carrier?: string;
  policyNumber: string;
  policyTypes: string[];
  effectiveDate: string;
  expirationDate: string;
  dataStage?: string;
  coverageBreakdown?: CoverageBreakdown;
  coverages: Array<{
    name: string;
    limit?: string;
    deductible?: string;
    origin?: string;
  }>;
};

export type AppCardView = {
  kind: "policy" | "certificate" | "certificate_request" | "policy_change";
  orgName: string;
  title: string;
  subtitle?: string;
  label?: string;
  policy?: Policy | null;
  certificate?: {
    holderName: string;
    fileName: string;
    fileUrl?: string | null;
    authorityType?: string;
    certificationStatus?: string;
    versionNumber?: number;
    createdAt: number;
  };
  certificateRequest?: {
    holderName: string;
    status: string;
    partnerName?: string;
    createdAt: number;
    updatedAt: number;
  };
  policyChange?: {
    status: string;
    requestText?: string;
    summary?: string;
    pendingQuestions: string[];
    createdAt: number;
    updatedAt: number;
  };
};

export async function loadAppCardView(token: string): Promise<AppCardView | null> {
  const result = await fetchQuery(api.appCardLinks.getByToken, { token });
  return result as AppCardView | null;
}

export function formatDate(value?: string | number) {
  if (!value) return "Not listed";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : String(value);
}

export function labelForStatus(status?: string) {
  if (!status) return "Not listed";
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function compactList(parts: Array<string | undefined | null>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" | ");
}

export function truncate(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export function metadataDescription(view: AppCardView) {
  if (view.policy) {
    return compactList([
      view.policy.carrier,
      view.policy.policyTypes.join(", "),
      `${formatDate(view.policy.effectiveDate)} to ${formatDate(view.policy.expirationDate)}`,
      view.orgName,
    ]) || view.subtitle || view.orgName;
  }
  if (view.certificate) {
    return compactList([
      view.certificate.holderName,
      labelForStatus(view.certificate.certificationStatus),
      view.orgName,
    ]);
  }
  if (view.certificateRequest) {
    return compactList([
      view.certificateRequest.holderName,
      labelForStatus(view.certificateRequest.status),
      view.orgName,
    ]);
  }
  if (view.policyChange?.summary) return view.policyChange.summary;
  return view.subtitle ?? view.orgName;
}
