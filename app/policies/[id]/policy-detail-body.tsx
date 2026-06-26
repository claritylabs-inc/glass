"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/fade-in";
import {
  Clock3,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
  OperationalSkeletonList,
} from "@/components/ui/operational-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { usePdf } from "@/components/pdf-context";
import {
  CertificateDetailPanel,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import { usePageContext } from "@/hooks/use-page-context";
import { PolicyDetailsTab } from "./policy-details-tab";
import {
  extractionReviewQuestions,
  PolicyExtractionReview,
} from "./policy-extraction-review-tab";
import { PolicyBreakdownEditor } from "./policy-breakdown-editor";
import {
  CertificateCreatePanel,
  CertificatesTab,
  ViewPdfButton,
  type ProgramMatchCandidate,
} from "./policy-certificates-tab";
import {
  useCachedPolicyDetail,
  useCachedPolicySummary,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { PolicyDetailSkeleton } from "./policy-detail-skeleton";
import { PolicyExtractionBanner } from "@/components/shared/extraction-banner";

type PolicyPipelineLogEntry = LogEntry & {
  timestamp: number;
  message: string;
  phase?: string;
  level?: string;
};

type PolicyDetailTab =
  | "details"
  | "review"
  | "certificates"
  | "history";

function parsePolicyDetailTab(value: string | null): PolicyDetailTab {
  if (
    value === "review" ||
    value === "certificates" ||
    value === "history"
  ) {
    return value;
  }
  return "details";
}

const LOG_POLICY_ACTIVITY_IN_BROWSER =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "development";

function logPolicyActivityToBrowser(
  event: "status" | "audit" | "pipeline_log",
  payload: Record<string, unknown>,
) {
  if (!LOG_POLICY_ACTIVITY_IN_BROWSER) return;
  console.info(`[policy-activity] ${event}`, payload);
}

type PolicyVersionRow = {
  _id: Id<"policyVersions">;
  versionNumber: number;
  versionKind: "new_policy" | "policy_change" | "re_extraction" | "renewal";
  effectiveDate?: string;
  expirationDate?: string;
  policyNumber?: string;
  summary?: string;
  fieldDiffs?: PolicyVersionFieldDiff[];
  createdAt: number;
};

type PolicyVersionFieldDiff = {
  fieldPath?: string;
};

const POLICY_VERSION_LABELS: Record<PolicyVersionRow["versionKind"], string> = {
  new_policy: "New policy",
  policy_change: "Policy change",
  re_extraction: "Re-extraction",
  renewal: "Renewal",
};

const POLICY_VERSION_FIELD_LABEL_OVERRIDES: Record<string, string> = {
  insuredDba: "Insured DBA",
  mga: "Administrator",
  isRenewal: "Renewal flag",
  partnerOrgId: "Partner org",
  partnerProgramId: "Partner program",
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function changedFieldLabel(count: number) {
  return count > 0 ? pluralize(count, "field change") : "No field changes";
}

function formatVersionDate(value: number) {
  return dayjs(value).format("MMM D, YYYY h:mm A");
}

function formatPolicyTerm(version: PolicyVersionRow) {
  if (version.effectiveDate && version.expirationDate) {
    return `${version.effectiveDate} - ${version.expirationDate}`;
  }
  return version.effectiveDate ?? version.expirationDate ?? "Not recorded";
}

function meaningfulVersionSummary(version: PolicyVersionRow) {
  const summary = version.summary?.trim();
  if (!summary) return undefined;
  if (
    version.versionKind === "new_policy" &&
    summary.startsWith("Initial policy - ")
  ) {
    return undefined;
  }
  return summary;
}

function formatFieldLabel(fieldPath: string) {
  const knownLabel = POLICY_VERSION_FIELD_LABEL_OVERRIDES[fieldPath];
  if (knownLabel) return knownLabel;
  return fieldPath
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function changedFieldLabels(version: PolicyVersionRow) {
  return (version.fieldDiffs ?? [])
    .map((diff) => diff.fieldPath)
    .filter((fieldPath): fieldPath is string => !!fieldPath)
    .map(formatFieldLabel);
}

function HistoryDatum({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-label text-muted-foreground">{label}</p>
      <p className="mt-0.5 min-w-0 break-words text-base leading-5 text-foreground">
        {value}
      </p>
    </div>
  );
}

function policyDataStage(policy: Record<string, unknown>) {
  const stage = policy.extractionDataStage;
  if (stage === "placeholder" || stage === "preview" || stage === "final") {
    return stage;
  }
  return policy.pipelineStatus === "complete" ? "final" : "placeholder";
}

function ProvisionalPolicyGate({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader title={title} description={description} />
      <OperationalPanelBody className="px-4 py-5 text-base text-muted-foreground">
        Extraction is complete for this policy. Enrichment is still running, so
        source-backed actions are held until enrichment finishes.
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

function PolicyHistoryTab({ policyId }: { policyId: Id<"policies"> }) {
  const versions = useCachedQuery(
    "policyVersions.listByPolicy",
    api.policyVersions.listByPolicy,
    { policyId },
  ) as PolicyVersionRow[] | undefined;

  if (versions === undefined) {
    return <OperationalSkeletonList rows={3} />;
  }

  if (versions.length === 0) {
    return (
      <OperationalPanel as="div">
        <OperationalPanelBody className="px-4 py-8 text-center">
          <Clock3 className="mx-auto mb-3 h-5 w-5 text-muted-foreground/50" />
          <p className="text-base font-medium text-foreground">
            No policy history yet
          </p>
          <p className="mt-1 text-base text-muted-foreground">
            Policy versions will appear as renewals, endorsements, and
            re-extractions are recorded.
          </p>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  const currentPolicyNumber = versions[0]?.policyNumber;

  return (
    <OperationalPanel as="div">
      {versions.map((version, index) => {
        const fields = changedFieldLabels(version);
        const diffCount = fields.length;
        const summary = meaningfulVersionSummary(version);
        const showChangeCount =
          diffCount > 0 || version.versionKind !== "new_policy";
        const showEventKind = version.versionKind !== "new_policy";
        const showPolicyNumber =
          !!version.policyNumber &&
          versions.length > 1 &&
          version.policyNumber !== currentPolicyNumber;
        return (
          <OperationalItem key={version._id} className="py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-base font-medium text-foreground">
                  Version {version.versionNumber}
                </h3>
                {showEventKind ? (
                  <span className="text-base text-muted-foreground">
                    {POLICY_VERSION_LABELS[version.versionKind]}
                  </span>
                ) : null}
                {index === 0 ? (
                  <Badge variant="secondary" className="text-label">
                    Current
                  </Badge>
                ) : null}
                <span className="text-label text-muted-foreground sm:ml-auto">
                  {formatVersionDate(version.createdAt)}
                </span>
              </div>
              {summary ? (
                <p className="mt-1 max-w-4xl text-base leading-5 text-foreground">
                  {summary}
                </p>
              ) : null}
              <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.8fr)]">
                {showPolicyNumber ? (
                  <HistoryDatum
                    label="Policy number"
                    value={version.policyNumber}
                  />
                ) : null}
                <HistoryDatum label="Term" value={formatPolicyTerm(version)} />
                {showChangeCount ? (
                  <HistoryDatum
                    label="Changes"
                    value={changedFieldLabel(diffCount)}
                  />
                ) : null}
              </div>
              {fields.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-label text-muted-foreground">
                    Changed
                  </span>
                  {fields.slice(0, 5).map((field) => (
                    <Badge
                      key={`${version._id}-${field}`}
                      variant="ghost"
                      className="text-label text-muted-foreground"
                    >
                      {field}
                    </Badge>
                  ))}
                  {fields.length > 5 ? (
                    <span className="text-label text-muted-foreground">
                      +{fields.length - 5} more
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </OperationalItem>
        );
      })}
    </OperationalPanel>
  );
}

export interface PolicyDetailBodyProps {
  id: string;
  /** Called whenever the breadcrumb label changes. Host renders it. */
  onBreadcrumb?: (node: ReactNode) => void;
  /** Called whenever the header actions change. Host renders them. */
  onActions?: (node: ReactNode) => void;
  /** Called whenever the right-side panel changes. Host renders it next to the main pane. */
  onRightPanel?: (node: ReactNode) => void;
  /** Where to navigate after a policy is deleted. Default: /policies */
  afterDeleteHref?: string;
  /** Hide management actions for read-only connected-vendor policy access. */
  readOnly?: boolean;
}

export function PolicyDetailBody({
  id,
  onBreadcrumb,
  onActions,
  onRightPanel,
  afterDeleteHref = "/policies",
  readOnly = false,
}: PolicyDetailBodyProps) {
  const viewerOrg = useCachedViewerOrg();
  const searchParams = useSearchParams();
  const [showCertificateSheet, setShowCertificateSheet] = useState(false);
  const [showEditExtractedFields, setShowEditExtractedFields] = useState(false);
  const [selectedCertificate, setSelectedCertificate] =
    useState<PolicyCertificateRecord | null>(null);
  const [activeTab, setActiveTab] = useState<PolicyDetailTab>(() =>
    parsePolicyDetailTab(searchParams.get("tab")),
  );
  const shouldLoadFullPolicy =
    activeTab === "details" || showCertificateSheet || showEditExtractedFields;
  const policySummary = useCachedPolicySummary(id as Id<"policies">);
  const fullPolicy = useCachedPolicyDetail(
    id as Id<"policies">,
    shouldLoadFullPolicy,
  );
  const policy = fullPolicy ?? policySummary;
  const fileUrl = useCachedQuery(
    "policies.getPolicyFileUrl.detail",
    api.policies.getPolicyFileUrl,
    policy ? { policyId: id as Id<"policies"> } : "skip",
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const cancelExtraction = useMutation(api.policies.cancelExtraction);
  const retryExtraction = useAction(
    api.actions.retryExtraction.retryExtraction,
  );

  const [reExtracting, setReExtracting] = useState(false);
  const [cancelingExtraction, setCancelingExtraction] = useState(false);
  const router = useRouter();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const loggedPipelineEntries = useRef<Set<string>>(new Set());
  const loggedStatus = useRef<string | null>(null);

  const { openWithUrl, setFileUrl: preloadPdfUrl } = usePdf();
  const { setPageContext } = usePageContext();

  useEffect(() => {
    if (policy) {
      const types = policy.policyTypes ?? [];
      setPageContext({
        pageType: "policy",
        entityId: policy._id,
        summary: `${policy.mga ?? policy.carrier ?? "Unknown"} ${policy.policyNumber ?? ""} — ${types.join(", ")}`,
      });
    }
    return () => setPageContext(null);
  }, [policy, setPageContext]);

  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (fileUrl && !didAutoOpen.current) {
      didAutoOpen.current = true;
      preloadPdfUrl(fileUrl);
      if (initialPage) {
        openWithUrl(fileUrl, initialPage);
      }
    }
  }, [fileUrl, initialPage, openWithUrl, preloadPdfUrl]);

  const p = (policy ?? {}) as unknown as Record<string, unknown>;
  const carrierName = (p.carrier as string | undefined) ?? "";
  const administratorName = (p.mga as string | undefined) ?? "";
  const displayName = administratorName || carrierName;
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isDeleted = !!p.deletedAt;
  const canEditExtractedFields =
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const canRequestBrokerExtractionHelp =
    !!viewerOrg?.brokerOrg && !readOnly && !isDeleted;
  const pipelineStatus = p.pipelineStatus as PipelineStatus | undefined;
  const extractionDataStage = policyDataStage(p);
  const isPolicyFinal =
    pipelineStatus === "complete" && extractionDataStage === "final";
  const canCancelExtraction =
    pipelineStatus === "running" || pipelineStatus === "paused";
  const isProcessingPolicy =
    !pipelineStatus ||
    pipelineStatus === "idle" ||
    pipelineStatus === "running" ||
    pipelineStatus === "paused";
  const rawPipelineLog = p.pipelineLog;
  const pipelineLog: PolicyPipelineLogEntry[] = useMemo(
    () =>
      Array.isArray(rawPipelineLog)
        ? (rawPipelineLog as PolicyPipelineLogEntry[])
        : [],
    [rawPipelineLog],
  );
  const reviewQuestions = extractionReviewQuestions(p);
  const hasExtractionReviews = reviewQuestions.length > 0;
  const visibleActiveTab =
    activeTab === "review" && !hasExtractionReviews ? "details" : activeTab;
  const selectedCertificateForPanel =
    visibleActiveTab === "certificates" &&
    selectedCertificate?.policyId === policy?._id
      ? selectedCertificate
      : null;

  useEffect(() => {
    loggedPipelineEntries.current.clear();
    loggedStatus.current = null;
  }, [id]);

  useEffect(() => {
    if (!LOG_POLICY_ACTIVITY_IN_BROWSER || !policy) return;
    const statusKey = [
      policy._id,
      pipelineStatus ?? "unknown",
      (p.pipelineError as string | undefined) ?? "",
    ].join(":");
    if (loggedStatus.current === statusKey) return;
    loggedStatus.current = statusKey;
    logPolicyActivityToBrowser("status", {
      policyId: policy._id,
      policyNumber,
      status: pipelineStatus ?? "unknown",
      error: p.pipelineError,
    });
  }, [policy, pipelineStatus, p.pipelineError, policyNumber]);

  useEffect(() => {
    if (!LOG_POLICY_ACTIVITY_IN_BROWSER || pipelineLog.length === 0) return;
    for (const entry of pipelineLog) {
      const key = [
        entry.timestamp,
        entry.phase ?? "",
        entry.level ?? "",
        entry.message,
      ].join(":");
      if (loggedPipelineEntries.current.has(key)) continue;
      loggedPipelineEntries.current.add(key);
      logPolicyActivityToBrowser("pipeline_log", {
        policyId: id,
        policyNumber,
        timestamp: dayjs(entry.timestamp).toISOString(),
        phase: entry.phase,
        level: entry.level ?? "info",
        message: entry.message,
      });
    }
  }, [id, pipelineLog, policyNumber]);

  useEffect(() => {
    if (!onBreadcrumb) return;
    if (!policy) {
      onBreadcrumb(null);
      return;
    }
    onBreadcrumb(
      <>
        {displayName} {policyNumber}
      </>,
    );
    return () => onBreadcrumb(null);
  }, [onBreadcrumb, policy, displayName, policyNumber]);

  const handleDelete = async () => {
    if (!policy) return;
    setDeleting(true);
    try {
      await softDelete({ id: policy._id });
      setShowDeleteDialog(false);
      toast.success("Policy deleted");
      router.push(afterDeleteHref);
    } catch {
      toast.error("Failed to delete policy");
    } finally {
      setDeleting(false);
    }
  };

  const handleReextractFromSource = async () => {
    setReExtracting(true);
    try {
      await retryExtraction({ policyId: id as Id<"policies">, mode: "full" });
      toast.success("Re-extraction started");
      setShowRefreshDialog(false);
    } catch {
      toast.error("Re-extraction failed");
    } finally {
      setReExtracting(false);
    }
  };

  const handleCancelExtraction = useCallback(async () => {
    if (!policy) return;
    setCancelingExtraction(true);
    try {
      await cancelExtraction({ id: policy._id });
      toast.success("Extraction cancelled");
    } catch {
      toast.error("Failed to cancel extraction");
    } finally {
      setCancelingExtraction(false);
    }
  }, [cancelExtraction, policy]);

  const explainFinalExtractionGate = useCallback(() => {
    toast.message("Enrichment is still running", {
      description:
        "Policy details are available now. COIs, endorsements, and source-backed actions unlock when enrichment finishes.",
    });
  }, []);

  useEffect(() => {
    if (!onActions) return;
    if (!policy) {
      onActions(null);
      return;
    }
    onActions(
      <>
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
            variant="icon"
            label="Delete"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="size-4 shrink-0" strokeWidth={2} />
          </PillButton>
        )}
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
            variant="icon"
            label="Re-extract"
            disabled={isProcessingPolicy || reExtracting || cancelingExtraction}
            onClick={() => setShowRefreshDialog(true)}
          >
            {reExtracting ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <RotateCw className="size-4 shrink-0" />
            )}
          </PillButton>
        )}
        <ViewPdfButton url={fileUrl} disabled={!fileUrl} />
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
            onClick={() => {
              if (!isPolicyFinal) {
                explainFinalExtractionGate();
                return;
              }
              setSelectedCertificate(null);
              setShowCertificateSheet(true);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Generate COI
          </PillButton>
        )}
      </>,
    );
    return () => onActions(null);
  }, [
    onActions,
    policy,
    readOnly,
    isDeleted,
    reExtracting,
    cancelingExtraction,
    canCancelExtraction,
    isProcessingPolicy,
    isPolicyFinal,
    explainFinalExtractionGate,
    handleCancelExtraction,
    fileUrl,
    visibleActiveTab,
    canEditExtractedFields,
    setShowCertificateSheet,
  ]);

  useEffect(() => {
    if (!onRightPanel) return;
    if (!policy) {
      onRightPanel(null);
      return;
    }
    if (showCertificateSheet && !readOnly && isPolicyFinal) {
      onRightPanel(
        <CertificateCreatePanel
          open={showCertificateSheet}
          onOpenChange={setShowCertificateSheet}
          policyId={policy._id}
          initialProgram={
            (policy as { partnerProgram?: ProgramMatchCandidate | null })
              .partnerProgram ?? null
          }
        />,
      );
      return () => onRightPanel(null);
    }
    if (
      showEditExtractedFields &&
      fullPolicy &&
      canEditExtractedFields &&
      !isDeleted
    ) {
      onRightPanel(
        <PolicyBreakdownEditor
          key={fullPolicy._id}
          policy={
            fullPolicy as unknown as Record<string, unknown> & {
              _id: Id<"policies">;
            }
          }
          readOnly={false}
          open={showEditExtractedFields}
          onOpenChange={setShowEditExtractedFields}
        />,
      );
      return () => onRightPanel(null);
    }
    if (selectedCertificateForPanel) {
      onRightPanel(
        <CertificateDetailPanel
          row={selectedCertificateForPanel}
          onClose={() => setSelectedCertificate(null)}
        />,
      );
      return () => onRightPanel(null);
    }
    onRightPanel(null);
    return () => onRightPanel(null);
  }, [
    onRightPanel,
    policy,
    fullPolicy,
    readOnly,
    isPolicyFinal,
    showCertificateSheet,
    showEditExtractedFields,
    selectedCertificateForPanel,
    canEditExtractedFields,
    isDeleted,
  ]);

  if (policy === undefined) {
    return <PolicyDetailSkeleton />;
  }

  if (policy === null) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-2">Policy not found</p>
        <Link
          href={afterDeleteHref}
          className="text-primary hover:underline text-base"
        >
          Back to policies
        </Link>
      </div>
    );
  }

  return (
    <>
      <FadeIn when={true} staggerIndex={0} duration={0.6}>
        {isDeleted && (
          <div className="flex items-center gap-3 mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5">
            <p className="text-base text-red-700 dark:text-red-400 flex-1">
              This policy has been deleted.
            </p>
            {!readOnly ? (
              <PillButton
                variant="secondary"
                size="compact"
                onClick={() => restorePolicy({ id: policy._id })}
              >
                Restore
              </PillButton>
            ) : null}
          </div>
        )}
      </FadeIn>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(v) => !v && setShowDeleteDialog(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Policy</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{policyNumber}</strong>?
              The policy can be restored later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleting}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showRefreshDialog}
        onOpenChange={(v) => !v && !reExtracting && setShowRefreshDialog(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Re-extract policy data</DialogTitle>
            <DialogDescription>
              Rerun extraction from the original file for{" "}
              <strong>{policyNumber}</strong>. This will regenerate the
              structured policy data and searchable chunks.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowRefreshDialog(false)}
              disabled={reExtracting}
            >
              Cancel
            </PillButton>
            <PillButton
              onClick={handleReextractFromSource}
              disabled={reExtracting}
            >
              {reExtracting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Re-extract
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {Boolean(p.isDemo) && !demoBannerDismissed && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 mb-4">
          <p className="text-label text-amber-700 dark:text-amber-400 flex-1">
            You&apos;re viewing demo data.{" "}
            <Link
              href="/profile"
              className="underline font-medium hover:text-amber-900"
            >
              Remove demo data
            </Link>{" "}
            from Settings when you&apos;re ready.
          </p>
          <button
            type="button"
            onClick={() => setDemoBannerDismissed(true)}
            className="text-amber-500 hover:text-amber-700 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <PolicyExtractionBanner
        policyId={policy._id}
        status={pipelineStatus}
        extractionDataStage={extractionDataStage}
        error={p.pipelineError as string | undefined}
        log={pipelineLog}
        onCancel={canCancelExtraction ? handleCancelExtraction : undefined}
        cancelling={cancelingExtraction}
      />

      <Tabs
        value={visibleActiveTab}
        onValueChange={(value) => setActiveTab(value as PolicyDetailTab)}
        className="mb-6"
      >
        <TabsList variant="pill">
          {(
            [
              { id: "details" as const, label: "Details" },
              ...(hasExtractionReviews
                ? [{ id: "review" as const, label: "Review" }]
                : []),
              { id: "certificates" as const, label: "Certificates" },
              { id: "history" as const, label: "History" },
            ] as const
          ).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.id === "review" ? (
                <span className="inline-flex items-center gap-1.5">
                  Review
                  <span className="rounded-full border border-foreground/10 px-1.5 text-label leading-4 text-muted-foreground">
                    {reviewQuestions.length}
                  </span>
                </span>
              ) : (
                tab.label
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visibleActiveTab === "details" && (
        <PolicyDetailsTab policy={policy} fileUrl={fileUrl} />
      )}

      {visibleActiveTab === "review" && hasExtractionReviews && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          <PolicyExtractionReview
            policy={
              policy as unknown as Record<string, unknown> & {
                _id: Id<"policies">;
              }
            }
            readOnly={readOnly || isDeleted}
            canRequestBrokerHelp={canRequestBrokerExtractionHelp}
          />
        </FadeIn>
      )}

      {visibleActiveTab === "certificates" && !isPolicyFinal && (
        <ProvisionalPolicyGate
          title="Certificates unavailable"
          description="COI generation requires enrichment to finish for this policy."
        />
      )}

      {visibleActiveTab === "certificates" && isPolicyFinal && (
        <CertificatesTab
          policyId={policy._id}
          selectedCertificateId={selectedCertificateForPanel?._id ?? null}
          onSelectCertificate={setSelectedCertificate}
        />
      )}

      {visibleActiveTab === "history" && (
        <PolicyHistoryTab policyId={policy._id} />
      )}
    </>
  );
}
