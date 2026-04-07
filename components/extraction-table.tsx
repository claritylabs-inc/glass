"use client";

import { useState, Fragment, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { motion, AnimatePresence } from "framer-motion";
import { PillButton } from "@/components/ui/pill-button";
import { RotateCw, X, Terminal, Pause, Play } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { RetryExtractionModal } from "@/components/ui/retry-extraction-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface ExtractionLogEntry {
  timestamp: number;
  message: string;
}

interface Extraction {
  _id: string;
  fileName?: string;
  extractionStatus: string;
  extractionError?: string;
  extractionLog?: ExtractionLogEntry[];
  _creationTime: number;
  emailSubject?: string;
  emailFrom?: string;
  hasRawResponse?: boolean;
  hasRawMetadata?: boolean;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  extracting: {
    label: "Extracting",
    className: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 animate-pulse",
  },
  paused: {
    label: "Paused",
    className: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400",
  },
  error: {
    label: "Error",
    className: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  },
  pending: {
    label: "Pending",
    className: "bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400",
  },
};

// Pause button - only shown when extracting
function PauseButton({ policyId, isQuote }: { policyId: string; isQuote?: boolean }) {
  const pause = useMutation(isQuote ? api.quotes.pauseExtraction : api.policies.pauseExtraction);
  const [pausing, setPausing] = useState(false);

  return (
    <button
      type="button"
      disabled={pausing}
      onClick={async () => {
        setPausing(true);
        try {
          await pause({ id: policyId as unknown as Id<"policies"> });
        } finally {
          setPausing(false);
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 text-label-sm font-medium text-amber-700 dark:text-amber-400 hover:border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 transition-colors cursor-pointer disabled:opacity-50"
    >
      <Pause className="w-3 h-3" />
      {pausing ? "Pausing..." : "Pause"}
    </button>
  );
}

// Resume button - shown when paused
function ResumeButton({ policyId, isQuote }: { policyId: string; isQuote?: boolean }) {
  const resume = useMutation(isQuote ? api.quotes.resumeExtraction : api.policies.resumeExtraction);
  const [resuming, setResuming] = useState(false);

  return (
    <button
      type="button"
      disabled={resuming}
      onClick={async () => {
        setResuming(true);
        try {
          await resume({ id: policyId as unknown as Id<"policies"> });
        } finally {
          setResuming(false);
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-label-sm font-medium text-emerald-700 dark:text-emerald-400 hover:border-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-colors cursor-pointer disabled:opacity-50"
    >
      <Play className="w-3 h-3" />
      {resuming ? "Resuming..." : "Resume"}
    </button>
  );
}

// Cancel button - shown when paused (stops extraction)
function CancelButton({ policyId, isQuote }: { policyId: string; isQuote?: boolean }) {
  const cancel = useMutation(isQuote ? api.quotes.cancelExtraction : api.policies.cancelExtraction);
  const [cancelling, setCancelling] = useState(false);

  return (
    <button
      type="button"
      disabled={cancelling}
      onClick={async () => {
        setCancelling(true);
        try {
          await cancel({ id: policyId as unknown as Id<"policies"> });
        } finally {
          setCancelling(false);
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 text-label-sm font-medium text-red-700 dark:text-red-400 hover:border-red-300 hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors cursor-pointer disabled:opacity-50"
    >
      <X className="w-3 h-3" />
      {cancelling ? "Cancelling..." : "Cancel"}
    </button>
  );
}

// Restart button - shown when paused or error (restarts extraction)
function RestartButton({ extraction, isQuote }: { extraction: Extraction; isQuote?: boolean }) {
  const restart = useMutation(isQuote ? api.quotes.restartExtraction : api.policies.restartExtraction);
  const [restarting, setRestarting] = useState(false);

  return (
    <RetryExtractionModal
      policyId={extraction._id}
      hasRawResponse={!!extraction.hasRawResponse}
      hasRawMetadata={!!extraction.hasRawMetadata}
      hasDocument={false}
      trigger={
        <button
          type="button"
          disabled={restarting}
          onClick={async () => {
            setRestarting(true);
            try {
              await restart({ id: extraction._id as unknown as Id<"policies"> });
            } finally {
              setRestarting(false);
            }
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 text-label-sm font-medium text-amber-700 dark:text-amber-400 hover:border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RotateCw className="w-3 h-3" />
          {restarting ? "Restarting..." : "Restart"}
        </button>
      }
    />
  );
}

// Dismiss button - shown for error/not_insurance (marks as not insurance)
function DismissButton({ policyId, isQuote }: { policyId: string; isQuote?: boolean }) {
  const dismiss = useMutation(isQuote ? api.quotes.dismiss : api.policies.dismiss);
  const [dismissing, setDismissing] = useState(false);

  return (
    <button
      type="button"
      disabled={dismissing}
      onClick={async () => {
        setDismissing(true);
        try {
          await dismiss({ id: policyId as unknown as Id<"policies"> });
        } finally {
          setDismissing(false);
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 dark:bg-white/[0.06] text-label-sm font-medium text-muted-foreground hover:border-red-200 dark:hover:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
    >
      <X className="w-3 h-3" />
      Dismiss
    </button>
  );
}

function ViewErrorButton({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-label-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
      >
        View error
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Error Log</DialogTitle>
          </DialogHeader>
          <pre className="text-label-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-md p-3 whitespace-pre-wrap break-words font-mono max-h-[300px] overflow-y-auto">
            {error}
          </pre>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setOpen(false)}>
              Close
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ExtractionLogRow({ log, isExpanded, isExtracting }: { log: ExtractionLogEntry[]; isExpanded: boolean; isExtracting: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (log.length > prevLengthRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: log.length === 1 ? "instant" : "smooth",
      });
    }
    prevLengthRef.current = log.length;
  }, [log.length]);

  if (!log.length || !isExpanded) return null;

  return (
    <tr>
      <td colSpan={5} className="px-4 pt-0 pb-3">
        <div className="rounded-lg bg-zinc-950 dark:bg-zinc-950/80 border border-zinc-800/60 overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/60 bg-zinc-900/60">
            <Terminal className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] font-medium text-zinc-500 font-mono">
              Extraction Log
            </span>
            {isExtracting && (
              <span className="ml-auto flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="text-[10px] font-mono text-emerald-500/70">live</span>
              </span>
            )}
          </div>
          {/* Log entries */}
          <div
            ref={scrollRef}
            className="max-h-[180px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700/50 p-3 space-y-0.5"
          >
            {log.map((entry, i) => {
              const isLatest = i === log.length - 1 && isExtracting;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-baseline gap-2.5 py-[1px]"
                >
                  <span className="text-[10px] tabular-nums text-zinc-600 shrink-0 w-11 text-right font-mono">
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                  <span className={`text-[12px] font-mono leading-relaxed ${
                    isLatest
                      ? "text-zinc-200"
                      : "text-zinc-400"
                  }`}>
                    {isLatest && (
                      <span className="text-emerald-500 mr-1.5">{">"}</span>
                    )}
                    {entry.message}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </td>
    </tr>
  );
}

function ExtractionSkeletonRows() {
  return (
    <tbody>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="border-t border-foreground/4">
          <td className="px-4 py-2.5">
            <Skeleton className="h-4 w-44 mb-1.5" />
            <Skeleton className="h-3 w-28" />
          </td>
          <td className="px-4 py-2.5 hidden sm:table-cell">
            <Skeleton className="h-4 w-32" />
          </td>
          <td className="px-4 py-2.5">
            <Skeleton className="h-5 w-16 rounded-full" />
          </td>
          <td className="px-4 py-2.5 hidden md:table-cell">
            <Skeleton className="h-4 w-20" />
          </td>
          <td className="px-4 py-2.5 hidden md:table-cell text-right">
            <Skeleton className="h-7 w-24 ml-auto rounded-md" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export function ExtractionTable({
  extractions,
}: {
  extractions: Extraction[] | undefined;
}) {
  if (extractions === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left md:min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Source Email</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Attachment</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">Date</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Actions</th>
              </tr>
            </thead>
            <ExtractionSkeletonRows />
          </table>
        </div>
      </div>
    );
  }

  if (extractions.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">No pending extractions</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left md:min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Source Email
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">
                  Attachment
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                  Date
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={extractions.map((e) => e._id).join(",")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {extractions.map((extraction, i) => {
                  const badge = STATUS_BADGES[extraction.extractionStatus] || STATUS_BADGES.pending;
                  const hasLog = extraction.extractionLog && extraction.extractionLog.length > 0;
                  const showLog = hasLog && (extraction.extractionStatus === "extracting" || extraction.extractionStatus === "error");
                  return (
                    <Fragment key={extraction._id}>
                      <FadeIn
                        as="tr"
                        when={true}
                        delay={i * 0.02}
                        duration={0.35}
                        direction="none"
                        className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <p className="text-body-sm text-foreground font-medium truncate max-w-[250px]">
                            {extraction.emailSubject || "—"}
                          </p>
                          <p className="text-label-sm text-muted-foreground/60 truncate max-w-[250px]">
                            {extraction.emailFrom || "Unknown sender"}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-body-sm text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                          {extraction.fileName || "—"}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            {extraction.extractionStatus === "error" && extraction.extractionError && (
                              <ViewErrorButton error={extraction.extractionError} />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-body-sm text-muted-foreground hidden md:table-cell whitespace-nowrap">
                          {formatDate(extraction._creationTime)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap hidden md:table-cell">
                          <div className="inline-flex items-center gap-2">
                            {extraction.extractionStatus === "extracting" && (
                              <PauseButton policyId={extraction._id} />
                            )}
                            {extraction.extractionStatus === "paused" && (
                              <>
                                <ResumeButton policyId={extraction._id} />
                                <RestartButton extraction={extraction} />
                                <CancelButton policyId={extraction._id} />
                              </>
                            )}
                            {(extraction.extractionStatus === "error" || extraction.extractionStatus === "pending") && (
                              <>
                                <RestartButton extraction={extraction} />
                                <DismissButton policyId={extraction._id} />
                              </>
                            )}
                          </div>
                        </td>
                      </FadeIn>
                      {showLog && (
                        <ExtractionLogRow
                          log={extraction.extractionLog!}
                          isExpanded={true}
                          isExtracting={extraction.extractionStatus === "extracting"}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </motion.tbody>
            </AnimatePresence>
          </table>
        </div>
        <div className="border-t border-foreground/[0.04] px-4 py-2 flex items-center justify-between bg-foreground/[0.01]">
          <p className="text-label-sm text-muted-foreground/60">
            {extractions.length} pending{" "}
            {extractions.length === 1 ? "extraction" : "extractions"}
          </p>
        </div>
      </div>
    </FadeIn>
  );
}
