"use client";

import { use, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import {
  Upload,
  Loader2,
  RefreshCw,
  Trash2,
  Eye,
  FileText,
} from "lucide-react";
import dayjs from "dayjs";
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

const EXTRACTION_STATUS_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  pending: {
    label: "Pending",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-400",
  },
  extracting: {
    label: "Extracting",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  },
  paused: {
    label: "Paused",
    color:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
  },
  complete: {
    label: "Complete",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  error: {
    label: "Error",
    color: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
  not_insurance: {
    label: "Not Insurance",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-400",
  },
};

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
  agent_referenced: { status: "info", title: "Referenced by Prism" },
};

// Actions that should have extraction log steps attached as subEntries
const EXTRACTION_ACTIONS = new Set([
  "extraction_started",
  "re_extraction",
  "extraction_complete",
  "extraction_error",
]);

function PolicyActivityTab({ policyId, policy }: { policyId: string; policy: any }) {
  const entries = useQuery(api.policyAuditLog.listByPolicy, {
    policyId: policyId as any,
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
    policy.extractionLog ?? [];
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

// ─── PolicyFilesTab ────────────────────────────────────────────────────────────

function PolicyFilesTab({ policyId, policy }: { policyId: string; policy: any }) {
  const policyFiles = useQuery(api.policyFiles.listByPolicy, {
    policyId: policyId as any,
  });
  const { openWithUrl } = usePdf();

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

  if (policyFiles === undefined) {
    return (
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
    );
  }

  if (policyFiles.length === 0) {
    // Fall back to the legacy single-file entry from the policy record
    const legacyFileId = (policy as any).fileId;
    return (
      <div className="rounded-lg border border-foreground/6 bg-card px-4 py-3 text-body-sm text-muted-foreground/60">
        {legacyFileId
          ? "This policy has a single attached file. Use the View PDF button in the header to open it."
          : "No files attached to this policy yet."}
      </div>
    );
  }

  return (
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
  );
}

// ─── ViewPdfButton ────────────────────────────────────────────────────────────

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

  const policy = useQuery(api.policies.get, { id: id as any });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip",
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const reExtract = useAction(api.actions.reExtractFromFile.reExtractFromFile);
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const rechunk = useAction(api.actions.rechunkPolicy.rechunk);

  const [reExtracting, setReExtracting] = useState(false);
  const [rechunking, setRechunking] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const policyTypes: string[] =
    (policy as any).policyTypes ?? [(policy as any).policyType ?? "other"];
  const documentType: string = (policy as any).documentType ?? "policy";
  const isDeleted = !!(policy as any).deletedAt;
  const policyDocument: any = (policy as any).document;
  const limits: any = (policy as any).limits;
  const deductibles: any = (policy as any).deductibles;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const result = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await result.json();
      await reExtract({ policyId: policy._id, fileId: storageId });
      toast.success("PDF uploaded, re-extracting...");
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

  const breadcrumbLabel = (
    <>
      {policy.carrier} {policy.policyNumber}
      {documentType === "quote" && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 ml-1.5">
          Quote
        </span>
      )}
    </>
  );

  const headerActions = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleUpload}
        className="hidden"
      />
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
      {policy.emailId && (
        <PillButton
          size="compact"
          variant="icon"
          label="Re-extract"
          disabled={reExtracting}
          onClick={async () => {
            setReExtracting(true);
            try {
              await retryExtraction({ policyId: id as any, mode: "full" });
            } finally {
              setReExtracting(false);
            }
          }}
        >
          <RefreshCw
            className={`w-4 h-4 ${reExtracting ? "animate-spin" : ""}`}
          />
        </PillButton>
      )}
      <PillButton
        size="compact"
        variant="icon"
        label="Upload"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
      </PillButton>
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
              <strong>{policy.policyNumber}</strong>? The policy can be restored
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

      {/* Demo data banner */}
      {(policy as any).isDemo && !demoBannerDismissed && (
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
              { id: "extraction" as const, label: "Extraction" },
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
              (policy as any).carrierLegalName ||
              (policy as any).security ||
              policy.carrier
            }
            insuredName={policy.insuredName}
            effectiveDate={policy.effectiveDate}
            expirationDate={policy.expirationDate}
            premium={policy.premium}
            totalCost={(policy as any).totalCost}
            policyTypes={policyTypes}
            policyTermType={(policy as any).policyTermType}
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
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <PillButton
              variant="secondary"
              size="compact"
              disabled={reExtracting || rechunking}
              onClick={async () => {
                setReExtracting(true);
                try {
                  await retryExtraction({ policyId: id as any, mode: "full" });
                  toast.success("Re-extraction started");
                } catch {
                  toast.error("Re-extraction failed");
                } finally {
                  setReExtracting(false);
                }
              }}
            >
              {reExtracting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Re-extract
            </PillButton>
            {policy.extractionStatus === "complete" && (
              <PillButton
                variant="secondary"
                size="compact"
                disabled={reExtracting || rechunking}
                onClick={async () => {
                  setRechunking(true);
                  try {
                    const result = (await rechunk({ policyId: policy._id })) as any;
                    if (result?.error) toast.error(result.error);
                    else toast.success(`Reindexed: ${result.newChunks} search chunks updated`);
                  } catch {
                    toast.error("Reindexing failed");
                  } finally {
                    setRechunking(false);
                  }
                }}
              >
                {rechunking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Reindex
              </PillButton>
            )}
          </div>
          {policyDocument && (
            <ExtractionCards
              policyDocument={policyDocument}
              initialPage={initialPage}
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
