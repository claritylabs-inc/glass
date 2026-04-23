"use client";

import { Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { toast } from "sonner";

interface ScanProgress {
  phase: string;
  totalEmails?: number;
  processedEmails?: number;
  insuranceFound?: number;
  extracting?: number;
  extracted?: number;
}

interface ScanStatusProps {
  connectionId?: string;
  status?: "scanning" | "success" | "error" | "disconnected" | null;
  /** cl-pipelines status — used to surface retry buttons */
  pipelineStatus?: string | null;
  error?: string | null;
  progress?: ScanProgress | null;
}

export function ScanStatus({ connectionId, status, pipelineStatus, error, progress }: ScanStatusProps) {
  const [retrying, setRetrying] = useState(false);
  const retryEmailScan = useAction(api.actions.emailScanPipeline.retryEmailScan);

  async function handleRetry(mode: "resume" | "full") {
    if (!connectionId) return;
    setRetrying(true);
    try {
      await retryEmailScan({ connectionId: connectionId as Id<"emailConnections">, mode });
      toast.success("Scan restarted");
    } catch {
      toast.error("Failed to restart scan");
    } finally {
      setRetrying(false);
    }
  }

  // Show progress-based status when actively scanning
  if (progress && progress.phase !== "complete") {
    const { phase, totalEmails, processedEmails, extracting, extracted } = progress;

    let label = "Scanning...";
    if (phase === "fetching") {
      label = totalEmails != null
        ? `Fetching ${totalEmails} emails...`
        : "Fetching emails...";
    } else if (phase === "classifying") {
      label = processedEmails != null && totalEmails
        ? `Classifying ${processedEmails}/${totalEmails} emails...`
        : "Classifying emails...";
    } else if (phase === "extracting") {
      label = extracting != null
        ? `Extracting ${extracted ?? 0}/${extracting} policies...`
        : "Extracting policies...";
    }

    return (
      <div className="flex items-center gap-2 text-label-sm">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        <span className="text-primary font-medium">{label}</span>
      </div>
    );
  }

  // Pipeline error — show retry buttons
  if (pipelineStatus === "error" && connectionId) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-label-sm">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <span className="text-destructive font-medium">{error || "Scan failed"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={retrying}
            onClick={() => handleRetry("resume")}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-foreground/12 text-xs text-muted-foreground hover:bg-foreground/[0.03] disabled:opacity-50"
          >
            {retrying && <Loader2 className="w-3 h-3 animate-spin" />}
            <RefreshCw className="w-3 h-3" />
            Retry (Resume)
          </button>
          <button
            type="button"
            disabled={retrying}
            onClick={() => handleRetry("full")}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-foreground/12 text-xs text-muted-foreground hover:bg-foreground/[0.03] disabled:opacity-50"
          >
            {retrying && <Loader2 className="w-3 h-3 animate-spin" />}
            Retry (Full)
          </button>
        </div>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="flex items-center gap-2 text-label-sm">
      {status === "scanning" && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          <span className="text-primary font-medium">Scanning inbox...</span>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          <span className="text-success font-medium">Scan complete</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-destructive" />
          <span className="text-destructive font-medium">
            {error || "Scan failed"}
          </span>
          {connectionId && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => handleRetry("full")}
              className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-foreground/12 text-xs text-muted-foreground hover:bg-foreground/[0.03] disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          )}
        </>
      )}
      {status === "disconnected" && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            Disconnected — reconnect required
          </span>
        </>
      )}
    </div>
  );
}
