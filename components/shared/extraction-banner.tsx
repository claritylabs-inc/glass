"use client";

/**
 * Shared ExtractionBanner used across policy, org-document, and application surfaces.
 * Renders a live pipeline status banner with retry buttons.
 */

import { StatusBanner, ProgressLog, RetryButtons } from "@claritylabs/cl-pipelines/ui";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, AlertCircle } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// ─── Policy Extraction Banner ──────────────────────────────────────────────────

export function PolicyExtractionBanner({
  policyId,
  status,
  error,
  log,
}: {
  policyId: Id<"policies">;
  status: PipelineStatus | undefined;
  error?: string;
  log?: LogEntry[];
}) {
  const retry = useAction(api.actions.retryExtraction.retryExtraction);

  return (
    <ExtractionBannerBase
      status={status}
      error={error}
      log={log}
      onRetry={(mode) => void retry({ policyId, mode })}
    />
  );
}

// ─── Org Document Extraction Banner ───────────────────────────────────────────

export function OrgDocumentExtractionBanner({
  orgDocumentId,
  status,
  error,
  log,
}: {
  orgDocumentId: Id<"orgDocuments">;
  status: PipelineStatus | undefined;
  error?: string;
  log?: LogEntry[];
}) {
  const retry = useAction(
    (api as any).actions.orgDocumentExtraction.retryOrgDocumentExtraction,
  );

  return (
    <ExtractionBannerBase
      status={status}
      error={error}
      log={log}
      onRetry={(mode) => void retry({ orgDocumentId, mode })}
    />
  );
}

// ─── Base banner ───────────────────────────────────────────────────────────────

function ExtractionBannerBase({
  status,
  error,
  log,
  onRetry,
}: {
  status: PipelineStatus | undefined;
  error?: string;
  log?: LogEntry[];
  onRetry: (mode: "resume" | "full") => void;
}) {
  if (!status || status === "idle" || status === "complete") return null;

  return (
    <StatusBanner
      status={status}
      error={error}
      log={log}
      className="rounded-xl border border-border bg-card p-4 shadow-sm mb-4"
    >
      <div className="flex items-start gap-3">
        <StatusBanner.Indicator
          render={(s) =>
            s === "running" ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-0.5 shrink-0" />
            ) : s === "error" ? (
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            ) : null
          }
        />
        <div className="flex-1 min-w-0">
          <StatusBanner.Title className="text-sm font-medium" />
          <StatusBanner.Description className="text-xs text-muted-foreground mt-0.5" />
          <ProgressLog
            entries={log}
            latestOnly
            className="mt-2 list-none p-0 m-0"
            renderEntry={(entry, i) => (
              <li key={`${entry.timestamp}-${i}`} className="text-xs text-muted-foreground truncate">
                {entry.message}
              </li>
            )}
          />
        </div>
        <StatusBanner.Actions className="shrink-0">
          {status === "error" && (
            <RetryButtons
              onRetry={onRetry}
              className="flex gap-2"
              renderButton={(mode, onClick, label, disabled) => (
                <PillButton
                  key={mode}
                  type="button"
                  size="compact"
                  onClick={onClick}
                  disabled={disabled}
                  variant={mode === "full" ? "ghost" : "secondary"}
                >
                  {label}
                </PillButton>
              )}
            />
          )}
        </StatusBanner.Actions>
      </div>
    </StatusBanner>
  );
}
