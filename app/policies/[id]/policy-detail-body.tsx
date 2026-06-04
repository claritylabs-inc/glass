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
import { Loader2, Plus, RotateCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { usePdf } from "@/components/pdf-context";
import { usePageContext } from "@/hooks/use-page-context";
import { PolicyDetailsTab } from "./policy-details-tab";
import {
  extractionReviewQuestions,
  PolicyExtractionReview,
} from "./policy-extraction-review-tab";
import { PolicyBreakdownEditor } from "./policy-breakdown-editor";
import { PolicyChangesTab } from "./policy-changes-tab";
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

type PolicyPipelineLogEntry = LogEntry & {
  timestamp: number;
  message: string;
  phase?: string;
  level?: string;
};

type PolicyDetailTab = "details" | "review" | "certificates" | "changes";

function parsePolicyDetailTab(value: string | null): PolicyDetailTab {
  if (value === "review" || value === "certificates" || value === "changes") {
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
  const documentType: string =
    (p.documentType as string | undefined) ?? "policy";
  const carrierName = (p.carrier as string | undefined) ?? "";
  const administratorName = (p.mga as string | undefined) ?? "";
  const displayName = administratorName || carrierName;
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isDeleted = !!p.deletedAt;
  const canManagePolicyChanges =
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const canEditExtractedFields =
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const canRequestBrokerExtractionHelp =
    !!viewerOrg?.brokerOrg && !readOnly && !isDeleted;
  const pipelineStatus = p.pipelineStatus as PipelineStatus | undefined;
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
        {documentType === "quote" && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-label font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 ml-1.5">
            Quote
          </span>
        )}
      </>,
    );
    return () => onBreadcrumb(null);
  }, [onBreadcrumb, policy, displayName, policyNumber, documentType]);

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
        <ViewPdfButton url={fileUrl} disabled={isProcessingPolicy} />
        {!readOnly && !isDeleted && (
          <PillButton
            size="compact"
            disabled={isProcessingPolicy}
            onClick={() => setShowCertificateSheet(true)}
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
    handleCancelExtraction,
    fileUrl,
    visibleActiveTab,
    canEditExtractedFields,
    setShowCertificateSheet,
  ]);

  useEffect(() => {
    if (!onRightPanel) return;
    if (!policy || readOnly) {
      onRightPanel(null);
      return;
    }
    if (showCertificateSheet) {
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
    onRightPanel(null);
    return () => onRightPanel(null);
  }, [
    onRightPanel,
    policy,
    fullPolicy,
    readOnly,
    showCertificateSheet,
    showEditExtractedFields,
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
              { id: "changes" as const, label: "Changes" },
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
        <PolicyDetailsTab
          policy={policy}
          fileUrl={fileUrl}
          pipelineLog={pipelineLog}
          canCancelExtraction={canCancelExtraction}
          cancelingExtraction={cancelingExtraction}
          onCancelExtraction={handleCancelExtraction}
        />
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

      {visibleActiveTab === "changes" && (
        <PolicyChangesTab policyId={id} canManage={canManagePolicyChanges} />
      )}

      {visibleActiveTab === "certificates" && (
        <CertificatesTab policyId={policy._id} />
      )}
    </>
  );
}
