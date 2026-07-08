"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileUp,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { FileDropZone } from "@/components/ui/file-drop";
import { Input } from "@/components/ui/input";
import {
  OperationalItem,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isFeatureEnabled } from "@/convex/lib/featureFlags";
import {
  REQUIREMENT_CONDITION_TYPE_LABELS,
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
type RequirementKind = "coverage" | "insurer" | "condition";
type ComplianceStatus = "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
type SourceFilter = "all" | RequirementSourceType;

type ComplianceApi = {
  compliance: {
    listRequirements: FunctionReference<"query">;
    upsertRequirement: FunctionReference<"mutation">;
    archiveRequirement: FunctionReference<"mutation">;
    verifyRequirement: FunctionReference<"mutation">;
    generateRequirementImportUploadUrl: FunctionReference<"mutation">;
    generateEvidenceUploadUrl: FunctionReference<"mutation">;
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
  kind: RequirementKind;
  scope: RequirementScope;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  provisions?: string[];
  requiredForms?: string[];
  minAmBestRating?: string;
  minAmBestFinancialSize?: string;
  admittedRequired?: boolean;
  conditionType?: keyof typeof REQUIREMENT_CONDITION_TYPE_LABELS;
  noticeDays?: number;
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
    evidence?: {
      note?: string;
      fileId?: Id<"_storage">;
      fileName?: string;
      validUntil?: string;
    };
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

function parseMoneyInput(value: string) {
  const normalized = value.replace(/[$,\s]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
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
        icon: AlertCircle,
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

function limitSummary(requirement: Requirement) {
  if (!requirement.limits?.length) return undefined;
  return requirement.limits
    .map((limit) => {
      const label =
        REQUIREMENT_LIMIT_KIND_LABELS[
          limit.kind as keyof typeof REQUIREMENT_LIMIT_KIND_LABELS
        ] ?? limit.kind;
      return `${label}: ${limit.label ?? formatMoney(limit.amount) ?? limit.amount}`;
    })
    .join(" · ");
}

function provisionSummary(requirement: Requirement) {
  return (requirement.provisions ?? [])
    .map(
      (provision) =>
        REQUIREMENT_PROVISION_LABELS[
          provision as keyof typeof REQUIREMENT_PROVISION_LABELS
        ] ?? provision,
    )
    .join(" · ");
}

function summaryCounts(requirements: Requirement[]) {
  const checked = requirements.filter((requirement) => requirement.complianceCheck);
  const met = checked.filter((requirement) => requirement.complianceCheck?.status === "met").length;
  const expiring = checked.filter((requirement) => requirement.complianceCheck?.status === "expiring_soon").length;
  const unverified = checked.filter((requirement) => requirement.complianceCheck?.status === "unverified").length;
  const open = checked.filter((requirement) => {
    const status = requirement.complianceCheck?.status;
    return status === "not_met" || status === "expired";
  }).length;
  return { checked: checked.length, met, expiring, unverified, open };
}

function SummaryHeader({ requirements }: { requirements: Requirement[] }) {
  const counts = summaryCounts(requirements);
  const pieces = [
    `${counts.met} of ${counts.checked || requirements.length} met`,
    counts.expiring ? `${counts.expiring} expiring` : undefined,
    counts.open ? `${counts.open} not met` : undefined,
    counts.unverified ? `${counts.unverified} unverified` : undefined,
  ].filter(Boolean);
  return (
    <OperationalPanel as="div" className="px-4 py-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base font-medium text-foreground">Compliance requirements</p>
        <p className="text-base text-muted-foreground">{pieces.join(" · ")}</p>
      </div>
    </OperationalPanel>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <OperationalPanel as="div" className="p-5">
      <p className="text-base font-medium text-foreground">No requirements here</p>
      <p className="mt-1 text-base text-muted-foreground">
        Add rules manually or extract them from a lease, client contract, or vendor requirement packet.
      </p>
      <PillButton className="mt-4" onClick={onAdd}>
        <FileUp className="h-3.5 w-3.5" />
        Import requirements
      </PillButton>
    </OperationalPanel>
  );
}

function RequirementDetail({
  requirement,
  onArchive,
  onVerify,
  onDeepCheck,
  checking,
}: {
  requirement: Requirement;
  onArchive: (requirementId: Id<"insuranceRequirements">) => void;
  onVerify: (requirement: Requirement) => void;
  onDeepCheck: (requirement: Requirement) => void;
  checking: boolean;
}) {
  const canVerify = requirement.canArchive !== false && requirement.kind !== "coverage";
  const canDeepCheck =
    requirement.canArchive !== false &&
    requirement.kind === "coverage" &&
    requirement.scope === "own_org" &&
    requirement.complianceCheck &&
    requirement.complianceCheck.status !== "met";
  return (
    <div className="border-t border-foreground/6 bg-muted/25 px-4 py-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]">
        <div className="space-y-2">
          <p className="text-base leading-5 text-foreground">{requirement.requirementText}</p>
          {requirement.sourceExcerpt ? (
            <div className="rounded-md border border-foreground/8 bg-background px-3 py-2">
              <p className="text-label font-medium text-muted-foreground">{requirementSourceLine(requirement)}</p>
              <p className="mt-1 text-label leading-4 text-foreground/80">{requirement.sourceExcerpt}</p>
            </div>
          ) : null}
        </div>
        <div className="space-y-2 text-label text-muted-foreground">
          {requirement.complianceCheck?.notes ? (
            <p className="rounded-md border border-foreground/8 bg-background px-3 py-2">
              {requirement.complianceCheck.notes}
            </p>
          ) : null}
          {requirement.complianceCheck?.evidence ? (
            <p className="rounded-md border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-emerald-600">
              Verified{requirement.complianceCheck.evidence.validUntil ? ` until ${requirement.complianceCheck.evidence.validUntil}` : ""}
              {requirement.complianceCheck.evidence.note ? ` · ${requirement.complianceCheck.evidence.note}` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canVerify ? (
              <PillButton size="compact" onClick={() => onVerify(requirement)}>
                <ShieldCheck className="h-3.5 w-3.5" />
                Verify
              </PillButton>
            ) : null}
            {canDeepCheck ? (
              <PillButton size="compact" variant="secondary" disabled={checking} onClick={() => onDeepCheck(requirement)}>
                {checking ? "Checking…" : "Run deeper check"}
              </PillButton>
            ) : null}
            {requirement.canArchive !== false ? (
              <PillButton size="compact" variant="secondary" onClick={() => onArchive(requirement._id)}>
                <Trash2 className="h-3.5 w-3.5" />
                Archive
              </PillButton>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoverageRow({
  requirement,
  expanded,
  onToggle,
  onArchive,
  onVerify,
  onDeepCheck,
  checking,
}: {
  requirement: Requirement;
  expanded: boolean;
  onToggle: () => void;
  onArchive: (requirementId: Id<"insuranceRequirements">) => void;
  onVerify: (requirement: Requirement) => void;
  onDeepCheck: (requirement: Requirement) => void;
  checking: boolean;
}) {
  const policy = requirement.complianceCheck?.matchedPolicy;
  const detected = policy?.coverageLimit ?? formatMoney(policy?.detectedLimitAmount);
  return (
    <div className="border-b border-foreground/6 last:border-b-0">
      <OperationalItem className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="grid w-full gap-3 px-4 py-3 text-left md:grid-cols-[minmax(0,1fr)_minmax(260px,420px)]"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              <p className="truncate text-base font-medium text-foreground">{requirement.title}</p>
              <StatusBadge status={requirement.complianceCheck?.status} />
            </div>
            <p className="truncate text-label text-muted-foreground">{limitSummary(requirement) ?? provisionSummary(requirement) ?? "Coverage rule"}</p>
          </div>
          <div className="min-w-0 text-label text-muted-foreground">
            {policy ? (
              <>
                <p className="truncate text-foreground">{[policy.carrier, policy.policyNumber].filter(Boolean).join(" · ")}</p>
                <p className="truncate">
                  {[policy.coverageName, detected ? `Current ${detected}` : undefined, policy.expirationDate ? `Expires ${policy.expirationDate}` : undefined].filter(Boolean).join(" · ")}
                </p>
              </>
            ) : (
              <p>No current policy match</p>
            )}
          </div>
        </button>
      </OperationalItem>
      {expanded ? (
        <RequirementDetail
          requirement={requirement}
          onArchive={onArchive}
          onVerify={onVerify}
          onDeepCheck={onDeepCheck}
          checking={checking}
        />
      ) : null}
    </div>
  );
}

function SimpleRequirementRow({
  requirement,
  expanded,
  onToggle,
  onArchive,
  onVerify,
  onDeepCheck,
  checking,
}: {
  requirement: Requirement;
  expanded: boolean;
  onToggle: () => void;
  onArchive: (requirementId: Id<"insuranceRequirements">) => void;
  onVerify: (requirement: Requirement) => void;
  onDeepCheck: (requirement: Requirement) => void;
  checking: boolean;
}) {
  const secondary =
    requirement.kind === "insurer"
      ? [
          requirement.minAmBestRating ? `AM Best ${requirement.minAmBestRating}+` : undefined,
          requirement.minAmBestFinancialSize ? `Size ${requirement.minAmBestFinancialSize}+` : undefined,
          requirement.admittedRequired ? "Admitted carrier" : undefined,
        ]
          .filter(Boolean)
          .join(" · ") || "Carrier standard"
      : [
          requirement.conditionType ? REQUIREMENT_CONDITION_TYPE_LABELS[requirement.conditionType] : "Condition",
          requirement.noticeDays !== undefined ? `${requirement.noticeDays} days` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <div className="border-b border-foreground/6 last:border-b-0">
      <OperationalItem className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              <p className="truncate text-base font-medium text-foreground">{requirement.title}</p>
              <StatusBadge status={requirement.complianceCheck?.status} />
            </div>
            <p className="mt-1 truncate text-label text-muted-foreground">{secondary}</p>
          </div>
        </button>
      </OperationalItem>
      {expanded ? (
        <RequirementDetail
          requirement={requirement}
          onArchive={onArchive}
          onVerify={onVerify}
          onDeepCheck={onDeepCheck}
          checking={checking}
        />
      ) : null}
    </div>
  );
}

function RequirementSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <OperationalPanel as="section">
      <div className="border-b border-foreground/6 px-4 py-3">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
      </div>
      {children}
    </OperationalPanel>
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
  const verifyRequirement = useMutation(complianceApi.compliance.verifyRequirement);
  const generateRequirementImportUploadUrl = useMutation(complianceApi.compliance.generateRequirementImportUploadUrl);
  const generateEvidenceUploadUrl = useMutation(complianceApi.compliance.generateEvidenceUploadUrl);
  const importRequirements = useAction(complianceApi.actions.complianceRequirements.importRequirements);
  const recheckOwnRequirement = useAction(complianceApi.actions.complianceReview.recheckOwnRequirement);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"bulk" | "manual">("bulk");
  const [requirementScope, setRequirementScope] = useState<RequirementScope>("own_org");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [expandedRequirementId, setExpandedRequirementId] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceTypeValue, setSourceTypeValue] = useState<Exclude<RequirementSourceType, "manual" | "bulk_import">>("vendor_requirements");
  const [kind, setKind] = useState<RequirementKind>("coverage");
  const [title, setTitle] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState("CGL");
  const [limitKind, setLimitKind] = useState<RequirementLimitKind>("per_occurrence");
  const [limitAmount, setLimitAmount] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [provisions, setProvisions] = useState<RequirementProvision[]>([]);
  const [minAmBestRating, setMinAmBestRating] = useState("");
  const [admittedRequired, setAdmittedRequired] = useState(false);
  const [conditionType, setConditionType] = useState<keyof typeof REQUIREMENT_CONDITION_TYPE_LABELS>("cancellation_notice");
  const [noticeDays, setNoticeDays] = useState("");
  const [verifyTarget, setVerifyTarget] = useState<Requirement | null>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyValidUntil, setVerifyValidUntil] = useState("");
  const [verifyFile, setVerifyFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [verifying, setVerifying] = useState(false);
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
  const coverageGroups = new Map<string, Requirement[]>();
  for (const requirement of visibleRequirements.filter((item) => item.kind === "coverage")) {
    const key = requirement.lineOfBusiness ?? "UN";
    coverageGroups.set(key, [...(coverageGroups.get(key) ?? []), requirement]);
  }
  const insurerRequirements = visibleRequirements.filter((item) => item.kind === "insurer");
  const conditionRequirements = visibleRequirements.filter((item) => item.kind === "condition");

  if (isBroker) return null;

  async function submitRequirement(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    const amount = parseMoneyInput(limitAmount);
    setSubmitting(true);
    try {
      await upsertRequirement({
        orgId,
        kind,
        scope: activeRequirementScope,
        title,
        requirementText,
        lineOfBusiness: kind === "coverage" ? lineOfBusiness : undefined,
        limits:
          kind === "coverage" && amount !== undefined
            ? [{ kind: limitKind, amount, label: limitAmount.trim() }]
            : undefined,
        provisions: kind === "coverage" ? provisions : undefined,
        minAmBestRating: kind === "insurer" ? minAmBestRating.trim() || undefined : undefined,
        admittedRequired: kind === "insurer" ? admittedRequired : undefined,
        conditionType: kind === "condition" ? conditionType : undefined,
        noticeDays: kind === "condition" ? Number(noticeDays) || undefined : undefined,
        sourceType: "manual",
      });
      toast.success("Requirement saved");
      setTitle("");
      setRequirementText("");
      setLimitAmount("");
      setProvisions([]);
      setMinAmBestRating("");
      setAdmittedRequired(false);
      setNoticeDays("");
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
          ? "No new requirements found"
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

  async function submitVerification() {
    if (!orgId || !verifyTarget) return;
    setVerifying(true);
    try {
      let fileId: Id<"_storage"> | undefined;
      if (verifyFile) {
        const uploadUrl = await generateEvidenceUploadUrl({ orgId });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": verifyFile.type || "application/octet-stream" },
          body: verifyFile,
        });
        if (!response.ok) throw new Error("Evidence upload failed");
        const payload = (await response.json()) as { storageId: string };
        fileId = payload.storageId as Id<"_storage">;
      }
      await verifyRequirement({
        orgId,
        requirementId: verifyTarget._id,
        status: "met",
        evidence: {
          note: verifyNote.trim() || undefined,
          validUntil: verifyValidUntil || undefined,
          fileId,
          fileName: verifyFile?.name,
        },
      });
      toast.success("Requirement verified");
      setVerifyTarget(null);
      setVerifyNote("");
      setVerifyValidUntil("");
      setVerifyFile(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify requirement");
    } finally {
      setVerifying(false);
    }
  }

  function openAddRequirements() {
    setDrawerMode("bulk");
    setDrawerOpen(true);
  }

  const rightPanel = (
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
              Kind
              <Select value={kind} onValueChange={(value) => setKind(value as RequirementKind)}>
                <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coverage">Coverage</SelectItem>
                  <SelectItem value="insurer">Insurer standard</SelectItem>
                  <SelectItem value="condition">Condition</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Title
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="General liability minimum" required />
            </label>
            {kind === "coverage" ? (
              <>
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
                    <Input value={limitAmount} onChange={(event) => setLimitAmount(event.target.value)} placeholder="$1M" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PROVISION_OPTIONS.map((option) => (
                    <PillButton key={option} type="button" size="compact" variant={provisions.includes(option) ? "primary" : "secondary"} onClick={() => setProvisions((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])}>
                      {REQUIREMENT_PROVISION_LABELS[option]}
                    </PillButton>
                  ))}
                </div>
              </>
            ) : null}
            {kind === "insurer" ? (
              <>
                <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                  Minimum AM Best rating
                  <Input value={minAmBestRating} onChange={(event) => setMinAmBestRating(event.target.value)} placeholder="A-" />
                </label>
                <label className="flex items-center gap-2 text-label font-medium text-muted-foreground">
                  <input type="checkbox" checked={admittedRequired} onChange={(event) => setAdmittedRequired(event.target.checked)} />
                  Admitted carrier required
                </label>
              </>
            ) : null}
            {kind === "condition" ? (
              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                  Type
                  <Select value={conditionType} onValueChange={(value) => setConditionType(value as keyof typeof REQUIREMENT_CONDITION_TYPE_LABELS)}>
                    <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(REQUIREMENT_CONDITION_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
                  Days
                  <Input value={noticeDays} onChange={(event) => setNoticeDays(event.target.value)} placeholder="30" />
                </label>
              </div>
            ) : null}
            <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Requirement
              <Textarea className="min-h-0 flex-1 resize-none field-sizing-fixed" rows={8} value={requirementText} onChange={(event) => setRequirementText(event.target.value)} placeholder="Describe the requirement in plain language." required />
            </label>
          </form>
        )}
      </div>
    </SettingsDrawer>
  );

  const verifyPanel = (
    <SettingsDrawer
      open={verifyTarget !== null}
      onOpenChange={(open) => {
        if (!open) setVerifyTarget(null);
      }}
      title="Verify requirement"
      footer={
        <>
          <PillButton variant="secondary" disabled={verifying} onClick={() => setVerifyTarget(null)}>Cancel</PillButton>
          <PillButton disabled={verifying} onClick={() => void submitVerification()}>{verifying ? "Verifying..." : "Verify"}</PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
          Note
          <Textarea value={verifyNote} onChange={(event) => setVerifyNote(event.target.value)} rows={4} placeholder="How this was verified." />
        </label>
        <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
          Valid until
          <Input type="date" value={verifyValidUntil} onChange={(event) => setVerifyValidUntil(event.target.value)} />
        </label>
        <FileDropZone disabled={verifying} idleLabel="Attach evidence" busyLabel="Uploading evidence..." hint="Optional supporting file" onFile={setVerifyFile} />
        {verifyFile ? <p className="truncate text-base text-foreground">{verifyFile.name}</p> : null}
      </div>
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={
        <PillButton size="compact" variant="primary" onClick={openAddRequirements}>
          <Plus className="h-3.5 w-3.5" />
          Add requirements
        </PillButton>
      }
      rightPanel={verifyTarget ? verifyPanel : rightPanel}
    >
      <div className="flex w-full flex-col gap-4">
        {showConnectFeatures && !isPureVendorAccount ? (
          <Tabs value={requirementScope} onValueChange={(value) => setRequirementScope(value as RequirementScope)}>
            <TabsList variant="pill">
              <TabsTrigger value="own_org">My requirements</TabsTrigger>
              <TabsTrigger value="vendors">Vendor requirements</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {requirements === undefined ||
        (showConnectFeatures && (clientRows === undefined || vendorRows === undefined)) ? (
          <RequirementsLoadingSkeleton />
        ) : (
          <>
            <SummaryHeader requirements={visibleRequirements} />
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
              <>
                {Array.from(coverageGroups.entries()).map(([lob, rows]) => (
                  <RequirementSection key={lob} title={`${lob} · ${lobLabel(lob)}`}>
                    {rows.map((requirement) => (
                      <CoverageRow
                        key={requirement._id}
                        requirement={requirement}
                        expanded={expandedRequirementId === requirement._id}
                        onToggle={() => setExpandedRequirementId((current) => current === requirement._id ? null : requirement._id)}
                        onArchive={(id) => void removeRequirement(id)}
                        onVerify={setVerifyTarget}
                        onDeepCheck={(row) => void runDeeperCheck(row)}
                        checking={checkingRequirementId === requirement._id}
                      />
                    ))}
                  </RequirementSection>
                ))}
                {insurerRequirements.length > 0 ? (
                  <RequirementSection title="Insurer standards">
                    {insurerRequirements.map((requirement) => (
                      <SimpleRequirementRow
                        key={requirement._id}
                        requirement={requirement}
                        expanded={expandedRequirementId === requirement._id}
                        onToggle={() => setExpandedRequirementId((current) => current === requirement._id ? null : requirement._id)}
                        onArchive={(id) => void removeRequirement(id)}
                        onVerify={setVerifyTarget}
                        onDeepCheck={(row) => void runDeeperCheck(row)}
                        checking={checkingRequirementId === requirement._id}
                      />
                    ))}
                  </RequirementSection>
                ) : null}
                {conditionRequirements.length > 0 ? (
                  <RequirementSection title="Conditions">
                    {conditionRequirements.map((requirement) => (
                      <SimpleRequirementRow
                        key={requirement._id}
                        requirement={requirement}
                        expanded={expandedRequirementId === requirement._id}
                        onToggle={() => setExpandedRequirementId((current) => current === requirement._id ? null : requirement._id)}
                        onArchive={(id) => void removeRequirement(id)}
                        onVerify={setVerifyTarget}
                        onDeepCheck={(row) => void runDeeperCheck(row)}
                        checking={checkingRequirementId === requirement._id}
                      />
                    ))}
                  </RequirementSection>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
