"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import dayjs from "dayjs";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  FileUp,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PolicyCitation } from "@/components/context-reference-card";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ActionSurface } from "@/components/ui/action-surface";
import { Badge } from "@/components/ui/badge";
import { FileDropZone } from "@/components/ui/file-drop";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  OperationalPanel,
  OperationalSkeletonList,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isFeatureEnabled } from "@/convex/lib/featureFlags";
import {
  REQUIREMENT_LIMIT_KINDS,
  REQUIREMENT_LIMIT_KIND_LABELS,
  REQUIREMENT_PROVISION_LABELS,
  REQUIREMENT_SOURCE_TYPE_LABELS,
  type RequirementLimitKind,
  type RequirementProvision,
  type RequirementSourceType,
} from "@/convex/lib/complianceTypes";
import { lobLabel } from "@/convex/lib/linesOfBusiness";
import { useActiveOrgContext } from "@/lib/hooks/use-active-org-context";
import { useCachedConnectedVendors } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery, useUpdateCachedQuery } from "@/lib/sync/use-cached-query";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { formatDisplayDate } from "@/lib/date-format";

type RequirementScope = "vendors" | "own_org";
type ComplianceStatus = "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
type SourceFilter = "all" | RequirementSourceType;
type LineFilter = "all" | `line:${string}`;
type LimitFilter = "all" | "deductible" | "forms" | "provisions" | `limit:${string}`;
type StatusFilter = "all" | ComplianceStatus | "defined";
type ComplianceView = "overview" | "requirements" | "sources";
type RequirementKind = "coverage" | "insurer" | "condition";
type RequirementSourceDocumentType = Exclude<RequirementSourceType, "manual" | "bulk_import">;

type ComplianceApi = {
  compliance: {
    listRequirements: FunctionReference<"query">;
    listRequirementSources: FunctionReference<"query">;
    upsertRequirement: FunctionReference<"mutation">;
    archiveRequirement: FunctionReference<"mutation">;
    updateRequirementSource: FunctionReference<"mutation">;
    archiveRequirementSources: FunctionReference<"mutation">;
    generateRequirementImportUploadUrl: FunctionReference<"mutation">;
  };
  actions: {
    complianceRequirements: {
      importRequirements: FunctionReference<"action">;
    };
    complianceReview: {
      recheckOwnRequirement: FunctionReference<"action">;
    };
  };
  connectedOrgs: {
    listClients: FunctionReference<"query">;
  };
};

const complianceApi = api as unknown as ComplianceApi;

const COMMON_LOBS = ["CGL", "AUTOB", "WORK", "UMBRC", "EXLIA", "EO", "PROPC", "BOP", "CRIME", "EPLI"] as const;

const LIMIT_KIND_OPTIONS: RequirementLimitKind[] = [...REQUIREMENT_LIMIT_KINDS];

const REQUIREMENT_SOURCE_DOCUMENT_TYPES: RequirementSourceDocumentType[] = [
  "lease_agreement",
  "client_contract",
  "vendor_requirements",
  "other",
];

const PROVISION_OPTIONS: RequirementProvision[] = [
  "additional_insured",
  "waiver_of_subrogation",
  "primary_non_contributory",
];

type Requirement = {
  _id: Id<"insuranceRequirements">;
  orgId: Id<"organizations">;
  kind?: RequirementKind;
  scope: RequirementScope;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  provisions?: string[];
  requiredForms?: string[];
  sourceDocumentId?: Id<"requirementSourceDocuments">;
  sourceType?: RequirementSourceType;
  sourceDocumentName?: string;
  sourceExcerpt?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  updatedAt: number;
  complianceCheck?: {
    status: ComplianceStatus;
    reasons?: string[];
    matchedPolicyIds?: Id<"policies">[];
    matchedSummary?: string;
    expiresAt?: string;
    daysUntilExpiration?: number;
    notes?: string;
    checkedAt?: number;
    checkedBy?: "system" | "user" | "agent";
    matchedPolicy?: {
      _id?: Id<"policies">;
      carrier?: string;
      policyNumber?: string;
      insuredName?: string;
      expirationDate?: string;
      coverageName?: string;
      coverageLimit?: string;
      detectedLimitAmount?: number;
    };
  };
  canArchive?: boolean;
  clientRequirementSource?: {
    clientOrg: {
      _id: Id<"organizations">;
      name: string;
      website?: string;
    } | null;
  };
};

type RequirementSource = {
  _id: Id<"requirementSourceDocuments">;
  orgId: Id<"organizations">;
  fileName?: string;
  contentType?: string;
  sourceType: RequirementSourceDocumentType;
  title: string;
  sourceTextExcerpt?: string;
  parserBackend?: "liteparse" | "pdfjs" | "mammoth" | "plain_text";
  status: "idle" | "running" | "paused" | "complete" | "error";
  pipelineError?: string;
  requirementCount: number;
  createdAt: number;
  updatedAt: number;
};

type ConnectedOrgRow = {
  status: "pending" | "active" | "expired" | "revoked";
};

function formatMoney(value: number | undefined) {
  if (value === undefined) return undefined;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoneyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function parseMoneyInput(value: string) {
  const normalized = value.replace(/[$,\s]/g, "");
  const multiplier = /m$/i.test(normalized) ? 1_000_000 : /k$/i.test(normalized) ? 1_000 : 1;
  const amount = Number(normalized.replace(/[mk]$/i, "")) * multiplier;
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function limitKindLabel(kind: string) {
  return (
    REQUIREMENT_LIMIT_KIND_LABELS[kind as keyof typeof REQUIREMENT_LIMIT_KIND_LABELS] ?? kind
  );
}

function asRequirementLimitKind(kind: string): RequirementLimitKind {
  return (REQUIREMENT_LIMIT_KINDS as readonly string[]).includes(kind)
    ? (kind as RequirementLimitKind)
    : "other";
}

function provisionLabel(provision: string) {
  return (
    REQUIREMENT_PROVISION_LABELS[provision as keyof typeof REQUIREMENT_PROVISION_LABELS] ??
    provision
  );
}

function sourceType(requirement: Requirement): RequirementSourceType {
  return requirement.sourceType ?? "manual";
}

function sourceLabel(value: SourceFilter) {
  return value === "all" ? "All sources" : REQUIREMENT_SOURCE_TYPE_LABELS[value];
}

function lineFilterValue(lineOfBusiness: string | undefined): LineFilter {
  return `line:${lineOfBusiness ?? "UN"}`;
}

function lineFilterLabel(value: LineFilter) {
  return value === "all" ? "All lines" : lobLabel(value.slice("line:".length));
}

function lineDisplayLabel(lineOfBusiness: string | undefined) {
  return lineOfBusiness ? lobLabel(lineOfBusiness) : lobLabel("UN");
}

function limitFilterValue(kind: string): LimitFilter {
  return `limit:${kind}`;
}

function requirementLimitFilters(requirement: Requirement): LimitFilter[] {
  const filters = (requirement.limits ?? []).map((limit) => limitFilterValue(limit.kind));
  if (requirement.maxDeductible) filters.push("deductible");
  if ((requirement.requiredForms ?? []).length > 0) filters.push("forms");
  if ((requirement.provisions ?? []).length > 0) filters.push("provisions");
  return Array.from(new Set(filters));
}

function limitFilterLabel(value: LimitFilter) {
  if (value === "all") return "All limit types";
  if (value === "deductible") return "Deductible";
  if (value === "forms") return "Required forms";
  if (value === "provisions") return "Provisions";
  return limitKindLabel(value.slice("limit:".length));
}

function statusFilterValue(requirement: Requirement): StatusFilter {
  return requirement.complianceCheck?.status ?? "defined";
}

function statusFilterLabel(value: StatusFilter) {
  return value === "all" ? "All statuses" : statusMeta(value === "defined" ? undefined : value).label;
}

function pageLabel(requirement: Requirement) {
  if (!requirement.sourcePageStart) return undefined;
  if (requirement.sourcePageEnd && requirement.sourcePageEnd !== requirement.sourcePageStart) {
    return `pp. ${requirement.sourcePageStart}-${requirement.sourcePageEnd}`;
  }
  return `p. ${requirement.sourcePageStart}`;
}

function requirementSourceLine(requirement: Requirement) {
  return [requirementSourcePrimary(requirement), requirementSourceSecondary(requirement)]
    .filter(Boolean)
    .join(" · ");
}

function requirementSourcePrimary(requirement: Requirement) {
  return (
    requirement.sourceDocumentName ??
    requirement.clientRequirementSource?.clientOrg?.name ??
    REQUIREMENT_SOURCE_TYPE_LABELS[sourceType(requirement)]
  );
}

function requirementSourceSecondary(requirement: Requirement) {
  return [
    requirement.sourceDocumentName ? REQUIREMENT_SOURCE_TYPE_LABELS[sourceType(requirement)] : undefined,
    requirement.clientRequirementSource?.clientOrg
      ? `Required by ${requirement.clientRequirementSource.clientOrg.name}`
      : undefined,
    pageLabel(requirement),
  ]
    .filter(Boolean)
    .join(" · ");
}

function requirementTableSourceSecondary(requirement: Requirement) {
  return [
    requirement.sourceDocumentName && requirement.clientRequirementSource?.clientOrg
      ? `Required by ${requirement.clientRequirementSource.clientOrg.name}`
      : undefined,
    pageLabel(requirement),
  ]
    .filter(Boolean)
    .join(" · ");
}

function statusMeta(status?: ComplianceStatus) {
  switch (status) {
    case "met":
      return {
        label: "Met",
        className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
        icon: CheckCircle2,
      };
    case "expiring_soon":
      return {
        label: "Expiring",
        className: "border-amber-500/25 bg-amber-500/10 text-amber-500",
        icon: Clock,
      };
    case "unverified":
      return {
        label: "Unverified",
        className: "border-amber-500/25 bg-amber-500/10 text-amber-500",
        icon: AlertCircle,
      };
    case "expired":
    case "not_met":
      return {
        label: status === "expired" ? "Expired" : "Not met",
        className: "border-red-500/25 bg-red-500/10 text-red-500",
        icon: AlertCircle,
      };
    default:
      return {
        label: "Defined",
        className: "border-foreground/10 bg-muted text-muted-foreground",
        icon: ShieldCheck,
      };
  }
}

function StatusBadge({ status }: { status?: ComplianceStatus }) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${meta.className}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function needsAttention(status?: ComplianceStatus) {
  return status === "not_met" || status === "expired";
}

function matchedPolicyIdsForRequirement(requirement: Requirement) {
  return Array.from(
    new Set(
      [
        ...(requirement.complianceCheck?.matchedPolicyIds ?? []),
        requirement.complianceCheck?.matchedPolicy?._id,
      ].filter((id): id is Id<"policies"> => Boolean(id)),
    ),
  );
}

function PolicyTagList({
  policyIds,
  emptyLabel,
}: {
  policyIds: Id<"policies">[];
  emptyLabel?: string;
}) {
  if (policyIds.length === 0) {
    return emptyLabel ? <span className="text-muted-foreground">{emptyLabel}</span> : null;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {policyIds.slice(0, 3).map((policyId) => (
        <PolicyCitation key={policyId} id={policyId} />
      ))}
      {policyIds.length > 3 ? (
        <Badge variant="outline" className="h-5 rounded-full px-1.5 text-tag text-muted-foreground">
          +{policyIds.length - 3}
        </Badge>
      ) : null}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <OperationalPanel as="div" className="p-5">
      <p className="text-base font-medium text-foreground">No coverage requirements yet</p>
      <p className="mt-1 text-base text-muted-foreground">
        Add coverage rules manually or extract them from a lease, client contract, or vendor
        requirement packet.
      </p>
      <PillButton className="mt-4" onClick={onAdd}>
        <FileUp className="h-3.5 w-3.5" />
        Import requirements
      </PillButton>
    </OperationalPanel>
  );
}

function ComplianceMeter({ met, total }: { met: number; total: number }) {
  const percent = total > 0 ? Math.round((met / total) * 100) : 0;
  return (
    <div
      role="meter"
      aria-valuenow={met}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${met} of ${total} met`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-emerald-500"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function OverviewTab({
  requirements,
  onOpenRequirements,
  onAdd,
}: {
  requirements: Requirement[];
  onOpenRequirements: (lineOfBusiness: string) => void;
  onAdd: () => void;
}) {
  const checked = requirements.filter((requirement) => requirement.complianceCheck);
  const lobGroups = new Map<string, Requirement[]>();
  for (const requirement of checked) {
    const key = requirement.lineOfBusiness ?? "UN";
    lobGroups.set(key, [...(lobGroups.get(key) ?? []), requirement]);
  }
  const sortedGroups = Array.from(lobGroups.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (checked.length === 0) return <EmptyState onAdd={onAdd} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {sortedGroups.map(([lob, rows]) => {
          const groupMet = rows.filter(
            (requirement) => requirement.complianceCheck?.status === "met",
          ).length;
          const groupAttention = rows.filter(
            (requirement) => needsAttention(requirement.complianceCheck?.status),
          ).length;
          const groupExpiring = rows.filter(
            (requirement) => requirement.complianceCheck?.status === "expiring_soon",
          ).length;
          return (
            <ActionSurface
              key={lob}
              role="button"
              tabIndex={0}
              onClick={() => onOpenRequirements(lob)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenRequirements(lob);
                }
              }}
              className="cursor-pointer px-4 py-3"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <p className="min-w-0 truncate text-base font-medium text-foreground">
                  {lineDisplayLabel(lob)}
                </p>
                {groupAttention > 0 ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-red-500/25 bg-red-500/10 text-red-500"
                  >
                    {groupAttention} needs attention
                  </Badge>
                ) : groupExpiring > 0 ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-amber-500/25 bg-amber-500/10 text-amber-500"
                  >
                    {groupExpiring} expiring
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
                  >
                    Met
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-label text-muted-foreground">
                {groupMet} of {rows.length} requirements met
              </p>
              <div className="mt-3">
                <ComplianceMeter met={groupMet} total={rows.length} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-label text-muted-foreground">
                <span>{groupMet} met</span>
                <span>{rows.length} total</span>
              </div>
            </ActionSurface>
          );
        })}
      </div>
    </div>
  );
}

function RequirementsTable({
  requirements,
  onSelect,
}: {
  requirements: Requirement[];
  onSelect: (requirementId: Id<"insuranceRequirements">) => void;
}) {
  const sorted = [...requirements].sort((a, b) => {
    const lobCompare = (a.lineOfBusiness ?? "ZZ").localeCompare(b.lineOfBusiness ?? "ZZ");
    return lobCompare !== 0 ? lobCompare : a.title.localeCompare(b.title);
  });
  return (
    <OperationalPanel as="div">
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[13%] px-4">Line</TableHead>
            <TableHead className="w-[21%]">Coverage</TableHead>
            <TableHead className="w-[28%]">Source</TableHead>
            <TableHead className="w-[8%]">Limit</TableHead>
            <TableHead className="w-[8%]">Limit type</TableHead>
            <TableHead className="w-[10%]">Status</TableHead>
            <TableHead className="w-[12%] px-4">Policy match</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((requirement) => {
            const limits = requirement.limits ?? [];
            const policyIds = matchedPolicyIdsForRequirement(requirement);
            const sourceSecondary = requirementTableSourceSecondary(requirement);
            return (
              <TableRow
                key={requirement._id}
                className="cursor-pointer"
                onClick={() => onSelect(requirement._id)}
              >
                <TableCell className="px-4 font-medium text-foreground">
                  {lineDisplayLabel(requirement.lineOfBusiness)}
                </TableCell>
                <TableCell className="max-w-64">
                  <p className="truncate font-medium text-foreground">{requirement.title}</p>
                  {requirement.clientRequirementSource?.clientOrg ? (
                    <p className="truncate text-label text-muted-foreground">
                      From {requirement.clientRequirementSource.clientOrg.name}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-80">
                  <p className="truncate text-foreground">{requirementSourcePrimary(requirement)}</p>
                  {sourceSecondary ? (
                    <p className="truncate text-label text-muted-foreground">{sourceSecondary}</p>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums text-foreground">
                  {limits.length > 0
                    ? limits.map((limit, index) => (
                        <p key={index} className="leading-5">{formatMoneyCompact(limit.amount)}</p>
                      ))
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {limits.length > 0
                    ? limits.map((limit, index) => (
                        <p key={index} className="leading-5">{limitKindLabel(limit.kind)}</p>
                      ))
                    : (requirement.provisions ?? []).length > 0
                      ? "Provisions"
                      : "—"}
                </TableCell>
                <TableCell>
                  {requirement.complianceCheck ? (
                    <StatusBadge status={requirement.complianceCheck.status} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-52 px-4">
                  <div onClick={(event) => event.stopPropagation()}>
                    <PolicyTagList
                      policyIds={policyIds}
                      emptyLabel={requirement.complianceCheck ? "No match" : "—"}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function RequirementsFilterSelect({
  label,
  value,
  valueLabel,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  valueLabel: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(next) => next && onValueChange(next)}>
        <SelectTrigger className="w-full">
          <SelectValue>{valueLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  );
}

function DrawerDetail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 text-base">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 break-words text-foreground">{value}</div>
    </div>
  );
}

function normalizeCheckNote(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase();
}

function latestCheckNote(check: Requirement["complianceCheck"]) {
  const note = check?.notes?.trim();
  const policy = check?.matchedPolicy;
  if (!note) return undefined;
  if (policy) {
    const matchedSummary = `Matched ${policy.carrier ?? "policy"} ${policy.policyNumber ?? ""}`;
    if (normalizeCheckNote(note) === normalizeCheckNote(matchedSummary)) return undefined;
  }
  return note;
}

function RequirementDrawer({
  requirement,
  checking,
  onDeepCheck,
  onArchive,
  onClose,
}: {
  requirement: Requirement;
  checking: boolean;
  onDeepCheck: (requirement: Requirement) => void;
  onArchive: (requirementId: Id<"insuranceRequirements">) => void;
  onClose: () => void;
}) {
  const check = requirement.complianceCheck;
  const policy = check?.matchedPolicy;
  const policyIds = matchedPolicyIdsForRequirement(requirement);
  const checkNote = latestCheckNote(check);
  const canDeepCheck =
    requirement.canArchive !== false &&
    requirement.scope === "own_org" &&
    check &&
    check.status !== "met";
  const detectedLimit = policy?.coverageLimit ?? formatMoney(policy?.detectedLimitAmount);
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={requirement.title}
      actions={check ? <StatusBadge status={check.status} /> : undefined}
      footer={
        <>
          {requirement.canArchive !== false ? (
            <PillButton
              type="button"
              variant="secondary"
              onClick={() => onArchive(requirement._id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Archive
            </PillButton>
          ) : null}
          {canDeepCheck ? (
            <PillButton type="button" disabled={checking} onClick={() => onDeepCheck(requirement)}>
              {checking ? "Checking…" : "Run deeper check"}
            </PillButton>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-base text-muted-foreground">{requirement.requirementText}</p>
        <section className="space-y-2 border-t border-foreground/6 pt-5">
          {requirement.lineOfBusiness ? (
            <DrawerDetail label="Line" value={lineDisplayLabel(requirement.lineOfBusiness)} />
          ) : null}
          {(requirement.limits ?? []).map((limit, index) => (
            <DrawerDetail
              key={index}
              label={limitKindLabel(limit.kind)}
              value={formatMoney(limit.amount) ?? String(limit.amount)}
            />
          ))}
          {requirement.maxDeductible ? (
            <DrawerDetail
              label="Max deductible"
              value={formatMoney(requirement.maxDeductible.amount) ?? ""}
            />
          ) : null}
          {requirement.coverageForm ? (
            <DrawerDetail
              label="Coverage form"
              value={requirement.coverageForm === "claims_made" ? "Claims-made" : "Occurrence"}
            />
          ) : null}
          {(requirement.provisions ?? []).length > 0 ? (
            <DrawerDetail
              label="Provisions"
              value={(requirement.provisions ?? []).map(provisionLabel).join(", ")}
            />
          ) : null}
          {(requirement.requiredForms ?? []).length > 0 ? (
            <DrawerDetail label="Required forms" value={(requirement.requiredForms ?? []).join(", ")} />
          ) : null}
          <DrawerDetail label="Source" value={requirementSourceLine(requirement)} />
        </section>
        {check ? (
          <section className="space-y-2 border-t border-foreground/6 pt-5">
            <p className="text-base font-medium text-muted-foreground/60">
              Latest check
            </p>
            {policy || policyIds.length > 0 ? (
              <>
                {policyIds.length > 0 ? (
                  <DrawerDetail label="Matched policy" value={<PolicyTagList policyIds={policyIds} />} />
                ) : policy ? (
                  <DrawerDetail
                    label="Matched policy"
                    value={[policy.carrier, policy.policyNumber].filter(Boolean).join(" · ")}
                  />
                ) : null}
                {policy?.coverageName ? (
                  <DrawerDetail label="Coverage" value={policy.coverageName} />
                ) : null}
                {detectedLimit ? (
                  <DrawerDetail label="Current limit" value={detectedLimit} />
                ) : null}
                {policy?.expirationDate ? (
                  <DrawerDetail
                    label="Expires"
                    value={formatDisplayDate(
                      policy.expirationDate,
                      policy.expirationDate,
                    )}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-base text-muted-foreground">No current policy match.</p>
            )}
            {checkNote ? (
              <p className="text-base text-muted-foreground">{checkNote}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

function RequirementsLoadingSkeleton() {
  return <OperationalSkeletonList rows={4} />;
}

type RequirementLimitEdit = {
  kind: RequirementLimitKind;
  amount: number;
  label?: string;
};

type RequirementEditValues = {
  title: string;
  lineOfBusiness: string;
  limits?: RequirementLimitEdit[];
  provisions?: RequirementProvision[];
  requirementText: string;
};

type SourceUpdatePatch = {
  title?: string;
  sourceType?: RequirementSourceDocumentType;
};

type LimitDraft = {
  id: string;
  kind: RequirementLimitKind;
  amount: string;
};

function limitDraftsForRequirement(requirement: Requirement): LimitDraft[] {
  return (requirement.limits ?? []).map((limit, index) => ({
    id: `${requirement._id}:${index}`,
    kind: asRequirementLimitKind(limit.kind),
    amount: limit.label ?? formatMoney(limit.amount) ?? String(limit.amount),
  }));
}

function provisionsForRequirement(requirement: Requirement): RequirementProvision[] {
  return (requirement.provisions ?? []).filter((provision): provision is RequirementProvision =>
    (PROVISION_OPTIONS as readonly string[]).includes(provision),
  );
}

type RequirementEditDrafts = {
  title: string;
  lineOfBusiness: string;
  limitDrafts: LimitDraft[];
  provisions: RequirementProvision[];
  requirementText: string;
};

function requirementEditValuesFromDrafts(
  drafts: RequirementEditDrafts,
): RequirementEditValues | "invalid_amount" {
  const limits: RequirementLimitEdit[] = [];
  for (const draft of drafts.limitDrafts) {
    if (!draft.amount.trim()) continue;
    const amount = parseMoneyInput(draft.amount);
    if (amount === undefined) return "invalid_amount";
    limits.push({ kind: draft.kind, amount, label: draft.amount.trim() });
  }
  return {
    title: drafts.title.trim(),
    lineOfBusiness: drafts.lineOfBusiness,
    limits: limits.length > 0 ? limits : undefined,
    provisions: drafts.provisions.length > 0 ? drafts.provisions : undefined,
    requirementText: drafts.requirementText.trim(),
  };
}

function RequirementEditForm({
  requirement,
  onSave,
  onArchive,
}: {
  requirement: Requirement;
  onSave: (values: RequirementEditValues) => Promise<void>;
  onArchive: () => void;
}) {
  const [title, setTitle] = useState(requirement.title);
  const [lineOfBusiness, setLineOfBusiness] = useState(requirement.lineOfBusiness ?? "CGL");
  const [limitDrafts, setLimitDrafts] = useState<LimitDraft[]>(() =>
    limitDraftsForRequirement(requirement),
  );
  const [provisions, setProvisions] = useState<RequirementProvision[]>(() =>
    provisionsForRequirement(requirement),
  );
  const [requirementText, setRequirementText] = useState(requirement.requirementText);
  const [textFieldFocused, setTextFieldFocused] = useState(false);
  const editValues = requirementEditValuesFromDrafts({
    title,
    lineOfBusiness,
    limitDrafts,
    provisions,
    requirementText,
  });
  const validEditValues = editValues === "invalid_amount" ? null : editValues;
  const editValueKey = JSON.stringify({
    title,
    lineOfBusiness,
    limitDrafts,
    provisions,
    requirementText,
  });
  const autoSave = useLocalFirstAutoSave({
    mutationName: `compliance.updateRequirement.${requirement._id}`,
    args: validEditValues ?? {
      title: "",
      lineOfBusiness,
      requirementText: "",
    },
    valueKey: editValueKey,
    resetKey: requirement._id,
    canSave:
      !!validEditValues?.title &&
      !!validEditValues.requirementText,
    autoSave: !textFieldFocused,
    delayMs: 0,
    flush: onSave,
    errorMessage: "The requirement could not be saved.",
  });

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
        Title
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => setTextFieldFocused(true)}
          onBlur={() => {
            setTextFieldFocused(false);
            void autoSave.saveNow();
          }}
          required
        />
        {!title.trim() ? <span className="text-destructive">Title is required.</span> : null}
      </label>
      <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
        Line
        <Select
          value={lineOfBusiness}
          onValueChange={(value) => {
            if (!value || value === lineOfBusiness) return;
            setLineOfBusiness(value);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{lobLabel(lineOfBusiness)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COMMON_LOBS.map((code) => (
              <SelectItem key={code} value={code}>{lobLabel(code)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <FormSection
        title="Limits"
        action={
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={() =>
              setLimitDrafts((current) => [
                ...current,
                {
                  id: `limit:${dayjs().valueOf()}:${current.length}`,
                  kind: "per_occurrence",
                  amount: "",
                },
              ])
            }
          >
            Add limit
          </PillButton>
        }
      >
        {editValues === "invalid_amount" ? (
          <p className="text-label text-destructive">Enter a valid limit amount.</p>
        ) : null}
        {limitDrafts.length === 0 ? (
          <p className="text-base text-muted-foreground">
            No explicit limits. Add one or rely on provisions.
          </p>
        ) : (
          <div className="space-y-2">
            {limitDrafts.map((draft) => (
              <div
                key={draft.id}
                className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2"
              >
                <Select
                  value={draft.kind}
                  onValueChange={(value) => {
                    if (!value || value === draft.kind) return;
                    const next = limitDrafts.map((item) =>
                      item.id === draft.id
                        ? { ...item, kind: value as RequirementLimitKind }
                        : item,
                    );
                    setLimitDrafts(next);
                  }}
                >
                  <SelectTrigger
                    className="w-full min-w-0"
                    aria-label="Limit type"
                  >
                    <SelectValue>{REQUIREMENT_LIMIT_KIND_LABELS[draft.kind]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LIMIT_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {REQUIREMENT_LIMIT_KIND_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={draft.amount}
                  onChange={(event) =>
                    setLimitDrafts((current) =>
                      current.map((item) =>
                        item.id === draft.id
                          ? { ...item, amount: event.target.value }
                          : item,
                      ),
                    )
                  }
                  onFocus={() => setTextFieldFocused(true)}
                  onBlur={() => {
                    setTextFieldFocused(false);
                    void autoSave.saveNow();
                  }}
                  placeholder="$1,000,000"
                  aria-label="Limit amount"
                />
                <PillButton
                  type="button"
                  variant="icon"
                  onClick={() => {
                    const next = limitDrafts.filter((item) => item.id !== draft.id);
                    setLimitDrafts(next);
                  }}
                  aria-label="Remove limit"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        )}
      </FormSection>
      <div className="flex flex-wrap gap-2">
        {PROVISION_OPTIONS.map((option) => (
          <PillButton
            key={option}
            type="button"
            size="compact"
            variant={provisions.includes(option) ? "primary" : "secondary"}
            onClick={() => {
              const next = provisions.includes(option)
                ? provisions.filter((item) => item !== option)
                : [...provisions, option];
              setProvisions(next);
            }}
          >
            {REQUIREMENT_PROVISION_LABELS[option]}
          </PillButton>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
        Requirement
        <Textarea
          className="min-h-28 resize-y"
          rows={5}
          value={requirementText}
          onChange={(event) => setRequirementText(event.target.value)}
          onFocus={() => setTextFieldFocused(true)}
          onBlur={() => {
            setTextFieldFocused(false);
            void autoSave.saveNow();
          }}
          required
        />
        {!requirementText.trim() ? (
          <span className="text-destructive">Requirement text is required.</span>
        ) : null}
      </label>
      <div className="flex items-center justify-between gap-3">
        <AutoSaveStatus status={autoSave.status} />
        <PillButton
          type="button"
          size="compact"
          variant="secondary"
          onClick={onArchive}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Archive requirement
        </PillButton>
      </div>
    </div>
  );
}

function requirementDrawerSummary(requirement: Requirement) {
  const limits = requirement.limits ?? [];
  const limitSummary =
    limits.length > 0
      ? limits
          .map((limit) => `${limitKindLabel(limit.kind)} ${formatMoneyCompact(limit.amount)}`)
          .join(", ")
      : (requirement.provisions ?? []).length > 0
        ? (requirement.provisions ?? []).map(provisionLabel).join(", ")
        : "No limit";
  return [lineDisplayLabel(requirement.lineOfBusiness), limitSummary].join(" · ");
}

function SourceDrawer({
  source,
  requirements,
  archiving,
  onUpdateSource,
  onSaveRequirement,
  onArchiveRequirement,
  onArchiveSource,
  onClose,
}: {
  source: RequirementSource;
  requirements: Requirement[] | undefined;
  archiving: boolean;
  onUpdateSource: (source: RequirementSource, patch: SourceUpdatePatch) => Promise<void>;
  onSaveRequirement: (
    requirement: Requirement,
    values: RequirementEditValues,
  ) => Promise<void>;
  onArchiveRequirement: (requirementId: Id<"insuranceRequirements">) => Promise<void>;
  onArchiveSource: (sourceId: Id<"requirementSourceDocuments">) => Promise<boolean>;
  onClose: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(source.title);
  const [sourceTypeDraft, setSourceTypeDraft] = useState<RequirementSourceDocumentType>(
    source.sourceType,
  );
  const [titleFocused, setTitleFocused] = useState(false);
  const [expandedRequirementId, setExpandedRequirementId] =
    useState<Id<"insuranceRequirements"> | null>(null);

  const sourceAutoSave = useLocalFirstAutoSave({
    mutationName: `compliance.updateRequirementSource.${source._id}`,
    args: {
      title: titleDraft.trim(),
      sourceType: sourceTypeDraft,
    },
    resetKey: source._id,
    canSave: !!titleDraft.trim(),
    autoSave: !titleFocused,
    delayMs: 0,
    flush: (args) => onUpdateSource(source, args),
    errorMessage: "The requirement source could not be saved.",
  });

  async function archiveSource() {
    const archived = await onArchiveSource(source._id);
    if (archived) onClose();
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Requirement source"
      actions={<AutoSaveStatus status={sourceAutoSave.status} />}
      footer={
        <PillButton
          type="button"
          variant="secondary"
          disabled={archiving}
          onClick={() => void archiveSource()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {archiving ? "Archiving..." : "Archive source"}
        </PillButton>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Name
            <Input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => {
                setTitleFocused(false);
                void sourceAutoSave.saveNow();
              }}
            />
            {!titleDraft.trim() ? (
              <span className="text-destructive">Source name is required.</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Source type
            <Select
              value={sourceTypeDraft}
              onValueChange={(value) => {
                if (value) setSourceTypeDraft(value as RequirementSourceDocumentType);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{REQUIREMENT_SOURCE_TYPE_LABELS[sourceTypeDraft]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUIREMENT_SOURCE_DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {REQUIREMENT_SOURCE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </section>
        <section className="space-y-2 border-t border-foreground/6 pt-5">
          {source.fileName ? <DrawerDetail label="File" value={source.fileName} /> : null}
          <DrawerDetail
            label="Added"
            value={formatDisplayDate(source.createdAt)}
          />
          <DrawerDetail label="Requirements" value={source.requirementCount} />
        </section>
        <FormSection
          title="Requirements"
          description="Edit the coverage requirements extracted from this source."
        >
          {requirements === undefined ? (
            <OperationalSkeletonList rows={3} />
          ) : requirements.length === 0 ? (
            <OperationalPanel as="div" className="p-4">
              <p className="text-base text-muted-foreground">
                No active requirements are attached to this source.
              </p>
            </OperationalPanel>
          ) : (
            <div className="space-y-2">
              {requirements.map((requirement) => {
                const expanded = expandedRequirementId === requirement._id;
                return (
                  <div
                    key={requirement._id}
                    className="rounded-md border border-foreground/8 bg-background"
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-3 text-left"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedRequirementId(expanded ? null : requirement._id)
                      }
                    >
                      {expanded ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium text-foreground">
                          {requirement.title}
                        </span>
                        <span className="block truncate text-label text-muted-foreground">
                          {requirementDrawerSummary(requirement)}
                        </span>
                      </span>
                    </button>
                    {expanded ? (
                      <div className="border-t border-foreground/6 px-3 pb-3 pt-3">
                        <RequirementEditForm
                          requirement={requirement}
                          onSave={(values) => onSaveRequirement(requirement, values)}
                          onArchive={() => void onArchiveRequirement(requirement._id)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </FormSection>
      </div>
    </SettingsDrawer>
  );
}

function RequirementSourcesTable({
  sources,
  onSelect,
}: {
  sources: RequirementSource[];
  onSelect: (sourceId: Id<"requirementSourceDocuments">) => void;
}) {
  if (sources.length === 0) {
    return (
      <OperationalPanel as="div" className="p-5">
        <p className="text-base font-medium text-foreground">No requirement sources yet</p>
        <p className="mt-1 text-base text-muted-foreground">
          Imported leases, client contracts, and vendor requirement packets will appear here.
        </p>
      </OperationalPanel>
    );
  }

  return (
    <OperationalPanel as="div">
      <Table className="min-w-[840px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[44%] px-4">Name</TableHead>
            <TableHead className="w-[22%]">Source type</TableHead>
            <TableHead className="w-[14%]">Requirements</TableHead>
            <TableHead className="w-[20%] px-4">Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow
              key={source._id}
              className="cursor-pointer"
              onClick={() => onSelect(source._id)}
            >
              <TableCell className="max-w-72 px-4">
                <p className="truncate font-medium text-foreground">{source.title}</p>
                {source.fileName ? (
                  <p className="mt-1 truncate text-label text-muted-foreground">
                    {source.fileName}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {REQUIREMENT_SOURCE_TYPE_LABELS[source.sourceType]}
              </TableCell>
              <TableCell className="tabular-nums text-foreground">
                {source.requirementCount}
              </TableCell>
              <TableCell className="px-4 text-muted-foreground">
                {formatDisplayDate(source.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

export function CompliancePage() {
  const router = useRouter();
  const currentOrg = useActiveOrgContext();
  useEffect(() => {
    if (currentOrg?.orgType === "broker") router.replace("/clients");
  }, [currentOrg?.orgType, router]);

  const isBroker = currentOrg?.orgType === "broker";
  const orgId = !isBroker
    ? (currentOrg?.orgId as Id<"organizations"> | undefined)
    : undefined;
  const showConnectFeatures = isFeatureEnabled(currentOrg, "connect_features");

  const requirements = useCachedQuery(
    "compliance.listRequirements",
    complianceApi.compliance.listRequirements,
    orgId ? { orgId } : "skip",
  ) as Requirement[] | undefined;
  const requirementSources = useCachedQuery(
    "compliance.listRequirementSources",
    complianceApi.compliance.listRequirementSources,
    orgId ? { orgId } : "skip",
  ) as RequirementSource[] | undefined;
  const vendorRowsResult = useCachedConnectedVendors(
    orgId && showConnectFeatures ? orgId : undefined,
  ) as ConnectedOrgRow[] | undefined;
  const clientRowsResult = useCachedQuery(
    "connectedOrgs.listClients",
    complianceApi.connectedOrgs.listClients,
    orgId && showConnectFeatures ? { orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;

  const vendorRows = showConnectFeatures ? vendorRowsResult : [];
  const clientRows = showConnectFeatures ? clientRowsResult : [];
  const updateRequirements = useUpdateCachedQuery<Requirement[], { orgId: Id<"organizations"> }>("compliance.listRequirements");
  const updateRequirementSources = useUpdateCachedQuery<RequirementSource[], { orgId: Id<"organizations"> }>("compliance.listRequirementSources");
  const upsertRequirement = useMutation(complianceApi.compliance.upsertRequirement);
  const archiveRequirement = useMutation(complianceApi.compliance.archiveRequirement);
  const updateRequirementSource = useMutation(complianceApi.compliance.updateRequirementSource);
  const archiveRequirementSources = useMutation(complianceApi.compliance.archiveRequirementSources);
  const generateRequirementImportUploadUrl = useMutation(complianceApi.compliance.generateRequirementImportUploadUrl);
  const importRequirements = useAction(complianceApi.actions.complianceRequirements.importRequirements);
  const recheckOwnRequirement = useAction(complianceApi.actions.complianceReview.recheckOwnRequirement);

  const [view, setView] = useState<ComplianceView>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"bulk" | "manual">("bulk");
  const [requirementScope, setRequirementScope] = useState<RequirementScope>("own_org");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [limitFilter, setLimitFilter] = useState<LimitFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedRequirementId, setSelectedRequirementId] = useState<Id<"insuranceRequirements"> | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<Id<"requirementSourceDocuments"> | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceTypeValue, setSourceTypeValue] = useState<RequirementSourceDocumentType>("vendor_requirements");
  const [title, setTitle] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState("CGL");
  const [limitKind, setLimitKind] = useState<RequirementLimitKind>("per_occurrence");
  const [limitAmount, setLimitAmount] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [provisions, setProvisions] = useState<RequirementProvision[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [archivingSources, setArchivingSources] = useState(false);
  const [checkingRequirementId, setCheckingRequirementId] = useState<Id<"insuranceRequirements"> | null>(null);

  const hasActiveClients = (clientRows ?? []).some((row) => row.status === "active");
  const hasActiveVendors = (vendorRows ?? []).some((row) => row.status === "active");
  const isPureVendorAccount =
    showConnectFeatures &&
    clientRows !== undefined &&
    vendorRows !== undefined &&
    hasActiveClients &&
    !hasActiveVendors;
  const activeRequirementScope: RequirementScope =
    !showConnectFeatures || isPureVendorAccount ? "own_org" : requirementScope;
  const navigationValue =
    view === "requirements" && showConnectFeatures ? activeRequirementScope : view;

  const scopedRequirements = useMemo(
    () =>
      (requirements ?? []).filter((requirement) => requirement.scope === activeRequirementScope),
    [activeRequirementScope, requirements],
  );
  const sourceFilters = useMemo(() => {
    const present = Array.from(new Set(scopedRequirements.map(sourceType)));
    return ["all", ...present] as SourceFilter[];
  }, [scopedRequirements]);
  const lineFilters = useMemo(() => {
    const present = Array.from(
      new Set(scopedRequirements.map((requirement) => lineFilterValue(requirement.lineOfBusiness))),
    ).sort((a, b) => lineFilterLabel(a).localeCompare(lineFilterLabel(b)));
    return ["all", ...present] as LineFilter[];
  }, [scopedRequirements]);
  const limitFilters = useMemo(() => {
    const present = Array.from(
      new Set(scopedRequirements.flatMap(requirementLimitFilters)),
    ).sort((a, b) => limitFilterLabel(a).localeCompare(limitFilterLabel(b)));
    return ["all", ...present] as LimitFilter[];
  }, [scopedRequirements]);
  const statusFilters = useMemo(() => {
    const order: StatusFilter[] = ["met", "not_met", "expired", "expiring_soon", "unverified", "defined"];
    const present = new Set(scopedRequirements.map(statusFilterValue));
    return ["all", ...order.filter((status) => present.has(status))] as StatusFilter[];
  }, [scopedRequirements]);
  const effectiveSourceFilter = sourceFilters.includes(sourceFilter) ? sourceFilter : "all";
  const effectiveLineFilter = lineFilters.includes(lineFilter) ? lineFilter : "all";
  const effectiveLimitFilter = limitFilters.includes(limitFilter) ? limitFilter : "all";
  const effectiveStatusFilter = statusFilters.includes(statusFilter) ? statusFilter : "all";
  const visibleRequirements = scopedRequirements.filter(
    (requirement) =>
      (effectiveSourceFilter === "all" || sourceType(requirement) === effectiveSourceFilter) &&
      (effectiveLineFilter === "all" || lineFilterValue(requirement.lineOfBusiness) === effectiveLineFilter) &&
      (effectiveLimitFilter === "all" || requirementLimitFilters(requirement).includes(effectiveLimitFilter)) &&
      (effectiveStatusFilter === "all" || statusFilterValue(requirement) === effectiveStatusFilter),
  );
  const selectedRequirement =
    (requirements ?? []).find((requirement) => requirement._id === selectedRequirementId) ?? null;
  const selectedSource =
    (requirementSources ?? []).find((source) => source._id === selectedSourceId) ?? null;
  const selectedSourceRequirements = selectedSource
    ? requirements?.filter((requirement) => requirement.sourceDocumentId === selectedSource._id)
    : undefined;

  if (isBroker) return null;

  async function submitRequirement(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    const amount = parseMoneyInput(limitAmount);
    if (amount === undefined && provisions.length === 0) {
      toast.error("Add a limit amount or at least one provision");
      return;
    }
    setSubmitting(true);
    try {
      await upsertRequirement({
        orgId,
        kind: "coverage",
        scope: activeRequirementScope,
        title,
        requirementText,
        lineOfBusiness,
        limits:
          amount !== undefined
            ? [{ kind: limitKind, amount, label: limitAmount.trim() }]
            : undefined,
        provisions,
        sourceType: "manual",
      });
      toast.success("Requirement saved");
      setTitle("");
      setRequirementText("");
      setLimitAmount("");
      setProvisions([]);
      setDrawerOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save requirement");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeRequirement(requirementId: Id<"insuranceRequirements">) {
    if (!orgId) return;
    const archivedRequirement =
      (requirements ?? []).find((requirement) => requirement._id === requirementId) ?? null;
    try {
      await archiveRequirement({ orgId, requirementId });
      await updateRequirements({ orgId }, (current) =>
        current.filter((requirement) => requirement._id !== requirementId),
      );
      if (archivedRequirement?.sourceDocumentId) {
        await updateRequirementSources({ orgId }, (current) =>
          current.map((source) =>
            source._id === archivedRequirement.sourceDocumentId
              ? {
                  ...source,
                  requirementCount: Math.max(0, source.requirementCount - 1),
                }
              : source,
          ),
        );
      }
      setSelectedRequirementId(null);
      toast.success("Requirement archived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to archive requirement");
    }
  }

  async function runDeeperCheck(requirement: Requirement) {
    if (!orgId) return;
    setCheckingRequirementId(requirement._id);
    try {
      const result = (await recheckOwnRequirement({
        orgId,
        requirementId: requirement._id,
      })) as Requirement["complianceCheck"];
      await updateRequirements({ orgId }, (current) =>
        current.map((item) =>
          item._id === requirement._id
            ? {
                ...item,
                complianceCheck: {
                  ...item.complianceCheck,
                  ...result,
                  status: result?.status ?? item.complianceCheck?.status ?? "unverified",
                  notes: result?.notes ? `Deep check: ${result.notes}` : result?.matchedSummary,
                  checkedBy: "agent",
                },
              }
            : item,
        ),
      );
      toast.success("Compliance checked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to check compliance");
    } finally {
      setCheckingRequirementId(null);
    }
  }

  async function generateRequirements() {
    if (!orgId) return;
    if (!sourceText.trim() && !sourceFile) {
      toast.error("Paste text or upload a document first");
      return;
    }
    setImporting(true);
    try {
      let fileId: Id<"_storage"> | undefined;
      if (sourceFile) {
        const uploadUrl = await generateRequirementImportUploadUrl({ orgId });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": sourceFile.type || "application/octet-stream" },
          body: sourceFile,
        });
        if (!response.ok) throw new Error("Document upload failed");
        const payload = (await response.json()) as { storageId: string };
        fileId = payload.storageId as Id<"_storage">;
      }
      const result = (await importRequirements({
        orgId,
        pastedText: sourceText.trim() || undefined,
        fileId,
        fileName: sourceFile?.name,
        contentType: sourceFile?.type,
        sourceType: sourceTypeValue,
        sourceName: sourceName.trim() || undefined,
        scope: activeRequirementScope,
      })) as { createdCount: number };
      toast[result.createdCount === 0 ? "info" : "success"](
        result.createdCount === 0
          ? "No new coverage requirements found"
          : `Created ${result.createdCount} requirement${result.createdCount === 1 ? "" : "s"}`,
      );
      setSourceText("");
      setSourceFile(null);
      setSourceName("");
      setDrawerOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate requirements");
    } finally {
      setImporting(false);
    }
  }

  function openAddRequirements() {
    setDrawerMode("bulk");
    setSelectedRequirementId(null);
    setSelectedSourceId(null);
    setDrawerOpen(true);
  }

  async function updateSource(source: RequirementSource, patch: SourceUpdatePatch) {
    if (!orgId) throw new Error("Organization required");
    const now = dayjs().valueOf();
    await updateRequirementSources({ orgId }, (current) =>
      current.map((item) =>
        item._id === source._id
          ? {
              ...item,
              ...patch,
              updatedAt: now,
            }
          : item,
      ),
    );
    await updateRequirements({ orgId }, (current) =>
      current.map((requirement) =>
        requirement.sourceDocumentId === source._id
          ? {
              ...requirement,
              sourceDocumentName: patch.title ?? requirement.sourceDocumentName,
              sourceType: patch.sourceType ?? requirement.sourceType,
              updatedAt: now,
            }
          : requirement,
      ),
    );
    try {
      await updateRequirementSource({
        orgId,
        sourceDocumentId: source._id,
        ...patch,
      });
    } catch (error) {
      await updateRequirementSources({ orgId }, (current) =>
        current.map((item) => (item._id === source._id ? source : item)),
      );
      await updateRequirements({ orgId }, (current) =>
        current.map((requirement) =>
          requirement.sourceDocumentId === source._id
            ? {
                ...requirement,
                sourceDocumentName: source.title,
                sourceType: source.sourceType,
              }
            : requirement,
        ),
      );
      throw error;
    }
  }

  async function saveRequirementEdits(
    requirement: Requirement,
    values: RequirementEditValues,
  ) {
    if (!orgId) throw new Error("Organization required");
    const now = dayjs().valueOf();
    const nextRequirement: Requirement = {
      ...requirement,
      ...values,
      updatedAt: now,
    };
    await updateRequirements({ orgId }, (current) =>
      current.map((item) => (item._id === requirement._id ? nextRequirement : item)),
    );
    try {
      await upsertRequirement({
        orgId,
        requirementId: requirement._id,
        kind: requirement.kind ?? "coverage",
        scope: requirement.scope,
        title: values.title,
        requirementText: values.requirementText,
        lineOfBusiness: values.lineOfBusiness,
        limits: values.limits,
        maxDeductible: requirement.maxDeductible,
        coverageForm: requirement.coverageForm,
        provisions: values.provisions,
        requiredForms: requirement.requiredForms,
        sourceDocumentId: requirement.sourceDocumentId,
        sourceDocumentName: requirement.sourceDocumentName,
        sourceType: requirement.sourceType,
        sourceExcerpt: requirement.sourceExcerpt,
        sourcePageStart: requirement.sourcePageStart,
        sourcePageEnd: requirement.sourcePageEnd,
      });
    } catch (error) {
      await updateRequirements({ orgId }, (current) =>
        current.map((item) => (item._id === requirement._id ? requirement : item)),
      );
      throw error;
    }
  }

  async function archiveSources(sourceIds: Id<"requirementSourceDocuments">[]) {
    if (!orgId || sourceIds.length === 0) return false;
    setArchivingSources(true);
    try {
      const result = (await archiveRequirementSources({
        orgId,
        sourceDocumentIds: sourceIds,
      })) as { archivedSourceCount: number; archivedRequirementCount: number };
      const archivedIds = new Set(sourceIds);
      await updateRequirementSources({ orgId }, (current) =>
        current.filter((source) => !archivedIds.has(source._id)),
      );
      await updateRequirements({ orgId }, (current) =>
        current.filter((requirement) => !requirement.sourceDocumentId || !archivedIds.has(requirement.sourceDocumentId)),
      );
      setSelectedSourceId((current) => (current && archivedIds.has(current) ? null : current));
      toast.success(
        result.archivedRequirementCount > 0
          ? `Archived ${result.archivedRequirementCount} requirement${result.archivedRequirementCount === 1 ? "" : "s"}`
          : "Requirement source archived",
      );
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to archive sources");
      return false;
    } finally {
      setArchivingSources(false);
    }
  }

  const addPanel = (
    <SettingsDrawer
      open={drawerOpen}
      onOpenChange={setDrawerOpen}
      title="Add requirements"
      footer={
        <>
          <PillButton type="button" variant="secondary" disabled={submitting || importing} onClick={() => setDrawerOpen(false)}>
            Cancel
          </PillButton>
          {drawerMode === "manual" ? (
            <PillButton type="submit" form="manual-compliance-requirement" disabled={submitting}>
              {submitting ? "Saving..." : "Save requirement"}
            </PillButton>
          ) : (
            <PillButton type="button" disabled={importing || (!sourceText.trim() && !sourceFile)} onClick={() => void generateRequirements()}>
              {importing ? "Generating..." : "Generate requirements"}
            </PillButton>
          )}
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Tabs value={drawerMode} onValueChange={(value) => setDrawerMode(value as "bulk" | "manual")}>
          <TabsList variant="pill">
            <TabsTrigger value="bulk">Extract</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
          </TabsList>
        </Tabs>
        {drawerMode === "bulk" ? (
          <>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Source name
              <Input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                placeholder={sourceFile?.name ?? "Client vendor requirements"}
                disabled={importing}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Source type
              <Select value={sourceTypeValue} onValueChange={(value) => setSourceTypeValue(value as RequirementSourceDocumentType)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{REQUIREMENT_SOURCE_TYPE_LABELS[sourceTypeValue]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REQUIREMENT_SOURCE_DOCUMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {REQUIREMENT_SOURCE_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Requirement text
              <Textarea className="min-h-0 flex-1 resize-none field-sizing-fixed" rows={12} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste insurance requirements or contract language." disabled={importing} />
            </label>
            <FileDropZone
              accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/json"
              disabled={importing}
              idleLabel="Upload requirement document"
              busyLabel="Generating requirements..."
              hint="TXT, Markdown, PDF, DOCX, CSV, or JSON"
              onFile={(file) => {
                setSourceFile(file);
                setSourceName((current) => current.trim() || file.name);
              }}
            />
            {sourceFile ? (
              <OperationalPanel as="div" className="flex items-center justify-between gap-3 px-3 py-2">
                <p className="min-w-0 truncate text-base font-medium text-foreground">{sourceFile.name}</p>
                <PillButton type="button" size="compact" variant="secondary" disabled={importing} onClick={() => setSourceFile(null)}>
                  Remove
                </PillButton>
              </OperationalPanel>
            ) : null}
          </>
        ) : (
          <form id="manual-compliance-requirement" onSubmit={submitRequirement} className="flex min-h-0 flex-1 flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Title
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="General liability minimum" required />
            </label>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Line
              <Select value={lineOfBusiness} onValueChange={(value) => value && setLineOfBusiness(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{lobLabel(lineOfBusiness)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COMMON_LOBS.map((code) => (
                    <SelectItem key={code} value={code}>{lobLabel(code)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
              <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                Limit
                <Select value={limitKind} onValueChange={(value) => setLimitKind(value as RequirementLimitKind)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{REQUIREMENT_LIMIT_KIND_LABELS[limitKind]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LIMIT_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{REQUIREMENT_LIMIT_KIND_LABELS[option]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                Amount
                <Input value={limitAmount} onChange={(event) => setLimitAmount(event.target.value)} placeholder="$1,000,000" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {PROVISION_OPTIONS.map((option) => (
                <PillButton key={option} type="button" size="compact" variant={provisions.includes(option) ? "primary" : "secondary"} onClick={() => setProvisions((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])}>
                  {REQUIREMENT_PROVISION_LABELS[option]}
                </PillButton>
              ))}
            </div>
            <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Requirement
              <Textarea className="min-h-0 flex-1 resize-none field-sizing-fixed" rows={8} value={requirementText} onChange={(event) => setRequirementText(event.target.value)} placeholder="Describe the coverage requirement in plain language." required />
            </label>
          </form>
        )}
      </div>
    </SettingsDrawer>
  );

  const detailPanel = selectedRequirement ? (
    <RequirementDrawer
      requirement={selectedRequirement}
      checking={checkingRequirementId === selectedRequirement._id}
      onDeepCheck={(row) => void runDeeperCheck(row)}
      onArchive={(id) => void removeRequirement(id)}
      onClose={() => setSelectedRequirementId(null)}
    />
  ) : null;
  const sourcePanel = selectedSource ? (
    <SourceDrawer
      key={selectedSource._id}
      source={selectedSource}
      requirements={selectedSourceRequirements}
      archiving={archivingSources}
      onUpdateSource={updateSource}
      onSaveRequirement={saveRequirementEdits}
      onArchiveRequirement={removeRequirement}
      onArchiveSource={(sourceId) => archiveSources([sourceId])}
      onClose={() => setSelectedSourceId(null)}
    />
  ) : null;

  return (
    <AppShell
      actions={
        <PillButton size="compact" variant="primary" onClick={openAddRequirements}>
          <Plus className="h-3.5 w-3.5" />
          Add requirements
        </PillButton>
      }
      rightPanel={detailPanel ?? sourcePanel ?? addPanel}
    >
      <div className="flex w-full flex-col gap-4">
        <Tabs
          value={navigationValue}
          onValueChange={(value) => {
            if (value === "own_org" || value === "vendors") {
              setRequirementScope(value);
              setView("requirements");
              return;
            }
            setView(value as ComplianceView);
          }}
        >
          <TabsList variant="pill">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {showConnectFeatures ? (
              <>
                <TabsTrigger value="own_org">My requirements</TabsTrigger>
                {!isPureVendorAccount ? (
                  <TabsTrigger value="vendors">Vendor requirements</TabsTrigger>
                ) : null}
              </>
            ) : (
              <TabsTrigger value="requirements">Requirements</TabsTrigger>
            )}
            <TabsTrigger value="sources">Sources</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "sources" ? (
          requirementSources === undefined ? (
            <RequirementsLoadingSkeleton />
          ) : (
            <RequirementSourcesTable
              sources={requirementSources}
              onSelect={(sourceId) => {
                setSelectedSourceId(sourceId);
                setSelectedRequirementId(null);
                setDrawerOpen(false);
              }}
            />
          )
        ) : requirements === undefined ||
        (showConnectFeatures && (clientRows === undefined || vendorRows === undefined)) ? (
          <RequirementsLoadingSkeleton />
        ) : view === "overview" ? (
          <OverviewTab
            requirements={requirements}
            onOpenRequirements={(line) => {
              setSourceFilter("all");
              setLineFilter(lineFilterValue(line));
              setLimitFilter("all");
              setStatusFilter("all");
              setView("requirements");
            }}
            onAdd={openAddRequirements}
          />
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <RequirementsFilterSelect
                label="Source"
                value={effectiveSourceFilter}
                valueLabel={sourceLabel(effectiveSourceFilter)}
                onValueChange={(value) => setSourceFilter(value as SourceFilter)}
              >
                {sourceFilters.map((filter) => (
                  <SelectItem key={filter} value={filter}>{sourceLabel(filter)}</SelectItem>
                ))}
              </RequirementsFilterSelect>
              <RequirementsFilterSelect
                label="Line"
                value={effectiveLineFilter}
                valueLabel={lineFilterLabel(effectiveLineFilter)}
                onValueChange={(value) => setLineFilter(value as LineFilter)}
              >
                {lineFilters.map((filter) => (
                  <SelectItem key={filter} value={filter}>{lineFilterLabel(filter)}</SelectItem>
                ))}
              </RequirementsFilterSelect>
              <RequirementsFilterSelect
                label="Limit type"
                value={effectiveLimitFilter}
                valueLabel={limitFilterLabel(effectiveLimitFilter)}
                onValueChange={(value) => setLimitFilter(value as LimitFilter)}
              >
                {limitFilters.map((filter) => (
                  <SelectItem key={filter} value={filter}>{limitFilterLabel(filter)}</SelectItem>
                ))}
              </RequirementsFilterSelect>
              <RequirementsFilterSelect
                label="Status"
                value={effectiveStatusFilter}
                valueLabel={statusFilterLabel(effectiveStatusFilter)}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              >
                {statusFilters.map((filter) => (
                  <SelectItem key={filter} value={filter}>{statusFilterLabel(filter)}</SelectItem>
                ))}
              </RequirementsFilterSelect>
            </div>
            {visibleRequirements.length === 0 ? (
              <EmptyState onAdd={openAddRequirements} />
            ) : (
              <RequirementsTable
                requirements={visibleRequirements}
                onSelect={(requirementId) => {
                  setSelectedRequirementId(requirementId);
                  setSelectedSourceId(null);
                  setDrawerOpen(false);
                }}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
