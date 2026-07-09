"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileUp,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ActionSurfaceButton } from "@/components/ui/action-surface";
import { Badge } from "@/components/ui/badge";
import { FileDropZone } from "@/components/ui/file-drop";
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

type RequirementScope = "vendors" | "own_org";
type ComplianceStatus = "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
type SourceFilter = "all" | RequirementSourceType;
type ComplianceView = "overview" | "requirements";

type ComplianceApi = {
  compliance: {
    listRequirements: FunctionReference<"query">;
    upsertRequirement: FunctionReference<"mutation">;
    archiveRequirement: FunctionReference<"mutation">;
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

const LIMIT_KIND_OPTIONS: RequirementLimitKind[] = [
  "per_occurrence",
  "general_aggregate",
  "products_completed_ops_aggregate",
  "per_claim",
  "aggregate",
  "combined_single_limit",
  "el_each_accident",
  "el_disease_each_employee",
  "el_disease_policy_limit",
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
  scope: RequirementScope;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  provisions?: string[];
  requiredForms?: string[];
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

function requirementSourceLine(requirement: Requirement) {
  const page =
    requirement.sourcePageStart &&
    (requirement.sourcePageEnd && requirement.sourcePageEnd !== requirement.sourcePageStart
      ? `pp. ${requirement.sourcePageStart}-${requirement.sourcePageEnd}`
      : `p. ${requirement.sourcePageStart}`);
  return [
    REQUIREMENT_SOURCE_TYPE_LABELS[sourceType(requirement)],
    requirement.sourceDocumentName,
    page,
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
  onOpenRequirements: () => void;
  onAdd: () => void;
}) {
  const checked = requirements.filter((requirement) => requirement.complianceCheck);
  const met = checked.filter((requirement) => requirement.complianceCheck?.status === "met");
  const attention = checked.filter((requirement) =>
    needsAttention(requirement.complianceCheck?.status),
  );
  const expiring = checked.filter(
    (requirement) => requirement.complianceCheck?.status === "expiring_soon",
  );

  const lobGroups = new Map<string, Requirement[]>();
  for (const requirement of checked) {
    const key = requirement.lineOfBusiness ?? "UN";
    lobGroups.set(key, [...(lobGroups.get(key) ?? []), requirement]);
  }
  const sortedGroups = Array.from(lobGroups.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (checked.length === 0) return <EmptyState onAdd={onAdd} />;

  const stats = [
    { label: "Met", count: met.length, icon: CheckCircle2, iconClass: "text-emerald-500" },
    {
      label: "Not met",
      count: attention.length,
      icon: AlertCircle,
      iconClass: attention.length > 0 ? "text-red-500" : "text-muted-foreground",
    },
    {
      label: "Expiring soon",
      count: expiring.length,
      icon: Clock,
      iconClass: expiring.length > 0 ? "text-amber-500" : "text-muted-foreground",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <OperationalPanel key={stat.label} as="div" className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-label text-muted-foreground">
              <stat.icon className={`h-3.5 w-3.5 ${stat.iconClass}`} />
              {stat.label}
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {stat.count}
            </p>
          </OperationalPanel>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {sortedGroups.map(([lob, rows]) => {
          const groupMet = rows.filter(
            (requirement) => requirement.complianceCheck?.status === "met",
          ).length;
          const groupAttention = rows.filter(
            (requirement) =>
              requirement.complianceCheck &&
              requirement.complianceCheck.status !== "met",
          ).length;
          return (
            <ActionSurfaceButton
              key={lob}
              type="button"
              onClick={onOpenRequirements}
              className="px-4 py-3"
            >
              <p className="truncate text-base font-medium text-foreground">
                {lob} · {lobLabel(lob)}
              </p>
              <p className="mt-2 text-label text-muted-foreground">Needs attention</p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {groupAttention}
              </p>
              <div className="mt-2">
                <ComplianceMeter met={groupMet} total={rows.length} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-label text-muted-foreground">
                <span>{groupMet} met</span>
                <span>{rows.length} total</span>
              </div>
            </ActionSurfaceButton>
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
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[9%] px-4">Line</TableHead>
            <TableHead className="w-[27%]">Coverage</TableHead>
            <TableHead className="w-[20%]">Limit type</TableHead>
            <TableHead className="w-[11%]">Limit</TableHead>
            <TableHead className="w-[12%]">Status</TableHead>
            <TableHead className="w-[21%] px-4">Policy match</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((requirement) => {
            const limits = requirement.limits ?? [];
            const policy = requirement.complianceCheck?.matchedPolicy;
            return (
              <TableRow
                key={requirement._id}
                className="cursor-pointer"
                onClick={() => onSelect(requirement._id)}
              >
                <TableCell className="px-4 font-medium text-foreground">
                  {requirement.lineOfBusiness ?? "—"}
                </TableCell>
                <TableCell className="max-w-64">
                  <p className="truncate font-medium text-foreground">{requirement.title}</p>
                  {requirement.clientRequirementSource?.clientOrg ? (
                    <p className="truncate text-label text-muted-foreground">
                      From {requirement.clientRequirementSource.clientOrg.name}
                    </p>
                  ) : null}
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
                <TableCell className="tabular-nums text-foreground">
                  {limits.length > 0
                    ? limits.map((limit, index) => (
                        <p key={index} className="leading-5">{formatMoneyCompact(limit.amount)}</p>
                      ))
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
                  {policy ? (
                    <p className="truncate text-foreground">
                      {[policy.carrier, policy.policyNumber].filter(Boolean).join(" · ")}
                    </p>
                  ) : (
                    <span className="text-muted-foreground">
                      {requirement.complianceCheck ? "No match" : "—"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function DrawerDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 text-base">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  );
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
      title="Coverage requirement"
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={onClose}>
            Close
          </PillButton>
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
        <section className="space-y-2 rounded-lg border border-foreground/6 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-foreground">{requirement.title}</p>
              <p className="truncate text-base text-muted-foreground">
                {requirement.lineOfBusiness
                  ? `${requirement.lineOfBusiness} · ${lobLabel(requirement.lineOfBusiness)}`
                  : "Coverage"}
              </p>
            </div>
            {check ? <StatusBadge status={check.status} /> : null}
          </div>
          <p className="text-base text-muted-foreground">{requirement.requirementText}</p>
        </section>
        <section className="space-y-2 border-t border-foreground/6 pt-5">
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
          {requirement.clientRequirementSource?.clientOrg ? (
            <DrawerDetail
              label="Required by"
              value={requirement.clientRequirementSource.clientOrg.name}
            />
          ) : null}
        </section>
        {check ? (
          <section className="space-y-2 border-t border-foreground/6 pt-5">
            <p className="text-label text-muted-foreground">Latest check</p>
            {policy ? (
              <>
                <DrawerDetail
                  label="Matched policy"
                  value={[policy.carrier, policy.policyNumber].filter(Boolean).join(" · ")}
                />
                {policy.coverageName ? (
                  <DrawerDetail label="Coverage" value={policy.coverageName} />
                ) : null}
                {detectedLimit ? (
                  <DrawerDetail label="Current limit" value={detectedLimit} />
                ) : null}
                {policy.expirationDate ? (
                  <DrawerDetail label="Expires" value={policy.expirationDate} />
                ) : null}
              </>
            ) : (
              <p className="text-base text-muted-foreground">No current policy match.</p>
            )}
            {check.notes ? (
              <p className="rounded-md border border-foreground/8 bg-muted/40 px-3 py-2 text-base text-muted-foreground">
                {check.notes}
              </p>
            ) : null}
          </section>
        ) : null}
        {requirement.sourceExcerpt ? (
          <section className="space-y-2 border-t border-foreground/6 pt-5">
            <p className="text-label text-muted-foreground">{requirementSourceLine(requirement)}</p>
            <p className="rounded-md border border-foreground/8 bg-muted/40 px-3 py-2 text-base leading-5 text-foreground/80">
              {requirement.sourceExcerpt}
            </p>
          </section>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

function RequirementsLoadingSkeleton() {
  return <OperationalSkeletonList rows={4} />;
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
  const upsertRequirement = useMutation(complianceApi.compliance.upsertRequirement);
  const archiveRequirement = useMutation(complianceApi.compliance.archiveRequirement);
  const generateRequirementImportUploadUrl = useMutation(complianceApi.compliance.generateRequirementImportUploadUrl);
  const importRequirements = useAction(complianceApi.actions.complianceRequirements.importRequirements);
  const recheckOwnRequirement = useAction(complianceApi.actions.complianceReview.recheckOwnRequirement);

  const [view, setView] = useState<ComplianceView>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"bulk" | "manual">("bulk");
  const [requirementScope, setRequirementScope] = useState<RequirementScope>("own_org");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [selectedRequirementId, setSelectedRequirementId] = useState<Id<"insuranceRequirements"> | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceTypeValue, setSourceTypeValue] = useState<Exclude<RequirementSourceType, "manual" | "bulk_import">>("vendor_requirements");
  const [title, setTitle] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState("CGL");
  const [limitKind, setLimitKind] = useState<RequirementLimitKind>("per_occurrence");
  const [limitAmount, setLimitAmount] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [provisions, setProvisions] = useState<RequirementProvision[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
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

  const scopedRequirements = useMemo(
    () =>
      (requirements ?? []).filter((requirement) => requirement.scope === activeRequirementScope),
    [activeRequirementScope, requirements],
  );
  const sourceFilters = useMemo(() => {
    const present = Array.from(new Set(scopedRequirements.map(sourceType)));
    return ["all", ...present] as SourceFilter[];
  }, [scopedRequirements]);
  const visibleRequirements = scopedRequirements.filter(
    (requirement) => sourceFilter === "all" || sourceType(requirement) === sourceFilter,
  );
  const selectedRequirement =
    (requirements ?? []).find((requirement) => requirement._id === selectedRequirementId) ?? null;

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
    try {
      await archiveRequirement({ orgId, requirementId });
      await updateRequirements({ orgId }, (current) =>
        current.filter((requirement) => requirement._id !== requirementId),
      );
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
        scope: activeRequirementScope,
      })) as { createdCount: number };
      toast[result.createdCount === 0 ? "info" : "success"](
        result.createdCount === 0
          ? "No new coverage requirements found"
          : `Created ${result.createdCount} requirement${result.createdCount === 1 ? "" : "s"}`,
      );
      setSourceText("");
      setSourceFile(null);
      setDrawerOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate requirements");
    } finally {
      setImporting(false);
    }
  }

  function openAddRequirements() {
    setDrawerMode("bulk");
    setDrawerOpen(true);
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
              Source
              <Select value={sourceTypeValue} onValueChange={(value) => setSourceTypeValue(value as Exclude<RequirementSourceType, "manual" | "bulk_import">)}>
                <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lease_agreement">Lease agreement</SelectItem>
                  <SelectItem value="client_contract">Client requirements</SelectItem>
                  <SelectItem value="vendor_requirements">Vendor requirements</SelectItem>
                  <SelectItem value="other">Other source</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Requirement text
              <Textarea className="min-h-0 flex-1 resize-none field-sizing-fixed" rows={12} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste insurance requirements or contract language." disabled={importing} />
            </label>
            <FileDropZone accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/json" disabled={importing} idleLabel="Upload requirement document" busyLabel="Generating requirements..." hint="TXT, Markdown, PDF, DOCX, CSV, or JSON" onFile={setSourceFile} />
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
                <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_LOBS.map((code) => (
                    <SelectItem key={code} value={code}>{code} · {lobLabel(code)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
              <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                Limit
                <Select value={limitKind} onValueChange={(value) => setLimitKind(value as RequirementLimitKind)}>
                  <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
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

  return (
    <AppShell
      actions={
        <PillButton size="compact" variant="primary" onClick={openAddRequirements}>
          <Plus className="h-3.5 w-3.5" />
          Add requirements
        </PillButton>
      }
      rightPanel={detailPanel ?? addPanel}
    >
      <div className="flex w-full flex-col gap-4">
        <Tabs value={view} onValueChange={(value) => setView(value as ComplianceView)}>
          <TabsList variant="pill">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
          </TabsList>
        </Tabs>
        {requirements === undefined ||
        (showConnectFeatures && (clientRows === undefined || vendorRows === undefined)) ? (
          <RequirementsLoadingSkeleton />
        ) : view === "overview" ? (
          <OverviewTab
            requirements={requirements}
            onOpenRequirements={() => setView("requirements")}
            onAdd={openAddRequirements}
          />
        ) : (
          <>
            {showConnectFeatures && !isPureVendorAccount ? (
              <Tabs value={activeRequirementScope} onValueChange={(value) => setRequirementScope(value as RequirementScope)}>
                <TabsList variant="pill">
                  <TabsTrigger value="own_org">My requirements</TabsTrigger>
                  <TabsTrigger value="vendors">Vendor requirements</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
            {sourceFilters.length > 2 ? (
              <Tabs value={sourceFilter} onValueChange={(value) => setSourceFilter(value as SourceFilter)}>
                <TabsList variant="pill">
                  {sourceFilters.map((filter) => (
                    <TabsTrigger key={filter} value={filter}>{sourceLabel(filter)}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            {visibleRequirements.length === 0 ? (
              <EmptyState onAdd={openAddRequirements} />
            ) : (
              <RequirementsTable
                requirements={visibleRequirements}
                onSelect={setSelectedRequirementId}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
