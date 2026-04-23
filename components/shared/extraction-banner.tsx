"use client";

/**
 * Policy extraction banner — live pipeline status with retry buttons.
 */

import { StatusBanner, RetryButtons } from "@claritylabs/cl-pipelines/ui";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, AlertCircle } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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

function ExtractionBannerBase({
  status,
  error,
  log,
  labels,
  onRetry,
}: {
  status: PipelineStatus | undefined;
  error?: string;
  log?: LogEntry[];
  labels?: { running?: string; error?: string };
  onRetry: (mode: "resume" | "full") => void;
}) {
  if (!status || status === "idle" || status === "complete") return null;

  const isError = status === "error";
  const latestLog = log && log.length > 0 ? log[log.length - 1] : undefined;
  const runningLabel = labels?.running ?? "Extracting";
  const errorLabel = labels?.error ?? "Extraction failed";

  return (
    <StatusBanner
      status={status}
      error={error}
      log={log}
      className={[
        "mb-4 flex items-center gap-3 rounded-xl border px-4 py-2.5",
        isError
          ? "border-destructive bg-destructive text-destructive-foreground"
          : "border-border bg-foreground text-background",
      ].join(" ")}
    >
      <StatusBanner.Indicator
        render={(s) =>
          s === "running" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-80" />
          ) : s === "error" ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          ) : null
        }
      />

      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 text-sm font-medium">
          {isError ? errorLabel : runningLabel}
        </span>
        <span className="truncate text-sm opacity-75">
          {isError
            ? error ?? "Unknown error"
            : latestLog?.message ?? "Starting…"}
        </span>
      </div>

      {isError && (
        <StatusBanner.Actions className="shrink-0">
          <RetryButtons
            onRetry={onRetry}
            className="flex gap-1.5"
            labels={{ resume: "Resume", full: "Restart" }}
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
        </StatusBanner.Actions>
      )}
    </StatusBanner>
  );
}
