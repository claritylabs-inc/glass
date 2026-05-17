"use client";

/**
 * Policy extraction banner — live pipeline status with retry buttons.
 */

import { StatusBanner, RetryButtons } from "@claritylabs/cl-pipelines/ui";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, AlertCircle, CircleStop } from "lucide-react";
import { useAction } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const STATUS_TEXT_TRANSITION = {
  duration: 0.28,
  ease: [0.33, 1, 0.68, 1],
} as const;

const PROGRESS_TRANSITION = {
  duration: 1.8,
  ease: "easeInOut",
  repeat: Number.POSITIVE_INFINITY,
  repeatDelay: 0.1,
} as const;

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
  const runningLabel = labels?.running ?? (status === "paused" ? "Paused" : "Extracting policy");
  const errorLabel = isNonInsuranceDocument
    ? "Not an insurance document"
    : labels?.error ?? "Extraction failed";
  const statusDetail = isError
    ? error ?? "Unknown error"
    : latestLog?.message ?? "Starting...";

  return (
    <StatusBanner
      status={status}
      error={error}
      log={log}
      className={[
        "relative mb-4 flex items-center gap-3 overflow-hidden rounded-xl border px-4 py-2.5 shadow-sm transition-colors duration-300",
        isError
          ? "border-destructive bg-destructive text-white"
          : "border-foreground/10 bg-foreground text-white",
      ].join(" ")}
    >
      {isError && (
        <StatusBanner.Indicator
          render={(s) =>
            s === "error" ? (
              <AlertCircle className="relative z-10 h-3.5 w-3.5 shrink-0" />
            ) : null
          }
        />
      )}

      {!isError && <BackgroundTaskSpinner />}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
        <AnimatedStatusText
          value={isError ? errorLabel : runningLabel}
          className="shrink-0 text-sm font-medium text-white"
        />
        <AnimatedStatusText
          value={statusDetail}
          className="min-w-0 truncate text-sm text-white/72"
        />
      </div>

      {!isError && onCancel && (
        <StatusBanner.Actions className="relative z-10 shrink-0">
          <PillButton
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            variant="secondary"
            size="compact"
            className="justify-center border-background/35! text-background! hover:border-background/60! hover:text-background! [&_span]:whitespace-nowrap"
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
        <StatusBanner.Actions className="relative z-10 shrink-0">
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
                className="border-white/30! bg-transparent! text-white! hover:border-white/50! hover:bg-white/10! hover:text-white!"
              >
                {label}
              </PillButton>
            )}
          />
        </StatusBanner.Actions>
      )}

      {!isError && <IndeterminateProgress />}
    </StatusBanner>
  );
}

function AnimatedStatusText({
  value,
  className,
}: {
  value: string;
  className: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <span className={className}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={value}
          className="block truncate"
          initial={reduceMotion ? false : { y: 3, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: -3, opacity: 0 }}
          transition={STATUS_TEXT_TRANSITION}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function BackgroundTaskSpinner() {
  return (
    <Loader2
      aria-hidden="true"
      className="relative z-10 h-3.5 w-3.5 shrink-0 animate-spin text-white/72"
    />
  );
}

function IndeterminateProgress() {
  const reduceMotion = useReducedMotion();

  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-white/12"
    >
      <motion.span
        className="block h-full w-1/3 rounded-full bg-white/70"
        initial={reduceMotion ? false : { x: "-120%" }}
        animate={reduceMotion ? { x: "0%" } : { x: "320%" }}
        transition={reduceMotion ? undefined : PROGRESS_TRANSITION}
      />
    </span>
  );
}
