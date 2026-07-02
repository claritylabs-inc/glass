"use client";

/** Policy extraction status controller for Sonner toasts. */

import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { useAction } from "convex/react";
import { CircleAlert, CircleCheck } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  PillButton,
  type PillButtonVariant,
} from "@/components/ui/pill-button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type RetryMode = "resume" | "full";
type ExtractionToastTone = "loading" | "success" | "error";
const EXTRACTION_TOAST_COLLAPSE_DELAY_MS = 3_500;

type ExtractionToastAction = {
  label: string;
  onClick: () => void;
  variant?: PillButtonVariant;
  disabled?: boolean;
  icon?: ReactNode;
};

type ToastPolicy = {
  _id: string;
  documentType?: string | null;
  fileName?: string | null;
  carrier?: string | null;
  policyNumber?: string | null;
  pipelineStatus?: string | null;
  pipelineError?: string | null;
  extractionDataStage?: string | null;
  extractionPreviewError?: string | null;
};

export function policyExtractionToastId(policyId: string) {
  return `policy-extraction:${policyId}`;
}

function documentLabel() {
  return "policy";
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanDisplayText(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || /^extracting/i.test(trimmed)) return undefined;
  return trimmed;
}

function latestLogMessage(log?: LogEntry[]) {
  if (!log?.length) return undefined;
  const message = log[log.length - 1]?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : undefined;
}

function isActiveStatus(status?: string | null) {
  return status === "running" || status === "paused";
}

function isErrorStatus(status?: string | null) {
  return status === "error";
}

function isFinalStatus(status?: string | null, stage?: string | null) {
  return status === "complete" || stage === "final";
}

function isPreviewStatus(status?: string | null, stage?: string | null) {
  return stage === "preview" && status !== "complete";
}

function isNonInsuranceDocument(error?: string | null) {
  return error?.startsWith("This document is not a bound insurance policy");
}

function ExtractionToastIcon({ tone }: { tone: ExtractionToastTone }) {
  if (tone === "loading") {
    return <Spinner className="size-4 text-muted-foreground" />;
  }

  if (tone === "error") {
    return <CircleAlert className="size-4 text-destructive" />;
  }

  return <CircleCheck className="size-4 text-muted-foreground" />;
}

function ExtractionToastActionButton({
  action,
  className,
}: {
  action: ExtractionToastAction;
  className?: string;
}) {
  return (
    <PillButton
      size="compact"
      variant={action.variant ?? "secondary"}
      disabled={action.disabled}
      onClick={action.onClick}
      className={className}
    >
      {action.icon}
      {action.label}
    </PillButton>
  );
}

function ExtractionStatusToast({
  title,
  description,
  tone,
  actions = [],
  collapsible = false,
}: {
  title: string;
  description?: string;
  tone: ExtractionToastTone;
  actions?: ExtractionToastAction[];
  collapsible?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const isCompact = collapsible && isCollapsed && !isInteracting;

  useEffect(() => {
    if (!collapsible) return;

    const collapseTimer = window.setTimeout(
      () => setIsCollapsed(true),
      EXTRACTION_TOAST_COLLAPSE_DELAY_MS,
    );

    return () => window.clearTimeout(collapseTimer);
  }, [collapsible, description, title]);

  const statusContent = (
    <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-3">
      <div
        className={cn(
          "flex h-5 items-center justify-center",
          tone === "loading" ? "pt-0.5" : "pt-px",
        )}
      >
        <ExtractionToastIcon tone={tone} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-base font-medium leading-5 text-foreground">
          {title}
        </p>
        {description && !isCompact ? (
          <p className="mt-1 text-label leading-4 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden px-4 outline-none transition-[gap,padding] duration-150 ease-out",
        isCompact ? "gap-0 py-2.5" : "gap-3 py-3.5",
      )}
      tabIndex={collapsible ? 0 : undefined}
      aria-label={isCompact && description ? `${title}. ${description}` : title}
      onMouseEnter={() => setIsInteracting(true)}
      onMouseLeave={() => setIsInteracting(false)}
      onFocus={() => setIsInteracting(true)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsInteracting(false);
        }
      }}
    >
      {statusContent}

      {actions.length && !isCompact ? (
        <div className="flex flex-wrap gap-2 pl-7">
          {actions.map((action) => (
            <ExtractionToastActionButton key={action.label} action={action} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function showExtractionStatusToast({
  id,
  title,
  description,
  tone,
  duration,
  actions,
  collapsible,
}: {
  id: string;
  title: string;
  description?: string;
  tone: ExtractionToastTone;
  duration: number;
  actions?: ExtractionToastAction[];
  collapsible?: boolean;
}) {
  toast.custom(
    () => (
      <ExtractionStatusToast
        key={`${collapsible ? "collapsible" : "fixed"}:${title}:${description ?? ""}`}
        title={title}
        description={description}
        tone={tone}
        actions={actions}
        collapsible={collapsible}
      />
    ),
    { id, duration },
  );
}

export function showPolicyExtractionQueuedToast({
  policyId,
  documentType: _documentType,
  fileName,
}: {
  policyId: string;
  documentType?: string | null;
  fileName?: string | null;
}) {
  const label = documentLabel();
  showExtractionStatusToast({
    id: policyExtractionToastId(policyId),
    title: `Extracting ${label}`,
    description: cleanDisplayText(fileName)
      ? `${fileName} uploaded. Extraction is queued.`
      : "Extraction is queued.",
    tone: "loading",
    duration: 60_000,
    collapsible: true,
  });
}

export function showPolicyExtractionReadyToast(
  policy: ToastPolicy,
  openPolicy?: () => void,
) {
  const label = documentLabel();
  const title =
    cleanDisplayText(policy.carrier) ??
    cleanDisplayText(policy.policyNumber) ??
    cleanDisplayText(policy.fileName) ??
    titleCase(label);
  const action = openPolicy
    ? [
        {
          label: "Open",
          onClick: () => {
            openPolicy();
            toast.dismiss(policyExtractionToastId(policy._id));
          },
          variant: "secondary" as const,
        },
      ]
    : undefined;

  if (isErrorStatus(policy.pipelineStatus)) {
    showExtractionStatusToast({
      id: policyExtractionToastId(policy._id),
      title: `${titleCase(label)} extraction failed`,
      description:
        policy.extractionPreviewError ??
        policy.pipelineError ??
        "Review the policy for details.",
      tone: "error",
      duration: 12_000,
      actions: action,
    });
    return;
  }

  if (isPreviewStatus(policy.pipelineStatus, policy.extractionDataStage)) {
    showExtractionStatusToast({
      id: policyExtractionToastId(policy._id),
      title: "Extraction complete",
      description: `${title} is available. Enrichment continues in the background.`,
      tone: "success",
      duration: 8_000,
      actions: action,
      collapsible: true,
    });
    return;
  }

  if (isFinalStatus(policy.pipelineStatus, policy.extractionDataStage)) {
    showExtractionStatusToast({
      id: policyExtractionToastId(policy._id),
      title: `${titleCase(label)} enrichment complete`,
      description: `${title} is ready.`,
      tone: "success",
      duration: 6_000,
      actions: action,
      collapsible: Boolean(action),
    });
  }
}

export function PolicyExtractionBanner({
  policyId,
  status,
  extractionDataStage,
  error,
  log,
  onCancel,
  cancelling,
}: {
  policyId: Id<"policies">;
  status: PipelineStatus | undefined;
  extractionDataStage?: string;
  error?: string;
  log?: LogEntry[];
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const retry = useAction(api.actions.retryExtraction.retryExtraction);
  const [retryingMode, setRetryingMode] = useState<RetryMode | null>(null);
  const previousStatus = useRef<PipelineStatus | undefined>(undefined);
  const hasShownActiveStatus = useRef(false);
  const toastId = policyExtractionToastId(policyId);
  const latestMessage = useMemo(() => latestLogMessage(log), [log]);
  const isEnriching =
    extractionDataStage === "preview" && status !== "complete";

  const handleRetry = useCallback(
    async (mode: RetryMode) => {
      if (retryingMode) return;

      setRetryingMode(mode);
      try {
        showExtractionStatusToast({
          id: toastId,
          title:
            mode === "resume" ? "Resuming extraction" : "Restarting extraction",
          description: "Queued for the extraction worker.",
          tone: "loading",
          duration: 20_000,
          collapsible: true,
        });
        const result = await retry({ policyId, mode });
        if (result && typeof result === "object" && "error" in result) {
          throw new Error(String(result.error));
        }
        showExtractionStatusToast({
          id: toastId,
          title:
            mode === "resume" ? "Extraction resumed" : "Extraction restarted",
          description: "The extraction worker has the policy.",
          tone: "success",
          duration: 5_000,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to restart extraction",
        );
      } finally {
        setRetryingMode(null);
      }
    },
    [policyId, retry, retryingMode, toastId],
  );

  useEffect(() => {
    if (!status || status === "idle") {
      previousStatus.current = status;
      return;
    }

    if (isActiveStatus(status)) {
      hasShownActiveStatus.current = true;
      showExtractionStatusToast({
        id: toastId,
        title:
          status === "paused"
            ? isEnriching
              ? "Enrichment paused"
              : "Extraction paused"
            : isEnriching
              ? "Enriching policy"
              : "Extracting policy",
        description:
          latestMessage ??
          (isEnriching
            ? "Adding source-backed details."
            : "Preparing policy details."),
        tone: "loading",
        duration: 120_000,
        collapsible: true,
        actions: onCancel
          ? [
              {
                label: cancelling ? "Cancelling" : "Cancel",
                onClick: () => {
                  if (!cancelling) onCancel();
                },
                variant: "secondary",
                disabled: cancelling,
              },
            ]
          : undefined,
      });
      previousStatus.current = status;
      return;
    }

    if (status === "error") {
      const nonInsuranceDocument = isNonInsuranceDocument(error);
      showExtractionStatusToast({
        id: toastId,
        title: nonInsuranceDocument
          ? "Not an insurance document"
          : "Extraction failed",
        description: error ?? "Review the policy and retry extraction.",
        tone: "error",
        duration: nonInsuranceDocument ? 10_000 : 20_000,
        actions: !nonInsuranceDocument
          ? [
              {
                label: retryingMode === "resume" ? "Resuming" : "Resume",
                onClick: () => void handleRetry("resume"),
                variant: "primary",
                disabled: retryingMode !== null,
              },
              {
                label: retryingMode === "full" ? "Restarting" : "Restart",
                onClick: () => void handleRetry("full"),
                variant: "secondary",
                disabled: retryingMode !== null,
              },
            ]
          : undefined,
      });
      previousStatus.current = status;
      return;
    }

    if (status === "complete" || extractionDataStage === "final") {
      if (
        hasShownActiveStatus.current ||
        isActiveStatus(previousStatus.current)
      ) {
        showExtractionStatusToast({
          id: toastId,
          title: "Enrichment complete",
          description: "Source-backed policy data is ready.",
          tone: "success",
          duration: 5_000,
        });
      } else {
        toast.dismiss(toastId);
      }
      previousStatus.current = status;
    }
  }, [
    cancelling,
    error,
    extractionDataStage,
    handleRetry,
    isEnriching,
    latestMessage,
    onCancel,
    retryingMode,
    status,
    toastId,
  ]);

  return null;
}
