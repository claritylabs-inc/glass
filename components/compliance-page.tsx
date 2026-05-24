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
  PencilLine,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { FileDropZone } from "@/components/ui/file-drop";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";
import { useCachedConnectedVendors } from "@/lib/sync/glass-cached-queries";
import { useCachedQuery, useUpdateCachedQuery } from "@/lib/sync/use-cached-query";

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
  updatedAt: number;
  complianceCheck?: {
    status: "met" | "missing" | "expiring_soon" | "expired";
    notes?: string;
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
    <Badge variant="outline" className="text-xs text-muted-foreground">
      {categoryLabel(category)}
    </Badge>
  );
}

function RequirementBadge({ label, value }: { label: string; value: string }) {
  return (
    <Badge
      variant="outline"
      className="max-w-full gap-1.5 text-xs font-normal text-muted-foreground"
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
  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex items-start justify-between gap-4 border-b border-foreground/4 px-5 py-4 last:border-b-0"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-48 rounded-full bg-foreground/6" />
            <div className="h-3 w-full max-w-xl rounded-full bg-foreground/4" />
          </div>
          <div className="h-7 w-20 rounded-full bg-foreground/4" />
        </div>
      ))}
    </div>
  );
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
    <div className="rounded-lg border border-foreground/6 bg-card p-5 sm:p-6">
      <h3 className="text-body-sm font-medium text-foreground">
        No requirements yet
      </h3>
      <p className="text-body-sm text-muted-foreground mt-1">
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
        <p className="text-body-sm font-medium text-foreground">
          {isVendorScope
            ? "Add a vendor requirement"
            : "Add one of my requirements"}
        </p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {isVendorScope
            ? "Paste contract language or upload an existing vendor requirements document."
            : "Paste compliance notes or upload an existing requirements document."}
        </p>
        <span className="mt-4 inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-foreground px-3.5 text-xs font-medium text-background">
          <FileUp className="h-3.5 w-3.5" />
          Bulk import
        </span>
      </button>
    </div>
  );
}

export function CompliancePage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  useEffect(() => {
    if (currentOrg?.orgType === "broker") router.replace("/clients");
  }, [currentOrg?.orgType, router]);

  const isBroker = currentOrg?.orgType === "broker";
  const orgId = !isBroker
    ? (currentOrg?.orgId as Id<"organizations"> | undefined)
    : undefined;
  const requirements = useCachedQuery(
    "compliance.listRequirements",
    complianceApi.compliance.listRequirements,
    orgId ? { orgId } : "skip",
  ) as Requirement[] | undefined;
  const vendorRows = useCachedConnectedVendors(orgId) as
    | ConnectedOrgRow[]
    | undefined;
  const clientRows = useCachedQuery(
    "connectedOrgs.listClients",
    complianceApi.connectedOrgs.listClients,
    orgId ? { orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"bulk" | "manual">("bulk");
  const [requirementScope, setRequirementScope] =
    useState<RequirementScope>("vendors");
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

  if (isBroker) return null;

  const hasActiveClients = (clientRows ?? []).some(
    (row) => row.status === "active",
  );
  const hasActiveVendors = (vendorRows ?? []).some(
    (row) => row.status === "active",
  );
  const isPureVendorAccount =
    clientRows !== undefined &&
    vendorRows !== undefined &&
    hasActiveClients &&
    !hasActiveVendors;

  const activeRequirementScope: RequirementScope = isPureVendorAccount
    ? "own_org"
    : requirementScope;

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

  function openBulkImport() {
    setDrawerMode("bulk");
    setDrawerOpen(true);
  }

  function openManualAdd() {
    setDrawerMode("manual");
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
      title={
        drawerMode === "bulk"
          ? `Bulk import ${scopeLabel.toLowerCase()} requirements`
          : `Add ${scopeLabel.toLowerCase()} requirement`
      }
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
      {drawerMode === "bulk" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <p className="text-body-sm text-muted-foreground">
            {activeRequirementScope === "vendors"
              ? "Paste contract insurance language or upload a vendor requirements document. Glass will turn it into structured checklist items with source provenance."
              : "Upload a lease agreement, client contract, or other source document. Glass will extract the insurance requirements you need to satisfy and keep the original source language attached."}
          </p>
          <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
            Source type
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={sourceType}
              onChange={(event) =>
                setSourceType(
                  event.target.value as Exclude<
                    RequirementSourceType,
                    "manual" | "bulk_import"
                  >,
                )
              }
              disabled={importing}
            >
              <option value="vendor_requirements">Requirements document</option>
              <option value="lease_agreement">Lease agreement</option>
              <option value="client_contract">Client contract</option>
              <option value="other">Other source document</option>
            </select>
          </label>
          <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
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
            <div className="flex items-center justify-between gap-3 rounded-lg border border-foreground/6 bg-card px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-body-sm font-medium text-foreground">
                  {sourceFile.name}
                </p>
                <p className="text-label-sm text-muted-foreground">
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
            </div>
          ) : null}
        </div>
      ) : (
        <form
          id="manual-compliance-requirement"
          onSubmit={submitRequirement}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
            Requirement title
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="General liability minimum"
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
            Category
            <select
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              {CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
            Minimum limit
            <Input
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="$1M per occurrence"
            />
          </label>
          <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
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
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={
        <>
          <PillButton
            size="compact"
            variant="secondary"
            onClick={openManualAdd}
          >
            <PencilLine className="h-3.5 w-3.5" />
            Manual
          </PillButton>
          <PillButton
            size="compact"
            variant="secondary"
            onClick={openBulkImport}
          >
            <FileUp className="h-3.5 w-3.5" />
            Extract from document
          </PillButton>
        </>
      }
      rightPanel={rightPanel}
    >
      <div className="flex w-full flex-col gap-4">
        {!isPureVendorAccount ? (
          <Tabs
            value={requirementScope}
            onValueChange={(value) =>
              setRequirementScope(value as RequirementScope)
            }
          >
            <TabsList variant="pill">
              <TabsTrigger value="vendors">Vendor requirements</TabsTrigger>
              <TabsTrigger value="own_org">My requirements</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {requirements === undefined ||
        clientRows === undefined ||
        vendorRows === undefined ? (
          <RequirementsLoadingSkeleton />
        ) : visibleRequirements.length === 0 ? (
          <ComplianceEmptyState
            scope={activeRequirementScope}
            onBulkAdd={openBulkImport}
          />
        ) : (
          <section className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
            {visibleRequirements.map((requirement) => (
              <div
                key={requirement._id}
                className="flex items-center justify-between gap-4 border-b border-foreground/4 px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {requirement.title}
                    </p>
                    {activeRequirementScope === "own_org" &&
                    requirement.complianceCheck ? (
                      <ComplianceStatusBadge
                        status={requirement.complianceCheck.status}
                      />
                    ) : null}
                    <CategoryBadge category={requirement.category} />
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
                        className="max-w-full text-xs font-normal text-muted-foreground"
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
                        className="max-w-full text-xs font-normal text-muted-foreground"
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
                  <p className="line-clamp-2 max-w-5xl text-sm leading-5 text-muted-foreground">
                    {requirement.requirementText}
                  </p>
                  {requirement.sourceExcerpt ? (
                    <p className="line-clamp-1 max-w-5xl text-xs text-muted-foreground/70">
                      Source language: {requirement.sourceExcerpt}
                    </p>
                  ) : null}
                  {activeRequirementScope === "own_org" &&
                  requirement.complianceCheck?.notes ? (
                    <p className="line-clamp-1 max-w-5xl text-xs text-muted-foreground/70">
                      {requirement.complianceCheck.notes}
                    </p>
                  ) : null}
                </div>
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
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
