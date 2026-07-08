"use client";

import Link from "next/link";
import { AlertTriangle, Check, Clock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import type { VendorComplianceArtifactData, VendorComplianceArtifactRef } from "../types";

type VendorComplianceCheck = {
  requirementId?: string;
  title?: string;
  status?: string;
  requiredLimits?: Array<{ kind?: string; amount?: number; label?: string }>;
  expiresAt?: string;
  daysUntilExpiration?: number;
  notes?: string;
  matchedPolicy?: {
    carrier?: string;
    policyNumber?: string;
    insuredName?: string;
    expectedInsuredName?: string;
    expirationDate?: string;
    coverageName?: string;
    coverageLimit?: string;
    detectedLimitAmount?: number;
  };
};

type VendorComplianceRow = {
  vendorOrgId?: string;
  name?: string;
  status?: string;
  requirementCount?: number;
  policyCount?: number;
  checks?: VendorComplianceCheck[];
};

function normalizeVendorComplianceRows(data: unknown): VendorComplianceRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      vendorOrgId: typeof row.vendorOrgId === "string" ? row.vendorOrgId : undefined,
      name: typeof row.name === "string" ? row.name : "Vendor",
      status: typeof row.status === "string" ? row.status : undefined,
      requirementCount: typeof row.requirementCount === "number" ? row.requirementCount : undefined,
      policyCount: typeof row.policyCount === "number" ? row.policyCount : undefined,
      checks: Array.isArray(row.checks)
        ? row.checks
            .filter((check): check is Record<string, unknown> => !!check && typeof check === "object")
            .map((check) => ({
              requirementId: typeof check.requirementId === "string" ? check.requirementId : undefined,
              title: typeof check.title === "string" ? check.title : "Requirement",
              status: typeof check.status === "string" ? check.status : undefined,
              requiredLimits: Array.isArray(check.requiredLimits)
                ? (check.requiredLimits as VendorComplianceCheck["requiredLimits"])
                : undefined,
              expiresAt: typeof check.expiresAt === "string" ? check.expiresAt : undefined,
              daysUntilExpiration:
                typeof check.daysUntilExpiration === "number" ? check.daysUntilExpiration : undefined,
              notes: typeof check.notes === "string" ? check.notes : undefined,
              matchedPolicy:
                check.matchedPolicy && typeof check.matchedPolicy === "object"
                  ? (check.matchedPolicy as VendorComplianceCheck["matchedPolicy"])
                  : undefined,
            }))
        : [],
    }));
}

function vendorStatusLabel(status?: string) {
  switch (status) {
    case "compliant":
      return "Compliant";
    case "waiting_on_policies":
      return "Waiting on policies";
    case "non_compliant":
      return "Non-compliant";
    default:
      return status?.replace(/_/g, " ") ?? "Vendor compliance";
  }
}

function checkStatusMeta(status?: string) {
  switch (status) {
    case "met":
      return {
        label: "Meets requirement",
        icon: Check,
        className: "border-success/20 bg-success/10 text-success/75",
      };
    case "expiring_soon":
      return {
        label: "Expiring soon",
        icon: Clock,
        className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
      };
    case "expired":
      return {
        label: "Expired",
        icon: AlertTriangle,
        className: "border-red-500/20 bg-red-500/10 text-red-400",
      };
    case "unverified":
      return {
        label: "Unverified",
        icon: AlertTriangle,
        className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
      };
    case "not_met":
    default:
      return {
        label: status === "unverified" ? "Unverified" : "Not met",
        icon: X,
        className: "border-red-500/20 bg-red-500/10 text-red-400",
      };
  }
}

function formatRequiredLimits(limits?: VendorComplianceCheck["requiredLimits"]) {
  if (!limits?.length) return undefined;
  return limits
    .map((limit) => limit.label ?? (typeof limit.amount === "number" ? formatLimitAmount(limit.amount) : undefined))
    .filter(Boolean)
    .join(" · ");
}

function formatLimitAmount(value?: number) {
  if (typeof value !== "number") return undefined;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function VendorComplianceChecklist({ rows }: { rows: VendorComplianceRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row, rowIndex) => {
        const checks = row.checks ?? [];
        const openChecks = checks.filter((check) => check.status !== "met").length;
        const metChecks = checks.filter((check) => check.status === "met").length;
        const requirementCount = row.requirementCount ?? checks.length;
        const policyText = typeof row.policyCount === "number"
          ? row.policyCount === 0
            ? "no policies"
            : `${row.policyCount} polic${row.policyCount === 1 ? "y" : "ies"}`
          : null;
        return (
          <section key={`${row.vendorOrgId ?? row.name ?? "vendor"}-${rowIndex}`} className="rounded-md border border-foreground/8 bg-card">
            <div className="border-b border-foreground/6 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 truncate text-base font-medium text-foreground">
                      {row.name ?? "Vendor"}
                    </h3>
                    <Badge variant="outline" className="h-5 border-foreground/10 px-1.5 font-medium text-muted-foreground/60">
                      {vendorStatusLabel(row.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-label text-muted-foreground/45">
                    {metChecks}/{requirementCount} met{openChecks > 0 ? ` · ${openChecks} open` : ""}
                    {policyText ? ` · ${policyText}` : ""}
                  </p>
                </div>
                {row.vendorOrgId ? (
                  <Link
                    href={`/connect/vendors/${row.vendorOrgId}/policies`}
                    className="shrink-0 rounded-full border border-foreground/8 px-2.5 py-1 text-tag font-medium text-muted-foreground transition-colors hover:border-foreground/14 hover:text-foreground"
                  >
                    View vendor
                  </Link>
                ) : null}
              </div>
            </div>
            {checks.length > 0 ? (
              <div className="divide-y divide-foreground/[0.05]">
                {checks.map((check, checkIndex) => {
                  const meta = checkStatusMeta(check.status);
                  const StatusIcon = meta.icon;
                  const policy = check.matchedPolicy;
                  const detectedLimit = formatLimitAmount(policy?.detectedLimitAmount);
                  const requiredLimits = formatRequiredLimits(check.requiredLimits);
                  return (
                    <div key={`${check.requirementId ?? check.title ?? "check"}-${checkIndex}`} className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/85">
                          {check.title ?? "Requirement"}
                        </span>
                        <Badge variant="outline" className={`h-5 gap-1 px-1.5 font-medium ${meta.className}`}>
                          <StatusIcon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-label text-muted-foreground/55">
                        {requiredLimits ? <span>Required: {requiredLimits}</span> : null}
                        {policy?.coverageLimit ? <span>Coverage: {policy.coverageLimit}</span> : null}
                        {detectedLimit ? <span>Detected: {detectedLimit}</span> : null}
                        {policy?.expirationDate ? <span>Expires: {policy.expirationDate}</span> : null}
                        {policy?.insuredName ? <span>Insured: {policy.insuredName}</span> : null}
                      </div>
                      {policy?.carrier || policy?.policyNumber || policy?.coverageName ? (
                        <p className="mt-1 truncate text-label text-muted-foreground/40">
                          {[policy.carrier, policy.policyNumber, policy.coverageName].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {check.notes ? (
                        <p className="mt-1 text-label leading-4 text-muted-foreground/65">
                          {check.notes}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function VendorComplianceSummaryCard({
  artifact,
  onOpen,
  isOpen,
}: {
  artifact: VendorComplianceArtifactData;
  onOpen?: () => void;
  isOpen?: boolean;
}) {
  if (artifact.type !== "vendor_compliance") return null;
  const rows = normalizeVendorComplianceRows(artifact.data);
  if (rows.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mt-4 w-full max-w-3xl overflow-hidden rounded-md border bg-card text-left transition-colors ${
        isOpen ? "border-primary/35" : "border-foreground/8 hover:border-foreground/14"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2.5">
        <span className="truncate text-base font-medium text-foreground/85">
          Vendor compliance checks
        </span>
        <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 font-medium text-muted-foreground/55">
          {rows.length} vendor{rows.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="space-y-1.5 px-3 py-3">
        {rows.slice(0, 3).map((row, index) => {
          const checks = row.checks ?? [];
          const openChecks = checks.filter((check) => check.status !== "met").length;
          const metChecks = checks.filter((check) => check.status === "met").length;
          const requirementCount = row.requirementCount ?? checks.length;
          const policyText = typeof row.policyCount === "number"
            ? row.policyCount === 0
              ? "no policies"
              : `${row.policyCount} polic${row.policyCount === 1 ? "y" : "ies"}`
            : null;
          return (
            <div key={`${row.vendorOrgId ?? row.name ?? "vendor"}-${index}`} className="flex items-center gap-2 text-label">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/75">{row.name ?? "Vendor"}</span>
              <span className="shrink-0 text-muted-foreground/45">
                {metChecks}/{requirementCount} met{openChecks > 0 ? ` · ${openChecks} open` : ""}
                {policyText ? ` · ${policyText}` : ""}
              </span>
            </div>
          );
        })}
        {rows.length > 3 ? (
          <p className="text-label text-muted-foreground/40">
            +{rows.length - 3} more vendor{rows.length - 3 === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </button>
  );
}

export function VendorComplianceSidebar({
  artifact,
  onClose,
}: {
  artifact: VendorComplianceArtifactData;
  onClose: () => void;
}) {
  const rows = normalizeVendorComplianceRows(artifact.data);
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">Vendor compliance checks</h2>
          <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 font-medium text-muted-foreground/55">
            {rows.length} vendor{rows.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close vendor compliance checks">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <VendorComplianceChecklist rows={rows} />
      </div>
    </aside>
  );
}

export function VendorComplianceArtifacts({
  messageId,
  artifacts,
  openArtifactRef,
  onOpenArtifact,
}: {
  messageId: Id<"threadMessages">;
  artifacts?: VendorComplianceArtifactData[];
  openArtifactRef?: VendorComplianceArtifactRef | null;
  onOpenArtifact?: (ref: VendorComplianceArtifactRef) => void;
}) {
  const vendorArtifacts = artifacts?.filter((artifact) => artifact.type === "vendor_compliance") ?? [];
  if (vendorArtifacts.length === 0) return null;
  return (
    <div className="space-y-3">
      {vendorArtifacts.map((artifact, index) => (
        <VendorComplianceSummaryCard
          key={`vendor-compliance-${index}`}
          artifact={artifact}
          isOpen={openArtifactRef != null && openArtifactRef.messageId === messageId && openArtifactRef.index === index}
          onOpen={() => onOpenArtifact?.({ messageId, index })}
        />
      ))}
    </div>
  );
}
