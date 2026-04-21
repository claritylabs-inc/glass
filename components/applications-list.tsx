"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, X, AlertCircle, RotateCcw } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { DocumentUploadEmptyState } from "@/components/document-upload-empty-state";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { Id } from "@/convex/_generated/dataModel";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

function ApplicationsListSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-1 border-b border-foreground/6 mb-4 pb-1">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-14 hidden sm:block" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  extracting_fields: { label: "Extracting", color: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" },
  filling_known: { label: "Auto-filling", color: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" },
  asking_questions: { label: "Asking Questions", color: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" },
  pending_confirmation: { label: "Pending Confirmation", color: "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400" },
  confirmed: { label: "Confirmed", color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  complete: { label: "Complete", color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400" },
};

type AppTab = "active" | "cancelled";

interface SessionItem {
  _id: Id<"applicationSessions">;
  _creationTime: number;
  status: string;
  applicationTitle?: string;
  sourceFileName: string;
  error?: string;
}

type StartFromUploadResult = {
  success?: true;
  sessionId?: string;
  error?: string;
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-500" };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${config.color}`}
    >
      {config.label}
    </span>
  );
}


function SessionList({
  sessions,
  onCancel,
  onRetry,
  onShowError,
  emptyMessage,
}: {
  sessions: SessionItem[];
  onCancel: (id: Id<"applicationSessions">) => void;
  onRetry: (id: Id<"applicationSessions">) => void;
  onShowError: (session: SessionItem) => void;
  emptyMessage: string;
}) {
  const router = useRouter();

  if (sessions.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-body-sm text-muted-foreground/50">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      {sessions.map((session) => {
        const isActive = !["complete", "cancelled"].includes(session.status);
        return (
          <div
            key={session._id}
            className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors cursor-pointer"
            onClick={() => router.push(`/applications/${session._id}`)}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-body-sm font-medium text-foreground truncate">
                  {session.applicationTitle ?? session.sourceFileName}
                </p>
                {session.error ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowError(session);
                    }}
                    className="flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
                      <AlertCircle className="w-3 h-3" />
                      Error
                    </span>
                  </button>
                ) : (
                  <StatusBadge status={session.status} />
                )}
              </div>
              <p className="text-label-sm text-muted-foreground/60 mt-0.5 truncate">
                {session.sourceFileName}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <span className="text-label-sm text-muted-foreground/40 hidden sm:block">
                {dayjs(session._creationTime).fromNow()}
              </span>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {session.error && (
                  <PillButton
                    variant="ghost"
                    onClick={() => onRetry(session._id)}
                    className="text-muted-foreground/40 hover:text-foreground"
                    label="Retry"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </PillButton>
                )}
                {isActive && (
                  <PillButton
                    variant="ghost"
                    onClick={() => onCancel(session._id)}
                    className="text-muted-foreground/40 hover:text-red-500"
                    label="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </PillButton>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ApplicationsList() {
  const sessions = useQuery(api.applicationSessions.list);
  const cancelSession = useMutation(api.applicationSessions.cancel);
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const retryApp = useAction(api.actions.processApplication.retryApplication);
  const startFromUploadRef = (api.actions.processApplication as Record<string, unknown>).startFromUpload as FunctionReference<
    "action",
    "public",
    { fileId: Id<"_storage">; fileName: string },
    StartFromUploadResult
  >;
  const startFromUpload = useAction(startFromUploadRef);
  const [errorSession, setErrorSession] = useState<{ id: Id<"applicationSessions">; title: string; error: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>("active");
  const router = useRouter();

  const activeSessions = useMemo(
    () => (sessions?.filter((s) => s.status !== "cancelled") ?? []) as SessionItem[],
    [sessions],
  );
  const cancelledSessions = useMemo(
    () => (sessions?.filter((s) => s.status === "cancelled") ?? []) as SessionItem[],
    [sessions],
  );

  const displayedSessions = activeTab === "active" ? activeSessions : cancelledSessions;

  async function handleCancel(id: Id<"applicationSessions">) {
    try {
      await cancelSession({ id });
      toast.success("Application cancelled");
    } catch {
      toast.error("Failed to cancel");
    }
  }

  async function handleRetry(sessionId: Id<"applicationSessions">) {
    setRetrying(true);
    try {
      const result = await retryApp({ sessionId });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("Retrying application processing...");
        setErrorSession(null);
      }
    } catch {
      toast.error("Failed to retry");
    } finally {
      setRetrying(false);
    }
  }

  const handleApplicationUpload = useCallback(async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF application form.");
      return;
    }

    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Failed to upload file");
      const { storageId } = await uploadRes.json();
      const result = await startFromUpload({ fileId: storageId, fileName: file.name });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Application uploaded. Processing started.");
      if (result.sessionId) {
        router.push(`/applications/${result.sessionId}`);
      }
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [generateUploadUrl, router, startFromUpload]);

  if (sessions === undefined) {
    return <ApplicationsListSkeleton />;
  }

  if (sessions.length === 0) {
    return <DocumentUploadEmptyState kind="application" uploading={uploading} onUpload={handleApplicationUpload} />;
  }

  const tabs: { id: AppTab; label: string; count: number }[] = [
    { id: "active", label: "Active", count: activeSessions.length },
    { id: "cancelled", label: "Cancelled", count: cancelledSessions.length },
  ];

  return (
    <>
      <div className="flex items-center gap-1 border-b border-foreground/6 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 text-[11px] ${
                activeTab === tab.id ? "text-muted-foreground/60" : "text-muted-foreground/30"
              }`}>
                {tab.count}
              </span>
            )}
            {activeTab === tab.id && (
              <motion.div
                layoutId="app-tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        <SessionList
          sessions={displayedSessions}
          onCancel={handleCancel}
          onRetry={handleRetry}
          emptyMessage={activeTab === "active" ? "No active applications" : "No cancelled applications"}
          onShowError={(session) =>
            setErrorSession({
              id: session._id,
              title: session.applicationTitle ?? session.sourceFileName,
              error: session.error ?? "",
            })
          }
        />

        {/* Error detail dialog */}
        <Dialog open={!!errorSession} onOpenChange={(v) => !v && setErrorSession(null)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                Application Error
              </DialogTitle>
              <DialogDescription>
                {errorSession?.title ?? "Application"} failed to process.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg bg-red-50/50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 p-3 max-h-48 overflow-y-auto">
              <p className="text-label-sm text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all">
                {errorSession?.error}
              </p>
            </div>
            <DialogFooter>
              <PillButton variant="secondary" onClick={() => setErrorSession(null)}>
                Close
              </PillButton>
              <PillButton
                onClick={() => errorSession && handleRetry(errorSession.id)}
                disabled={retrying}
              >
                {retrying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Retry
                  </>
                )}
              </PillButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
