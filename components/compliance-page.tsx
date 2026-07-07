"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { AppShell } from "@/components/app-shell";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { useActiveOrgContext } from "@/lib/hooks/use-active-org-context";
import { useCachedConnectedVendors } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery, useUpdateCachedQuery } from "@/lib/sync/use-cached-query";
import { isFeatureEnabled } from "@/convex/lib/featureFlags";
import {
  requirementEvaluationTargetLabel,
  requirementSemantics,
  type RequirementEvaluationTarget,
  type RequirementSemanticReviewStatus,
} from "@/convex/lib/requirementSemantics";

type Category =
  | "general_liability"
  | "auto"
  | "workers_comp"
  | "umbrella"
  | "professional"
  | "cyber"
  | "property"
  | "other";

type RequirementScope = "vendors" | "own_org";
type RequirementSourceType =
  | "manual"
  | "bulk_import"
  | "lease_agreement"
  | "client_contract"
  | "vendor_requirements"
  | "other";

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
    listVendors: FunctionReference<"query">;
    listClients: FunctionReference<"query">;
  };
};

const complianceApi = api as unknown as ComplianceApi;

const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: "general_liability", label: "General liability" },
  { value: "auto", label: "Commercial auto" },
  { value: "workers_comp", label: "Workers comp" },
  { value: "umbrella", label: "Umbrella / excess" },
  { value: "professional", label: "Professional liability" },
  { value: "cyber", label: "Cyber" },
  { value: "property", label: "Property" },
  { value: "other", label: "Other" },
];

type Requirement = {
  _id: Id<"insuranceRequirements">;
  title: string;
  category: Category;
  requirementText: string;
  limit?: string;
  limitAmount?: number;
  deductible?: string;
  deductibleAmount?: number;
  appliesTo: "vendors" | "own_org" | "both";
  sourceType?: RequirementSourceType;
  sourceDocumentName?: string;
  sourceExcerpt?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  evaluationTarget?: RequirementEvaluationTarget;
  evaluationReason?: string;
  semanticReviewStatus?: RequirementSemanticReviewStatus;
  updatedAt: number;
  complianceCheck?: {
    status: "met" | "missing" | "expiring_soon" | "expired" | "needs_review";
    matchedPolicyIds?: Id<"policies">[];
    expiresAt?: string;
    daysUntilExpiration?: number;
    notes?: string;
    checkedAt?: number;
    checkedBy?: "system" | "user" | "agent";
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

function sourceTypeLabel(sourceType?: RequirementSourceType) {
  switch (sourceType) {
    case "lease_agreement":
      return "Lease agreement";
    case "client_contract":
      return "Client contract";
    case "vendor_requirements":
      return "Requirements document";
    case "bulk_import":
      return "Bulk import";
    case "manual":
      return "Manual";
    case "other":
      return "Source document";
    default:
      return undefined;
  }
}

function formatSourcePage(requirement: Requirement) {
  if (!requirement.sourcePageStart) return undefined;
  if (
    requirement.sourcePageEnd &&
    requirement.sourcePageEnd !== requirement.sourcePageStart
  ) {
    return `pp. ${requirement.sourcePageStart}-${requirement.sourcePageEnd}`;
  }
  return `p. ${requirement.sourcePageStart}`;
}

function categoryLabel(category: Category) {
  return (
    CATEGORIES.find((option) => option.value === category)?.label ?? category
  );
}

function CategoryBadge({ category }: { category: Category }) {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {categoryLabel(category)}
    </Badge>
  );
}

function EvaluationTargetBadge({ requirement }: { requirement: Requirement }) {
  const target = requirementSemantics(requirement).evaluationTarget;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {requirementEvaluationTargetLabel(target)}
    </Badge>
  );
}

function RequirementBadge({ label, value }: { label: string; value: string }) {
  return (
    <Badge
      variant="outline"
      className="max-w-full gap-1.5 text-label font-normal text-muted-foreground"
    >
      <span>{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </Badge>
  );
}

function ComplianceStatusBadge({
  status,
}: {
  status: NonNullable<Requirement["complianceCheck"]>["status"];
}) {
  if (status === "met") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
      >
        <CheckCircle2 className="h-3 w-3" />
        Met
      </Badge>
    );
  }
  if (status === "expiring_soon") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/25 bg-amber-500/10 text-amber-500"
      >
        <AlertCircle className="h-3 w-3" />
        Needs attention
      </Badge>
    );
  }
  if (status === "needs_review") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/25 bg-amber-500/10 text-amber-500"
      >
        <AlertCircle className="h-3 w-3" />
        Needs review
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-red-500/25 bg-red-500/10 text-red-500"
    >
      <AlertCircle className="h-3 w-3" />
      Not met
    </Badge>
  );
}

function RequirementsLoadingSkeleton() {
  return <OperationalSkeletonList rows={3} />;
}

function ComplianceEmptyState({
  scope,
  onBulkAdd,
}: {
  scope: RequirementScope;
  onBulkAdd: () => void;
}) {
  const isVendorScope = scope === "vendors";
  return (
    <OperationalPanel as="div" className="p-5 sm:p-6">
      <h3 className="text-base font-medium text-foreground">
        No requirements yet
      </h3>
      <p className="text-base text-muted-foreground mt-1">
        {isVendorScope
          ? "Add the insurance standards vendors need to satisfy before they work with your organization."
          : "Add the insurance standards your organization needs to satisfy."}
      </p>

      <button
        type="button"
        onClick={onBulkAdd}
        className="mt-5 w-full rounded-lg border-2 border-dashed border-foreground/10 px-6 py-12 text-center transition-colors hover:border-foreground/20 hover:bg-foreground/2"
      >
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-foreground/4 text-muted-foreground">
          <ClipboardCheck className="h-4.5 w-4.5" />
        </div>
        <p className="text-base font-medium text-foreground">
          {isVendorScope
            ? "Add a vendor requirement"
            : "Add one of my requirements"}
        </p>
        <p className="mt-1 text-base text-muted-foreground">
          {isVendorScope
            ? "Paste contract language or upload an existing vendor requirements document."
            : "Paste compliance notes or upload an existing requirements document."}
        </p>
        <span className="mt-4 inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-foreground px-3.5 text-label font-medium text-background">
          <FileUp className="h-3.5 w-3.5" />
          Bulk import
        </span>
      </button>
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
  const vendorRowsResult = useCachedConnectedVendors(
    orgId && showConnectFeatures ? orgId : undefined,
  ) as
    | ConnectedOrgRow[]
    | undefined;
  const clientRowsResult = useCachedQuery(
    "connectedOrgs.listClients",
    complianceApi.connectedOrgs.listClients,
    orgId && showConnectFeatures ? { orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const vendorRows = showConnectFeatures ? vendorRowsResult : [];
  const clientRows = showConnectFeatures ? clientRowsResult : [];
  const updateRequirements = useUpdateCachedQuery<
    Requirement[],
    { orgId: Id<"organizations"> }
  >("compliance.listRequirements");
  const upsertRequirement = useMutation(
    complianceApi.compliance.upsertRequirement,
  );
  const archiveRequirement = useMutation(
    complianceApi.compliance.archiveRequirement,
  );
  const generateRequirementImportUploadUrl = useMutation(
    complianceApi.compliance.generateRequirementImportUploadUrl,
  );
  const importRequirements = useAction(
    complianceApi.actions.complianceRequirements.importRequirements,
  );
  const recheckOwnRequirement = useAction(
    complianceApi.actions.complianceReview.recheckOwnRequirement,
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"bulk" | "manual">("bulk");
  const [requirementScope, setRequirementScope] =
    useState<RequirementScope>("own_org");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceType, setSourceType] =
    useState<Exclude<RequirementSourceType, "manual" | "bulk_import">>(
      "vendor_requirements",
    );
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("general_liability");
  const [limit, setLimit] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [recheckingRequirementId, setRecheckingRequirementId] =
    useState<Id<"insuranceRequirements"> | null>(null);

  if (isBroker) return null;

  const hasActiveClients = (clientRows ?? []).some(
    (row) => row.status === "active",
  );
  const hasActiveVendors = (vendorRows ?? []).some(
    (row) => row.status === "active",
  );
  const isPureVendorAccount =
    showConnectFeatures &&
    clientRows !== undefined &&
    vendorRows !== undefined &&
    hasActiveClients &&
    !hasActiveVendors;

  const activeRequirementScope: RequirementScope =
    !showConnectFeatures || isPureVendorAccount ? "own_org" : requirementScope;

  async function submitRequirement(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      await upsertRequirement({
        orgId,
        title,
        category,
        limit: limit.trim() || undefined,
        requirementText,
        appliesTo: activeRequirementScope,
        minimumRequired: true,
      });
      toast.success("Compliance requirement saved");
      setTitle("");
      setLimit("");
      setRequirementText("");
      setCategory("general_liability");
      setDrawerOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save requirement",
      );
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
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to archive requirement",
      );
    }
  }

  async function recheckRequirement(requirement: Requirement) {
    if (!orgId) return;
    setRecheckingRequirementId(requirement._id);
    try {
      const result = await recheckOwnRequirement({
        orgId,
        requirementId: requirement._id,
      });
      await updateRequirements({ orgId }, (current) =>
        current.map((item) =>
          item._id === requirement._id
            ? {
                ...item,
                complianceCheck: {
                  status: result.status,
                  matchedPolicyIds: result.matchedPolicyIds,
                  expiresAt: result.expiresAt,
                  daysUntilExpiration: result.daysUntilExpiration,
                  notes: `LLM compliance check: ${result.notes}`,
                  checkedBy: "agent",
                },
              }
            : item,
        ),
      );
      toast.success("Compliance checked");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to check compliance",
      );
    } finally {
      setRecheckingRequirementId(null);
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
          headers: {
            "Content-Type": sourceFile.type || "application/octet-stream",
          },
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
        sourceType,
        appliesTo: activeRequirementScope,
      })) as { createdCount: number };

      if (result.createdCount === 0) {
        toast.info("No new requirements found");
      } else {
        toast.success(
          `Created ${result.createdCount} requirement${result.createdCount === 1 ? "" : "s"}`,
        );
      }
      setSourceText("");
      setSourceFile(null);
      setSourceType("vendor_requirements");
      setDrawerOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to generate requirements",
      );
    } finally {
      setImporting(false);
    }
  }

  function openAddRequirements() {
    setDrawerMode("bulk");
    setDrawerOpen(true);
  }

  const visibleRequirements = (requirements ?? []).filter((requirement) =>
    requirement.appliesTo === "both"
      ? true
      : requirement.appliesTo === activeRequirementScope,
  );
  const scopeLabel = activeRequirementScope === "vendors" ? "Vendor" : "My";

  const rightPanel = (
    <SettingsDrawer
      open={drawerOpen}
      onOpenChange={setDrawerOpen}
      title={`Add ${scopeLabel.toLowerCase()} requirements`}
      footer={
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={submitting || importing}
            onClick={() => setDrawerOpen(false)}
          >
            Cancel
          </PillButton>
          {drawerMode === "manual" ? (
            <PillButton
              type="submit"
              form="manual-compliance-requirement"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Save requirement"}
            </PillButton>
          ) : (
            <PillButton
              type="button"
              disabled={importing || (!sourceText.trim() && !sourceFile)}
              onClick={() => void generateRequirements()}
            >
              {importing ? "Generating…" : "Generate requirements"}
            </PillButton>
          )}
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Tabs
          value={drawerMode}
          onValueChange={(value) => setDrawerMode(value as "bulk" | "manual")}
        >
          <TabsList variant="pill">
            <TabsTrigger value="bulk">Extract from document</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
          </TabsList>
        </Tabs>
        {drawerMode === "bulk" ? (
          <>
          <p className="text-base text-muted-foreground">
            {activeRequirementScope === "vendors"
              ? "Paste contract insurance language or upload a vendor requirements document. Glass will turn it into structured checklist items with source provenance."
              : "Upload a lease agreement, client contract, or other source document. Glass will extract the insurance requirements you need to satisfy and keep the original source language attached."}
          </p>
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Source type
            <Select
              value={sourceType}
              onValueChange={(value) =>
                setSourceType(
                  value as Exclude<
                    RequirementSourceType,
                    "manual" | "bulk_import"
                  >,
                )
              }
              disabled={importing}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendor_requirements">
                  Requirements document
                </SelectItem>
                <SelectItem value="lease_agreement">Lease agreement</SelectItem>
                <SelectItem value="client_contract">Client contract</SelectItem>
                <SelectItem value="other">Other source document</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Requirement text
            <Textarea
              className="min-h-0 flex-1 resize-none field-sizing-fixed"
              rows={12}
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Paste insurance requirements, contract language, certificate instructions, or vendor compliance notes."
              disabled={importing}
            />
          </label>
          <FileDropZone
            accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/json"
            disabled={importing}
            idleLabel="Upload requirement document"
            busyLabel="Generating requirements…"
            hint="TXT, Markdown, PDF, DOCX, CSV, or JSON"
            onFile={setSourceFile}
          />
          {sourceFile ? (
            <OperationalPanel as="div" className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-foreground">
                  {sourceFile.name}
                </p>
                <p className="text-label text-muted-foreground">
                  {(sourceFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                disabled={importing}
                onClick={() => setSourceFile(null)}
              >
                Remove
              </PillButton>
            </OperationalPanel>
          ) : null}
          </>
        ) : (
          <form
            id="manual-compliance-requirement"
            onSubmit={submitRequirement}
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Requirement title
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="General liability minimum"
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Category
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as Category)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Minimum limit
            <Input
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="$1M per occurrence"
            />
          </label>
          <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Requirement
            <Textarea
              className="min-h-0 flex-1 resize-none field-sizing-fixed"
              rows={12}
              value={requirementText}
              onChange={(event) => setRequirementText(event.target.value)}
              placeholder={
                "Contractors must carry active CGL with at least $1M per occurrence and $2M aggregate.\n\nCoverage must include additional insured status where required by contract."
              }
              required
            />
          </label>
          </form>
        )}
      </div>
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={
        <>
          <PillButton
            size="compact"
            variant="primary"
            onClick={openAddRequirements}
          >
            <Plus className="h-3.5 w-3.5" />
            Add requirements
          </PillButton>
        </>
      }
      rightPanel={rightPanel}
    >
      <div className="flex w-full flex-col gap-4">
        {showConnectFeatures && !isPureVendorAccount ? (
          <Tabs
            value={requirementScope}
            onValueChange={(value) =>
              setRequirementScope(value as RequirementScope)
            }
          >
            <TabsList variant="pill">
              <TabsTrigger value="own_org">My requirements</TabsTrigger>
              <TabsTrigger value="vendors">Vendor requirements</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {requirements === undefined ||
        (showConnectFeatures &&
          (clientRows === undefined || vendorRows === undefined)) ? (
          <RequirementsLoadingSkeleton />
        ) : visibleRequirements.length === 0 ? (
          <ComplianceEmptyState
            scope={activeRequirementScope}
            onBulkAdd={openAddRequirements}
          />
        ) : (
          <OperationalPanel>
            {visibleRequirements.map((requirement) => {
              const semantics = requirementSemantics(requirement);
              const canCheckCurrentPolicies =
                activeRequirementScope === "own_org" &&
                semantics.evaluationTarget === "own_policy" &&
                requirement.complianceCheck;
              return (
                <OperationalItem
                  key={requirement._id}
                  className="flex items-center justify-between gap-4 border-foreground/4 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate text-base font-medium text-foreground">
                        {requirement.title}
                      </p>
                      {activeRequirementScope === "own_org" &&
                      requirement.complianceCheck ? (
                        <ComplianceStatusBadge
                          status={requirement.complianceCheck.status}
                        />
                      ) : null}
                      <CategoryBadge category={requirement.category} />
                      <EvaluationTargetBadge requirement={requirement} />
                      {requirement.limit ? (
                        <RequirementBadge
                          label="Limit"
                          value={requirement.limit}
                        />
                      ) : null}
                      {requirement.deductible ? (
                        <RequirementBadge
                          label="Deductible"
                          value={requirement.deductible}
                        />
                      ) : null}
                      {requirement.clientRequirementSource ? (
                        <Badge
                          variant="secondary"
                          className="max-w-full text-label font-normal text-muted-foreground"
                        >
                          <span className="min-w-0 truncate">
                            Client requirements from{" "}
                            {requirement.clientRequirementSource.clientOrg
                              ?.name ?? "client"}
                          </span>
                        </Badge>
                      ) : null}
                      {sourceTypeLabel(requirement.sourceType) ? (
                        <Badge
                          variant="secondary"
                          className="max-w-full text-label font-normal text-muted-foreground"
                        >
                          <span className="min-w-0 truncate">
                            {sourceTypeLabel(requirement.sourceType)}
                            {requirement.sourceDocumentName
                              ? ` · ${requirement.sourceDocumentName}`
                              : ""}
                            {formatSourcePage(requirement)
                              ? ` · ${formatSourcePage(requirement)}`
                              : ""}
                          </span>
                        </Badge>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 max-w-5xl text-base leading-5 text-muted-foreground">
                      {requirement.requirementText}
                    </p>
                    {activeRequirementScope === "own_org" &&
                    requirement.complianceCheck?.notes ? (
                      <p className="line-clamp-1 max-w-5xl text-label text-muted-foreground/70">
                        {requirement.complianceCheck.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canCheckCurrentPolicies ? (
                      <PillButton
                        size="compact"
                        variant="primary"
                        disabled={recheckingRequirementId === requirement._id}
                        onClick={() => void recheckRequirement(requirement)}
                      >
                        <RefreshCcw
                          className={`h-3.5 w-3.5 ${
                            recheckingRequirementId === requirement._id
                              ? "animate-spin"
                              : ""
                          }`}
                        />
                        {recheckingRequirementId === requirement._id
                          ? "Checking"
                          : "Check compliance"}
                      </PillButton>
                    ) : null}
                    {requirement.canArchive !== false ? (
                      <PillButton
                        size="compact"
                        variant="secondary"
                        onClick={() => removeRequirement(requirement._id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Archive
                      </PillButton>
                    ) : null}
                  </div>
                </OperationalItem>
              );
            })}
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
