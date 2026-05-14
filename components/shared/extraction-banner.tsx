"use client";

/**
 * Policy extraction banner — live pipeline status with retry buttons.
 */

import { StatusBanner, RetryButtons } from "@claritylabs/cl-pipelines/ui";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, AlertCircle, CircleStop } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function PolicyExtractionBanner({
  policyId,
  status,
  error,
  log,
  onCancel,
  cancelling,
}: {
  policyId: Id<"policies">;
  status: PipelineStatus | undefined;
  error?: string;
  log?: LogEntry[];
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const retry = useAction(api.actions.retryExtraction.retryExtraction);

  return (
    <ExtractionBannerBase
      status={status}
      error={error}
      log={log}
      onRetry={(mode) => void retry({ policyId, mode })}
      onCancel={onCancel}
      cancelling={cancelling}
    />
  );
}

function ExtractionBannerBase({
  status,
  error,
  log,
  labels,
  onRetry,
  onCancel,
  cancelling,
}: {
  status: PipelineStatus | undefined;
  error?: string;
  log?: LogEntry[];
  labels?: { running?: string; error?: string };
  onRetry: (mode: "resume" | "full") => void;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  if (!status || status === "idle" || status === "complete") return null;

  const isError = status === "error";
  const isNonInsuranceDocument = isError && error?.startsWith("This document is not an insurance policy or quote");
  const latestLog = log && log.length > 0 ? log[log.length - 1] : undefined;
  const runningLabel = labels?.running ?? "Extracting";
  const errorLabel = isNonInsuranceDocument
    ? "Not an insurance document"
    : labels?.error ?? "Extraction failed";

  return (
    <StatusBanner
      status={status}
      error={error}
      log={log}
      className={[
        "mb-4 flex items-center gap-3 rounded-xl border px-4 py-2.5",
        isError
          ? "border-destructive bg-destructive text-white"
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

      {!isError && onCancel && (
        <StatusBanner.Actions className="shrink-0">
          <PillButton
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            variant="secondary"
            size="compact"
            className="justify-center !border-background/35 !text-background hover:!border-background/60 hover:!text-background [&_span]:whitespace-nowrap"
          >
            {cancelling ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <CircleStop className="h-3 w-3 shrink-0" />
            )}
            {cancelling ? "Cancelling" : "Cancel"}
          </PillButton>
        </StatusBanner.Actions>
      )}

      {isError && !isNonInsuranceDocument && (
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
                variant="secondary"
                className="!border-white/30 !bg-transparent !text-white hover:!border-white/50 hover:!bg-white/10 hover:!text-white"
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
