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
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { FadeIn } from "@/components/ui/fade-in";
import {
  Archive,
  Clock3,
  Loader2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import type { Id } from "@/convex/_generated/dataModel";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
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
  certificateVersionActionInput,
  type CertificateHolderDraft,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import { usePageContext } from "@/hooks/use-page-context";
import { PolicyDetailsTab } from "./policy-details-tab";
import { PolicyCoveragesTab } from "./policy-coverages-tab";
import {
  extractionReviewQuestions,
  PolicyExtractionReview,
} from "./policy-extraction-review-tab";
import { PolicyBreakdownEditor } from "./policy-breakdown-editor";
import {
  PolicyDetailsEditor,
  type PolicyDetailsEditSection,
} from "./policy-details-editor";
import {
  CertificateCreatePanel,
  CertificatesTab,
  ViewPdfButton,
} from "./policy-certificates-tab";
import {
  useCachedPolicyDetail,
  useCachedPolicySummary,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { PolicyDetailSkeleton } from "./policy-detail-skeleton";
import { PolicyExtractionBanner } from "@/components/shared/extraction-banner";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";

type PolicyPipelineLogEntry = LogEntry & {
  timestamp: number;
  message: string;
  phase?: string;
  level?: string;
};

type PolicyDetailTab =
  | "details"
  | "coverages"
  | "review"
  | "certificates"
  | "history";

function parsePolicyDetailTab(value: string | null): PolicyDetailTab {
  if (
    value === "coverages" ||
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
  generalAgent: "General Agent",
  mga: "General Agent",
  isRenewal: "Renewal flag",
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function changedFieldLabel(count: number) {
  return count > 0 ? pluralize(count, "field change") : "No field changes";
}

function formatVersionDate(value: number) {
  return formatDisplayDateTime(value);
}

function formatPolicyTerm(version: PolicyVersionRow) {
  if (version.effectiveDate && version.expirationDate) {
    return `${formatDisplayDate(version.effectiveDate, version.effectiveDate)} - ${formatDisplayDate(version.expirationDate, version.expirationDate)}`;
  }
  const date = version.effectiveDate ?? version.expirationDate;
  return date ? formatDisplayDate(date, date) : "Not recorded";
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
                  <Badge variant="secondary">
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
  /** Where to navigate after a policy is archived. */
  afterArchiveHref?: string;
  /** Where to navigate after a policy is restored. */
  afterRestoreHref?: string;
  /** Hide management actions for read-only connected-vendor policy access. */
  readOnly?: boolean;
}

export function PolicyDetailBody({
  id,
  onBreadcrumb,
  onActions,
  onRightPanel,
  afterArchiveHref = "/policies?view=archived",
  afterRestoreHref = "/policies",
  readOnly = false,
}: PolicyDetailBodyProps) {
  const viewerOrg = useCachedViewerOrg();
  const searchParams = useSearchParams();
  const [showCertificateSheet, setShowCertificateSheet] = useState(false);
  const [showEditExtractedFields, setShowEditExtractedFields] = useState(false);
  const [editingPolicyDetails, setEditingPolicyDetails] =
    useState<PolicyDetailsEditSection | null>(null);
  const [selectedCertificate, setSelectedCertificate] =
    useState<PolicyCertificateRecord | null>(null);
  const [reissuingCertificateId, setReissuingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [savingCertificateId, setSavingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [archivingCertificateId, setArchivingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [activeTab, setActiveTab] = useState<PolicyDetailTab>(() =>
    parsePolicyDetailTab(searchParams.get("tab")),
  );
  const shouldLoadFullPolicy =
    activeTab === "details" ||
    activeTab === "coverages" ||
    showCertificateSheet ||
    showEditExtractedFields ||
    editingPolicyDetails !== null;
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

  const archivePolicy = useMutation(api.policies.archive);
  const restorePolicy = useMutation(api.policies.restore);
  const cancelExtraction = useMutation(api.policies.cancelExtraction);
  const archiveCertificateMutation = useMutation(
    api.certificateLifecycle.archive,
  );
  const retryExtraction = useAction(
    api.actions.retryExtraction.retryExtraction,
  );
  const generateCertificate = useAction(api.certificates.generateForPolicy);

  const [reExtracting, setReExtracting] = useState(false);
  const [cancelingExtraction, setCancelingExtraction] = useState(false);
  const router = useRouter();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const loggedPipelineEntries = useRef<Set<string>>(new Set());
  const loggedStatus = useRef<string | null>(null);

  const { openWithUrl, setFileUrl: preloadPdfUrl } = usePdf();
  const { setPageContext } = usePageContext();

  useEffect(() => {
    if (policy) {
      const lines = policyLobCodes(policy).map(lobLabel);
      const parties = resolvePolicyPartyContext(policy);
      setPageContext({
        pageType: "policy",
        entityId: policy._id,
        summary: `${parties.generalAgentName ?? parties.insurerName ?? "Unknown"} ${policy.policyNumber ?? ""} — ${lines.join(", ")}`,
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
  const policyParties = resolvePolicyPartyContext(p);
  const carrierName = policyParties.insurerName ?? "";
  const generalAgentName = policyParties.generalAgentName ?? "";
  const displayName = generalAgentName || carrierName;
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isArchived = !!p.deletedAt;
  const canEditExtractedFields =
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const canRequestBrokerExtractionHelp =
    !!viewerOrg?.brokerOrg && !readOnly && !isArchived;
  const pipelineStatus = p.pipelineStatus as PipelineStatus | undefined;
  const extractionDataStage = policyDataStage(p);
  const isPolicyFinal =
    pipelineStatus === "complete" && extractionDataStage === "final";
  const canEditPolicyDetails =
    canEditExtractedFields && !readOnly && !isArchived && isPolicyFinal;
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

  const openPolicyDetailsEditor = useCallback(
    (section: PolicyDetailsEditSection) => {
      setShowCertificateSheet(false);
      setShowEditExtractedFields(false);
      setSelectedCertificate(null);
      setEditingPolicyDetails(section);
    },
    [],
  );

  const reissueCertificate = useCallback(async (row: PolicyCertificateRecord) => {
    const holder = row.holder;
    if (!holder?.displayName) {
      toast.error("Certificate holder is missing");
      return;
    }
    setReissuingCertificateId(row._id);
    try {
      const result = await generateCertificate(certificateVersionActionInput(row));
      if ((result as { status?: string }).status === "ambiguous_certificate_holder") {
        toast.message((result as { message?: string }).message ?? "Choose the existing certificate to reissue.");
        return;
      }
      if ((result as { status?: string }).status === "held_policy_change_required") {
        toast.message((result as { message?: string }).message ?? "Broker review is needed before reissue.");
        return;
      }
      toast.success("Certificate reissued");
      if ((result as { url?: string }).url) {
        openWithUrl((result as { url: string }).url);
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not reissue certificate"),
      );
    } finally {
      setReissuingCertificateId(null);
    }
  }, [generateCertificate, openWithUrl]);

  const editCertificateHolder = useCallback(async (
    row: PolicyCertificateRecord,
    draft: CertificateHolderDraft,
  ) => {
    setSavingCertificateId(row._id);
    try {
      const result = await generateCertificate(
        certificateVersionActionInput(row, draft),
      );
      if ((result as { status?: string }).status === "held_policy_change_required") {
        toast.message(
          (result as { message?: string }).message ??
            "Broker review is needed before generating this version.",
        );
        return false;
      }
      const versionNumber = (result as { versionNumber?: number }).versionNumber;
      toast.success(
        versionNumber
          ? `Certificate version ${versionNumber} generated`
          : "New certificate version generated",
      );
      if ((result as { url?: string }).url) {
        openWithUrl((result as { url: string }).url);
      }
      return true;
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not update certificate holder",
        ),
      );
      return false;
    } finally {
      setSavingCertificateId(null);
    }
  }, [generateCertificate, openWithUrl]);

  const archiveCertificate = useCallback(
    async (row: PolicyCertificateRecord) => {
      setArchivingCertificateId(row._id);
      try {
        await archiveCertificateMutation({ certificateId: row._id });
        setSelectedCertificate(null);
        toast.success("Certificate archived");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not archive certificate"),
        );
      } finally {
        setArchivingCertificateId(null);
      }
    },
    [archiveCertificateMutation],
  );

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

  const handleArchive = async () => {
    if (!policy) return;
    setArchiving(true);
    try {
      await archivePolicy({ id: policy._id });
      setShowArchiveDialog(false);
      toast.success("Policy archived");
      router.push(afterArchiveHref);
    } catch {
      toast.error("Failed to archive policy");
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!policy) return;
    setRestoring(true);
    try {
      await restorePolicy({ id: policy._id });
      toast.success("Policy restored");
      router.push(afterRestoreHref);
    } catch {
      toast.error("Failed to restore policy");
    } finally {
      setRestoring(false);
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
        {!readOnly && !isArchived && (
          <PillButton
            size="compact"
            variant="icon"
            label="Archive"
            onClick={() => setShowArchiveDialog(true)}
          >
            <Archive className="size-4 shrink-0" strokeWidth={2} />
          </PillButton>
        )}
        {!readOnly && !isArchived && (
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
        {!readOnly && !isArchived && (
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
    isArchived,
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
        />,
      );
      return () => onRightPanel(null);
    }
    if (editingPolicyDetails && fullPolicy && canEditPolicyDetails) {
      onRightPanel(
        <PolicyDetailsEditor
          key={`${fullPolicy._id}:${editingPolicyDetails}`}
          policy={
            fullPolicy as unknown as Record<string, unknown> & {
              _id: Id<"policies">;
            }
          }
          section={editingPolicyDetails}
          open
          onOpenChange={(open) => {
            if (!open) setEditingPolicyDetails(null);
          }}
        />,
      );
      return () => onRightPanel(null);
    }
    if (
      showEditExtractedFields &&
      fullPolicy &&
      canEditExtractedFields &&
      !isArchived
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
          onReissue={!readOnly ? reissueCertificate : undefined}
          onEditHolder={!readOnly ? editCertificateHolder : undefined}
          onArchive={!readOnly ? archiveCertificate : undefined}
          reissuing={reissuingCertificateId === selectedCertificateForPanel._id}
          savingHolder={savingCertificateId === selectedCertificateForPanel._id}
          archiving={archivingCertificateId === selectedCertificateForPanel._id}
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
    editingPolicyDetails,
    selectedCertificateForPanel,
    reissueCertificate,
    editCertificateHolder,
    archiveCertificate,
    reissuingCertificateId,
    savingCertificateId,
    archivingCertificateId,
    canEditExtractedFields,
    canEditPolicyDetails,
    isArchived,
  ]);

  if (policy === undefined) {
    return <PolicyDetailSkeleton />;
  }

  if (policy === null) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-2">Policy not found</p>
        <Link
          href={afterRestoreHref}
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
        {isArchived && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-foreground/8 bg-foreground/[0.025] px-4 py-2.5">
            <p className="flex-1 text-base text-muted-foreground">
              This policy is archived and excluded from active Glass workflows.
            </p>
            {!readOnly ? (
              <PillButton
                variant="secondary"
                size="compact"
                onClick={handleRestore}
                disabled={restoring}
              >
                {restoring ? "Restoring..." : "Restore"}
              </PillButton>
            ) : null}
          </div>
        )}
      </FadeIn>

      <Dialog
        open={showArchiveDialog}
        onOpenChange={(v) => !v && setShowArchiveDialog(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Archive policy</DialogTitle>
            <DialogDescription>
              Archive <strong>{policyNumber}</strong>? It will be excluded from
              active policy lists, compliance, search, and Glass tools until restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowArchiveDialog(false)}
              disabled={archiving}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="secondary"
              onClick={handleArchive}
              disabled={archiving}
            >
              {archiving ? "Archiving..." : "Archive"}
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
              { id: "coverages" as const, label: "Coverages" },
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
                  <span className="rounded-full border border-foreground/10 px-1.5 text-tag text-muted-foreground">
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
          canEdit={canEditPolicyDetails}
          onEdit={openPolicyDetailsEditor}
        />
      )}

      {visibleActiveTab === "coverages" && fullPolicy === undefined ? (
        <OperationalSkeletonList rows={5} showTrailing={false} />
      ) : null}

      {visibleActiveTab === "coverages" && fullPolicy ? (
        <PolicyCoveragesTab policy={fullPolicy} fileUrl={fileUrl} />
      ) : null}

      {visibleActiveTab === "review" && hasExtractionReviews && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          <PolicyExtractionReview
            policy={
              policy as unknown as Record<string, unknown> & {
                _id: Id<"policies">;
              }
            }
            readOnly={readOnly || isArchived}
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
