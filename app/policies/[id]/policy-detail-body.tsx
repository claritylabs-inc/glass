"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/fade-in";
import { CheckCircle2, FileText, Loader2, RotateCw, Send, Trash2, Eye, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { StructuredLog, type StructuredLogEntry } from "@/components/structured-log";
import { useRouter, useSearchParams } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
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

import { PolicySummary } from "./policy-summary";
import { ExtractionCards } from "./extraction-panel";
import { PolicyExtractionBanner } from "@/components/shared/extraction-banner";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";

function classifyExtractionMessage(msg: string): StructuredLogEntry["status"] {
  if (/^(failed|error)/i.test(msg)) return "error";
  if (/^warning/i.test(msg)) return "warning";
  if (/(complete|success|stored|finished|done)/i.test(msg)) return "success";
  if (/(started|starting|beginning|extracting|processing|parsing|analyzing)/i.test(msg)) return "info";
  return "info";
}

const AUDIT_ACTION_CONFIG: Record<
  string,
  { status: StructuredLogEntry["status"]; title: string }
> = {
  created: { status: "info", title: "Policy created" },
  extraction_started: { status: "info", title: "Extraction started" },
  extraction_complete: { status: "success", title: "Extraction complete" },
  extraction_error: { status: "error", title: "Extraction failed" },
  re_extraction: { status: "warning", title: "Re-extraction triggered" },
  pdf_uploaded: { status: "info", title: "PDF uploaded" },
  deleted: { status: "error", title: "Policy deleted" },
  restored: { status: "success", title: "Policy restored" },
  dismissed: { status: "warning", title: "Policy dismissed" },
  agent_referenced: { status: "info", title: "Referenced by Glass" },
};

const EXTRACTION_ACTIONS = new Set([
  "extraction_started",
  "re_extraction",
  "extraction_complete",
  "extraction_error",
]);

function PolicyActivityTab({
  policyId,
  policy,
}: {
  policyId: string;
  policy: Record<string, unknown>;
}) {
  const entries = useQuery(api.policyAuditLog.listByPolicy, {
    policyId: policyId as Id<"policies">,
  });

  const isLive = policy.pipelineStatus === "running";

  if (entries === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        <div className="px-4 py-2 border-b border-foreground/6 bg-foreground/[0.015]">
          <div className="h-4 w-28 bg-foreground/5 rounded animate-pulse" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="px-4 py-2.5 border-b border-foreground/[0.04] grid grid-cols-[100px_1fr_1fr] gap-3"
          >
            <div className="h-3.5 w-16 bg-foreground/5 rounded animate-pulse" />
            <div className="h-3.5 w-32 bg-foreground/5 rounded animate-pulse" />
            <div className="h-3.5 w-24 bg-foreground/5 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const auditEntries = [...entries]
    .sort((a, b) => a._creationTime - b._creationTime)
    .map((entry) => {
      const cfg = AUDIT_ACTION_CONFIG[entry.action] ?? {
        status: "info" as const,
        title: entry.action,
      };
      return { ...entry, _cfg: cfg };
    });

  const rawLog: { timestamp: number; message: string }[] = Array.isArray(
    policy.pipelineLog,
  )
    ? (policy.pipelineLog as { timestamp: number; message: string }[])
    : [];
  const extractionSubEntries: StructuredLogEntry["subEntries"] = rawLog.map(
    (entry) => ({
      timestamp: entry.timestamp,
      message: entry.message,
      status: classifyExtractionMessage(entry.message),
    }),
  );

  const lastExtractionIdx = auditEntries.findLastIndex((e) =>
    EXTRACTION_ACTIONS.has(e.action),
  );

  const logEntries: StructuredLogEntry[] = auditEntries.map((entry, i) => {
    const isExtractionParent =
      i === lastExtractionIdx && extractionSubEntries.length > 0;

    return {
      id: entry._id,
      timestamp: entry._creationTime,
      status: entry._cfg.status,
      event: entry._cfg.title,
      detail: entry.detail,
      meta: entry.metadata
        ? typeof entry.metadata === "object"
          ? (entry.metadata as Record<string, string | number | boolean>)
          : { info: String(entry.metadata) }
        : undefined,
      subEntries: isExtractionParent ? extractionSubEntries : undefined,
    };
  });

  return (
    <StructuredLog
      entries={logEntries}
      live={isLive}
      emptyMessage="No activity recorded yet"
    />
  );
}

function PolicyChangesTab({ policyId }: { policyId: string }) {
  const [selectedCaseId, setSelectedCaseId] = useState<Id<"policyChangeCases"> | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const cases = useQuery(api.policyChanges.listByPolicy, {
    policyId: policyId as Id<"policies">,
  });
  const activeCaseId = selectedCaseId ?? cases?.[0]?._id ?? null;
  const detail = useQuery(
    api.policyChanges.getCaseDetail,
    activeCaseId ? { caseId: activeCaseId } : "skip",
  );
  const generatePacket = useMutation(api.policyChanges.generateCarrierPacket);
  const markStatus = useMutation(api.policyChanges.markStatus);

  if (cases === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-card px-4 py-6 text-center">
        <p className="text-body-sm text-muted-foreground">
          No policy change requests recorded yet.
        </p>
      </div>
    );
  }

  const handleGeneratePacket = async () => {
    if (!activeCaseId) return;
    setPacketLoading(true);
    try {
      await generatePacket({ caseId: activeCaseId });
      toast.success("Carrier packet generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate packet");
    } finally {
      setPacketLoading(false);
    }
  };

  const handleStatus = async (status: "submitted" | "accepted" | "declined") => {
    if (!activeCaseId) return;
    setStatusLoading(status);
    try {
      await markStatus({ caseId: activeCaseId, status });
      toast.success(`Marked ${status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update status");
    } finally {
      setStatusLoading(null);
    }
  };

  const activeCase = detail?.case;
  const packet = detail?.latestPacket;
  const items = Array.isArray(activeCase?.items) ? activeCase.items as Record<string, unknown>[] : [];
  const missingInfo = Array.isArray(activeCase?.missingInfoQuestions)
    ? activeCase.missingInfoQuestions as Record<string, unknown>[]
    : [];
  const validationIssues = Array.isArray(activeCase?.validationIssues)
    ? activeCase.validationIssues as Record<string, unknown>[]
    : [];
  const artifacts = Array.isArray(packet?.artifacts) ? packet.artifacts as Record<string, unknown>[] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)]">
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {cases.map((change) => {
          const missingInfoCount = Array.isArray(change.missingInfoQuestions)
            ? change.missingInfoQuestions.length
            : 0;
          const validationIssueCount = Array.isArray(change.validationIssues)
            ? change.validationIssues.length
            : 0;
          const isActive = activeCaseId === change._id;
          return (
            <button
              key={change._id}
              type="button"
              onClick={() => setSelectedCaseId(change._id)}
              className={`block w-full text-left px-4 py-3 border-b border-foreground/[0.04] last:border-b-0 transition-colors ${
                isActive ? "bg-foreground/[0.035]" : "hover:bg-foreground/[0.02]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-foreground truncate">
                    {change.summary ?? "Policy change request"}
                  </p>
                  <p className="mt-1 text-label-sm text-muted-foreground line-clamp-2">
                    {change.requestText}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-foreground/8 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {change.status.replace("_", " ")}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{change.sourceKind.replace("_", " ")}</span>
                <span>{new Date(change.updatedAt).toLocaleDateString()}</span>
                <span>{missingInfoCount} questions</span>
                <span>{validationIssueCount} validation issues</span>
                {(change.evidenceSourceIds?.length ?? 0) > 0 && (
                  <span>{change.evidenceSourceIds!.length} evidence spans</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {detail === undefined ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-5 w-48 rounded" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : activeCase ? (
          <div className="divide-y divide-foreground/[0.06]">
            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-foreground">
                    {activeCase.summary ?? "Policy change request"}
                  </p>
                  <p className="mt-1 text-label-sm text-muted-foreground">
                    {activeCase.requestText}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={handleGeneratePacket}
                    disabled={packetLoading}
                  >
                    {packetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    Packet
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("submitted")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "submitted" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Submitted
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("accepted")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "accepted" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Accepted
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    size="compact"
                    onClick={() => handleStatus("declined")}
                    disabled={statusLoading !== null}
                  >
                    {statusLoading === "declined" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    Declined
                  </PillButton>
                </div>
              </div>
            </div>

            <div className="p-4 grid gap-4 xl:grid-cols-2">
              <section>
                <h3 className="text-label-sm font-medium text-foreground">Affected Values</h3>
                <div className="mt-2 space-y-2">
                  {items.length > 0 ? items.map((item, i) => (
                    <div key={String(item.id ?? i)} className="rounded-md border border-foreground/6 p-3">
                      <p className="text-label-sm font-medium text-foreground">
                        {String(item.label ?? item.fieldPath ?? "Change item")}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {String(item.action ?? "update")} · {String(item.kind ?? "general")}
                      </p>
                      <p className="mt-2 text-label-sm text-muted-foreground">
                        {String(item.beforeValue ?? "(not cited)")} → {String(item.requestedValue ?? item.afterValue ?? "(pending)")}
                      </p>
                      {Array.isArray(item.sourceSpanIds) && item.sourceSpanIds.length > 0 && (
                        <p className="mt-2 text-[11px] text-muted-foreground break-all">
                          evidence: {item.sourceSpanIds.join(", ")}
                        </p>
                      )}
                    </div>
                  )) : (
                    <p className="text-label-sm text-muted-foreground">No structured change items yet.</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-label-sm font-medium text-foreground">Validation</h3>
                <div className="mt-2 space-y-2">
                  {validationIssues.length > 0 ? validationIssues.map((issue, i) => (
                    <div key={`${String(issue.code ?? "issue")}-${i}`} className="rounded-md border border-foreground/6 p-3">
                      <p className="text-label-sm font-medium text-foreground">
                        {String(issue.code ?? "validation issue")}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {String(issue.severity ?? "warning")}
                      </p>
                      <p className="mt-2 text-label-sm text-muted-foreground">
                        {String(issue.message ?? "")}
                      </p>
                    </div>
                  )) : (
                    <p className="text-label-sm text-muted-foreground">No validation issues recorded.</p>
                  )}
                </div>
              </section>
            </div>

            <div className="p-4 grid gap-4 xl:grid-cols-2">
              <section>
                <h3 className="text-label-sm font-medium text-foreground">Packet Preview</h3>
                <div className="mt-2 space-y-2">
                  {artifacts.length > 0 ? artifacts.map((artifact, i) => (
                    <details key={`${String(artifact.kind ?? "artifact")}-${i}`} className="rounded-md border border-foreground/6 p-3">
                      <summary className="cursor-pointer text-label-sm font-medium text-foreground">
                        {String(artifact.title ?? artifact.kind ?? "Packet artifact")}
                      </summary>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
                        {String(artifact.content ?? "")}
                      </pre>
                    </details>
                  )) : (
                    <p className="text-label-sm text-muted-foreground">No generated packet yet.</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-label-sm font-medium text-foreground">Missing Info And Audit</h3>
                <div className="mt-2 space-y-3">
                  {missingInfo.length > 0 ? (
                    <div className="space-y-2">
                      {missingInfo.map((question, i) => (
                        <div key={String(question.id ?? i)} className="rounded-md border border-foreground/6 p-3">
                          <p className="text-label-sm text-foreground">
                            {String(question.question ?? "Missing information")}
                          </p>
                          {question.answer ? (
                            <p className="mt-2 text-label-sm text-muted-foreground">
                              {String(question.answer)}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-label-sm text-muted-foreground">No open missing-info questions.</p>
                  )}
                  <div className="space-y-2">
                    {(detail.messages ?? []).map((message) => (
                      <div key={message._id} className="text-[11px] text-muted-foreground">
                        {new Date(message.createdAt).toLocaleString()} · {message.direction} · {message.channel ?? "case"} · {message.content.slice(0, 140)}
                      </div>
                    ))}
                    {(detail.validationReports ?? []).map((report) => (
                      <div key={report._id} className="text-[11px] text-muted-foreground">
                        {new Date(report.createdAt).toLocaleString()} · validation {report.status}
                      </div>
                    ))}
                    {(detail.evidenceLinks ?? []).map((link) => (
                      <div key={link._id} className="text-[11px] text-muted-foreground break-all">
                        evidence · {link.itemId ?? "case"} · {link.sourceSpanId}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ViewPdfButton({ url }: { url?: string | null }) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;
  return (
    <PillButton
      variant="primary"
      size="compact"
      onClick={() => (isPdfOpen ? togglePdf() : openWithUrl(url))}
      className="hidden lg:inline-flex"
    >
      <Eye className="w-3.5 h-3.5" />
      {isPdfOpen ? "Hide PDF" : "View PDF"}
    </PillButton>
  );
}

export interface PolicyDetailBodyProps {
  id: string;
  /** Called whenever the breadcrumb label changes. Host renders it. */
  onBreadcrumb?: (node: ReactNode) => void;
  /** Called whenever the header actions change. Host renders them. */
  onActions?: (node: ReactNode) => void;
  /** Where to navigate after a policy is deleted. Default: /policies */
  afterDeleteHref?: string;
}

export function PolicyDetailBody({
  id,
  onBreadcrumb,
  onActions,
  afterDeleteHref = "/policies",
}: PolicyDetailBodyProps) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip",
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const cancelExtraction = useMutation(api.policies.cancelExtraction);
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const rechunk = useAction(api.actions.rechunkPolicy.rechunk);

  const [reExtracting, setReExtracting] = useState(false);
  const [rechunking, setRechunking] = useState(false);
  const [cancelingExtraction, setCancelingExtraction] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "details" | "activity" | "extraction" | "changes"
  >("details");

  const { openWithUrl, setFileUrl: preloadPdfUrl } = usePdf();
  const { setPageContext } = usePageContext();

  useEffect(() => {
    if (policy) {
      const types =
        policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
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
  const policyTypes: string[] =
    (p.policyTypes as string[] | undefined) ??
    [(p.policyType as string | undefined) ?? "other"];
  const documentType: string = (p.documentType as string | undefined) ?? "policy";
  const carrierName = (p.carrier as string | undefined) ?? "";
  const administratorName = (p.mga as string | undefined) ?? "";
  const displayName = administratorName || carrierName;
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isDeleted = !!p.deletedAt;
  const pipelineStatus = p.pipelineStatus as PipelineStatus | undefined;
  const canCancelExtraction =
    pipelineStatus === "running" || pipelineStatus === "paused";
  const policyDocument: Record<string, unknown> | undefined = p.document as
    | Record<string, unknown>
    | undefined;
  const limits: Record<string, unknown> | undefined = p.limits as
    | Record<string, unknown>
    | undefined;
  const deductibles: Record<string, unknown> | undefined = p.deductibles as
    | Record<string, unknown>
    | undefined;
  const extractionData: Record<string, unknown> = {
    ...(policyDocument ?? {}),
    coverages: p.coverages,
    premium: p.premium,
    totalCost: p.totalCost,
    minPremium: p.minPremium,
    depositPremium: p.depositPremium,
    taxesAndFees: p.taxesAndFees,
    premiumBreakdown: p.premiumBreakdown,
    limits,
    deductibles,
    declarations: p.declarations,
    formInventory: p.formInventory,
    supplementaryFacts: p.supplementaryFacts,
  };

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
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 ml-1.5">
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

  const handleReindex = async () => {
    if (!policy) return;
    setRechunking(true);
    try {
      const result = (await rechunk({ policyId: policy._id })) as Record<
        string,
        unknown
      >;
      if (result?.error) {
        toast.error(result.error as string);
        return;
      }
      toast.success(`Reindexed: ${result.newChunks} search chunks updated`);
      setShowRefreshDialog(false);
    } catch {
      toast.error("Reindexing failed");
    } finally {
      setRechunking(false);
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
        {!isDeleted && (
          <PillButton
            size="compact"
            variant="icon"
            label="Delete"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="w-4 h-4" />
          </PillButton>
        )}
        {!isDeleted && (
          <PillButton
            size="compact"
            variant="icon"
            label="Re-extract"
            disabled={reExtracting || rechunking || cancelingExtraction}
            onClick={() => setShowRefreshDialog(true)}
          >
            {reExtracting || rechunking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCw className="w-4 h-4" />
            )}
          </PillButton>
        )}
        <ViewPdfButton url={fileUrl} />
      </>,
    );
    return () => onActions(null);
  }, [
    onActions,
    policy,
    isDeleted,
    reExtracting,
    rechunking,
    cancelingExtraction,
    canCancelExtraction,
    handleCancelExtraction,
    fileUrl,
  ]);

  if (policy === undefined) {
    return (
      <>
        <Skeleton className="h-4 w-28 mb-4" />
        <div className="flex items-start justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-48 mb-2" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-foreground/6 bg-card px-4 py-3"
            >
              <Skeleton className="h-5 w-32 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (policy === null) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-2">Policy not found</p>
        <Link
          href={afterDeleteHref}
          className="text-primary hover:underline text-body-sm"
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
            <p className="text-body-sm text-red-700 dark:text-red-400 flex-1">
              This policy has been deleted.
            </p>
            <PillButton
              variant="secondary"
              size="compact"
              onClick={() => restorePolicy({ id: policy._id })}
            >
              Restore
            </PillButton>
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
        onOpenChange={(v) => !v && setShowRefreshDialog(false)}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Refresh full data</DialogTitle>
            <DialogDescription>
              Choose whether to rerun extraction from the original files or just
              rebuild the searchable chunks from the existing extracted data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-body-sm text-muted-foreground">
            <div className="rounded-lg border border-foreground/6 bg-foreground/[0.02] px-3 py-2.5">
              <p className="font-medium text-foreground">
                Re-extract from original files
              </p>
              <p className="mt-1">
                Rerun the extraction pipeline and regenerate the structured
                policy data.
              </p>
            </div>

            <div className="rounded-lg border border-foreground/6 bg-foreground/[0.02] px-3 py-2.5">
              <p className="font-medium text-foreground">Reindex existing data</p>
              <p className="mt-1">
                Rebuild search chunks without rerunning extraction.
              </p>
            </div>
          </div>

          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowRefreshDialog(false)}
              disabled={reExtracting || rechunking}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="secondary"
              onClick={handleReindex}
              disabled={
                policy.pipelineStatus !== "complete" ||
                reExtracting ||
                rechunking
              }
            >
              {rechunking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Reindex
            </PillButton>
            <PillButton
              onClick={handleReextractFromSource}
              disabled={reExtracting || rechunking}
            >
              {reExtracting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Re-extract
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {Boolean(p.isDemo) && !demoBannerDismissed && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 mb-4">
          <p className="text-label-sm text-amber-700 dark:text-amber-400 flex-1">
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
            className="text-amber-500 hover:text-amber-700 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as "details" | "activity" | "extraction" | "changes")
        }
        className="mb-6"
      >
        <TabsList variant="pill">
          {(
            [
              { id: "details" as const, label: "Summary" },
              { id: "extraction" as const, label: "Breakdown" },
              { id: "changes" as const, label: "Changes" },
              { id: "activity" as const, label: "Activity" },
            ] as const
          ).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === "details" && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          <PolicyExtractionBanner
            policyId={policy._id}
            status={p.pipelineStatus as PipelineStatus | undefined}
            error={p.pipelineError as string | undefined}
            log={p.pipelineLog as LogEntry[] | undefined}
            onCancel={canCancelExtraction ? handleCancelExtraction : undefined}
            cancelling={cancelingExtraction}
          />
          <PolicySummary
            policyNumber={policy.policyNumber}
            administrator={p.mga as string | undefined}
            carrier={
              (p.carrierLegalName as string | undefined) ||
              (p.security as string | undefined) ||
              policy.carrier
            }
            insuredName={policy.insuredName}
            effectiveDate={policy.effectiveDate}
            expirationDate={policy.expirationDate}
            premium={policy.premium}
            totalCost={p.totalCost as string | undefined}
            policyTypes={policyTypes}
            policyTermType={p.policyTermType as string | undefined}
            limits={limits}
            deductibles={deductibles}
            summary={policy.summary}
            isRenewal={policy.isRenewal}
            documentType={documentType}
            pdfUrl={fileUrl}
          />
        </FadeIn>
      )}

      {activeTab === "activity" && (
        <PolicyActivityTab policyId={id} policy={policy} />
      )}

      {activeTab === "changes" && (
        <PolicyChangesTab policyId={id} />
      )}

      {activeTab === "extraction" && (
        <ExtractionCards
          policyDocument={extractionData}
          initialPage={initialPage}
        />
      )}
    </>
  );
}
