"use client";

import { use, useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { FileDropZone } from "@/components/ui/file-drop";
import {
  Loader2,
  RotateCw,
  Trash2,
  Eye,
  FileText,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { StructuredLog, type StructuredLogEntry } from "@/components/structured-log";
import { useRouter, useSearchParams } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
import { X } from "lucide-react";

import { PolicySummary } from "./policy-summary";
import { ExtractionCards } from "./extraction-panel";


// ─── Activity tab ─────────────────────────────────────────────────────────────

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

// Actions that should have extraction log steps attached as subEntries
const EXTRACTION_ACTIONS = new Set([
  "extraction_started",
  "re_extraction",
  "extraction_complete",
  "extraction_error",
]);

function PolicyActivityTab({ policyId, policy }: { policyId: string; policy: Record<string, unknown> }) {
  const entries = useQuery(api.policyAuditLog.listByPolicy, {
    policyId: policyId as Id<"policies">,
  });

  const isLive = policy.extractionStatus === "extracting";

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

  // Build audit log entries sorted oldest-first
  const auditEntries = [...entries]
    .sort((a, b) => a._creationTime - b._creationTime)
    .map((entry) => {
      const cfg = AUDIT_ACTION_CONFIG[entry.action] ?? {
        status: "info" as const,
        title: entry.action,
      };
      return {
        ...entry,
        _cfg: cfg,
      };
    });

  // Build extraction sub-entries from the raw extraction log
  const rawLog: { timestamp: number; message: string }[] =
    Array.isArray(policy.extractionLog)
      ? (policy.extractionLog as { timestamp: number; message: string }[])
      : [];
  const extractionSubEntries: StructuredLogEntry["subEntries"] = rawLog.map(
    (entry) => ({
      timestamp: entry.timestamp,
      message: entry.message,
      status: classifyExtractionMessage(entry.message),
    }),
  );

  // Find the last extraction-related audit event to attach sub-entries to
  const lastExtractionIdx = auditEntries.findLastIndex((e) =>
    EXTRACTION_ACTIONS.has(e.action),
  );

  // Build final log entries, attaching extraction sub-entries to the right event
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

// ─── File type badge config ────────────────────────────────────────────────────

const FILE_TYPE_LABELS: Record<string, string> = {
  declaration: "Declaration",
  wording: "Wording",
  endorsement: "Endorsement",
  schedule: "Schedule",
  renewal: "Renewal",
  certificate: "Certificate",
  unknown: "Other",
};

const FILE_TYPE_COLORS: Record<string, string> = {
  declaration: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  wording: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
  endorsement: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  schedule: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400",
  renewal: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  certificate: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  unknown: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

const EXTRACTION_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: {
    label: "Pending",
    color: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
  },
  extracting: {
    label: "Extracting",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  },
  complete: {
    label: "Complete",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    color: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
};

// ─── PolicyFilesTab ────────────────────────────────────────────────────────────

function PolicyFilesTab({ policyId, policy }: { policyId: string; policy: any }) {
  const policyFiles = useQuery(api.policyFiles.listByPolicy, {
    policyId: policyId as any,
  });
  const { openWithUrl } = usePdf();
  const legacyFileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip",
  );

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const addFileToPolicy = useAction(api.actions.addFileToPolicy.addFileToPolicy);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        toast.error("Please upload a PDF file.");
        return;
      }
      setUploading(true);
      try {
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!res.ok) throw new Error("Upload failed");
        const { storageId } = await res.json();
        const result = await addFileToPolicy({
          policyId: policyId as Id<"policies">,
          fileId: storageId,
          fileName: file.name,
        });
        if ((result as Record<string, unknown>)?.error) {
          toast.error((result as Record<string, unknown>).error as string);
        } else {
          toast.success(`${file.name} added to policy`);
        }
      } catch {
        toast.error("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [addFileToPolicy, generateUploadUrl, policyId],
  );

  // Build file URL queries — we query up to the first 8 files individually
  const file0Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[0]?.fileId ? { fileId: policyFiles[0].fileId as Id<"_storage"> } : "skip",
  );
  const file1Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[1]?.fileId ? { fileId: policyFiles[1].fileId as Id<"_storage"> } : "skip",
  );
  const file2Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[2]?.fileId ? { fileId: policyFiles[2].fileId as Id<"_storage"> } : "skip",
  );
  const file3Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[3]?.fileId ? { fileId: policyFiles[3].fileId as Id<"_storage"> } : "skip",
  );
  const file4Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[4]?.fileId ? { fileId: policyFiles[4].fileId as Id<"_storage"> } : "skip",
  );
  const file5Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[5]?.fileId ? { fileId: policyFiles[5].fileId as Id<"_storage"> } : "skip",
  );
  const file6Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[6]?.fileId ? { fileId: policyFiles[6].fileId as Id<"_storage"> } : "skip",
  );
  const file7Url = useQuery(
    api.policies.getFileUrl,
    policyFiles?.[7]?.fileId ? { fileId: policyFiles[7].fileId as Id<"_storage"> } : "skip",
  );

  const urlsByIndex = [file0Url, file1Url, file2Url, file3Url, file4Url, file5Url, file6Url, file7Url];

  const uploadCard = (
    <div className="rounded-lg border border-foreground/6 bg-card p-4">
      <div className="mb-3">
        <p className="text-body-sm font-medium text-foreground">Add supplemental files</p>
        <p className="text-label-sm text-muted-foreground mt-1">
          Upload additional pages, endorsements, schedules, or sections of this policy.
        </p>
      </div>
      <FileDropZone
        disabled={uploading}
        onFile={handleUpload}
        idleLabel="Drag and drop a PDF"
        activeLabel="Drop PDF to upload"
        busyLabel="Uploading..."
      />
    </div>
  );

  if (policyFiles === undefined) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-foreground/[0.04] last:border-0 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-36 bg-foreground/5 rounded animate-pulse" />
                <div className="h-5 w-20 bg-foreground/5 rounded-full animate-pulse" />
              </div>
              <div className="h-5 w-16 bg-foreground/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
        {uploadCard}
      </div>
    );
  }

  if (policyFiles.length === 0) {
    // Fall back to the legacy single-file entry from the policy record
    const legacyFileId = (policy as any).fileId;
    const legacyFileName = (policy as any).fileName ?? "Attached file";
    return (
      <div className="space-y-4">
        {legacyFileId ? (
          <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                <p className="text-body-sm text-foreground truncate">{legacyFileName}</p>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-label-sm font-medium shrink-0 ${FILE_TYPE_COLORS.unknown}`}>
                  {FILE_TYPE_LABELS.unknown}
                </span>
              </div>
              {legacyFileUrl && (
                <PillButton
                  variant="secondary"
                  size="compact"
                  onClick={() => openWithUrl(legacyFileUrl)}
                >
                  View
                </PillButton>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-foreground/6 bg-card px-4 py-3 text-body-sm text-muted-foreground/60">
            No files attached to this policy yet.
          </div>
        )}
        {uploadCard}
      </div>
    );
  }

  return (
    <div className="space-y-4">
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
      {policyFiles.map((file, i) => {
        const url = urlsByIndex[i];
        const typeLabel = FILE_TYPE_LABELS[file.fileType] ?? file.fileType;
        const typeColor = FILE_TYPE_COLORS[file.fileType] ?? FILE_TYPE_COLORS.unknown;
        const statusCfg = EXTRACTION_STATUS_CONFIG[file.extractionStatus] ?? EXTRACTION_STATUS_CONFIG.pending;

        return (
          <div
            key={file._id}
            className="flex items-center justify-between gap-3 px-4 py-3 border-b border-foreground/[0.04] last:border-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
              <p className="text-body-sm text-foreground truncate">{file.fileName}</p>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-label-sm font-medium shrink-0 ${typeColor}`}>
                {typeLabel}
              </span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-label-sm font-medium shrink-0 ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
            </div>
            {url && (
              <PillButton
                variant="secondary"
                size="compact"
                onClick={() => openWithUrl(url)}
              >
                View
              </PillButton>
            )}
          </div>
        );
      })}
    </div>
      {uploadCard}
    </div>
  );
}

// ─── ViewPdfButton────────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

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
    "details" | "files" | "activity" | "extraction"
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
        summary: `${policy.carrier ?? "Unknown"} ${policy.policyNumber ?? ""} — ${types.join(", ")}`,
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

  // ── Loading / not-found states ──────────────────────────────────────────────

  if (policy === undefined) {
    return (
      <AppShell>
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
      </AppShell>
    );
  }

  if (policy === null) {
    return (
      <AppShell>
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">Policy not found</p>
          <Link
            href="/policies"
            className="text-primary hover:underline text-body-sm"
          >
            Back to policies
          </Link>
        </div>
      </AppShell>
    );
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  const p = policy as unknown as Record<string, unknown>;
  const policyTypes: string[] =
    (p.policyTypes as string[] | undefined) ?? [(p.policyType as string | undefined) ?? "other"];
  const documentType: string = (p.documentType as string | undefined) ?? "policy";
  const carrierName = (p.carrier as string | undefined) ?? "";
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isDeleted = !!(p.deletedAt);
  const policyDocument: Record<string, unknown> | undefined = p.document as Record<string, unknown> | undefined;
  const limits: Record<string, unknown> | undefined = p.limits as Record<string, unknown> | undefined;
  const deductibles: Record<string, unknown> | undefined = p.deductibles as Record<string, unknown> | undefined;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await softDelete({ id: policy._id });
      setShowDeleteDialog(false);
      toast.success("Policy deleted");
      router.push("/policies");
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
    setRechunking(true);
    try {
      const result = await rechunk({ policyId: policy._id }) as Record<string, unknown>;
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

  const breadcrumbLabel = (
    <>
      {carrierName} {policyNumber}
      {documentType === "quote" && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 ml-1.5">
          Quote
        </span>
      )}
    </>
  );

  const headerActions = (
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
    </>
  );

  return (
    <AppShell breadcrumbDetail={breadcrumbLabel} actions={headerActions}>
      <FadeIn when={true} staggerIndex={0} duration={0.6}>
        {isDeleted && (
          <div className="flex items-center gap-3 mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5">
            <p className="text-body-sm text-red-700 dark:text-red-400 flex-1">
              This policy has been deleted.
            </p>
            <Button
              variant="outline"
              onClick={() => restorePolicy({ id: policy._id })}
              className="text-label-sm"
            >
              Restore
            </Button>
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
              Are you sure you want to delete{" "}
              <strong>{policyNumber}</strong>? The policy can be restored
              later.
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
              <p className="font-medium text-foreground">Re-extract from original files</p>
              <p className="mt-1">
                Rerun the extraction pipeline and regenerate the structured policy data.
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
              disabled={policy.extractionStatus !== "complete" || reExtracting || rechunking}
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

      {/* Demo data banner */}
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

      {/* Tab bar */}
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as "details" | "files" | "activity" | "extraction")
        }
        className="mb-6"
      >
        <TabsList variant="pill">
          {(
            [
              { id: "details" as const, label: "Details" },
              { id: "files" as const, label: "Files" },
              { id: "activity" as const, label: "Activity" },
              { id: "extraction" as const, label: "Full Data" },
            ] as const
          ).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ── Details tab ── */}
      {activeTab === "details" && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          {/* 1. Summary card — always visible, scannable */}
          <PolicySummary
            policyNumber={policy.policyNumber}
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

      {activeTab === "files" && (
        <PolicyFilesTab policyId={id} policy={policy} />
      )}

      {activeTab === "activity" && (
        <PolicyActivityTab policyId={id} policy={policy} />
      )}

      {activeTab === "extraction" && (
        policyDocument && (
          <ExtractionCards
            policyDocument={policyDocument}
            initialPage={initialPage}
          />
        )
      )}
    </AppShell>
  );
}
