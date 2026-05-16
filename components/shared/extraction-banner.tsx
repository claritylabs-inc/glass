"use client";

/**
 * Policy extraction banner — live pipeline status with retry buttons.
 */

import { StatusBanner, RetryButtons } from "@claritylabs/cl-pipelines/ui";
import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { Shimmer } from "@/components/ai-elements/shimmer";
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
          : "border-foreground/10 bg-foreground text-background",
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

      <div className="relative z-10 flex min-w-0 flex-1 items-baseline gap-2">
        <AnimatedStatusText
          value={isError ? errorLabel : runningLabel}
          className="shrink-0 text-sm font-medium"
          shimmer={!isError}
        />
        <AnimatedStatusText
          value={statusDetail}
          className="min-w-0 truncate text-sm opacity-75"
          shimmer={!isError}
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
    </StatusBanner>
  );
}

function AnimatedStatusText({
  value,
  className,
  shimmer,
}: {
  value: string;
  className: string;
  shimmer?: boolean;
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
          {shimmer ? (
            <Shimmer as="span" duration={1.6} spread={2.6} className="block truncate">
              {value}
            </Shimmer>
          ) : (
            value
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
