"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/fade-in";
import { Loader2, RotateCw, Trash2, Eye, X } from "lucide-react";
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

  const isLive = (policy as any).pipelineStatus === "running";

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
    (policy as any).pipelineLog,
  )
    ? ((policy as any).pipelineLog as { timestamp: number; message: string }[])
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
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const rechunk = useAction(api.actions.rechunkPolicy.rechunk);

  const [reExtracting, setReExtracting] = useState(false);
  const [rechunking, setRechunking] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "details" | "activity" | "extraction"
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
        summary: `${(policy as any).mga ?? policy.carrier ?? "Unknown"} ${policy.policyNumber ?? ""} — ${types.join(", ")}`,
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
  const policyDocument: Record<string, unknown> | undefined = p.document as
    | Record<string, unknown>
    | undefined;
  const limits: Record<string, unknown> | undefined = p.limits as
    | Record<string, unknown>
    | undefined;
  const deductibles: Record<string, unknown> | undefined = p.deductibles as
    | Record<string, unknown>
    | undefined;

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
            disabled={reExtracting || rechunking}
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
  }, [onActions, policy, isDeleted, reExtracting, rechunking, fileUrl]);

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
                (policy as any).pipelineStatus !== "complete" ||
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
          setActiveTab(value as "details" | "activity" | "extraction")
        }
        className="mb-6"
      >
        <TabsList variant="pill">
          {(
            [
              { id: "details" as const, label: "Summary" },
              { id: "extraction" as const, label: "Breakdown" },
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

      {activeTab === "extraction" &&
        policyDocument && (
          <ExtractionCards
            policyDocument={policyDocument}
            initialPage={initialPage}
          />
        )}
    </>
  );
}
