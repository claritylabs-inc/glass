"use client";

import { useState, Fragment } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { motion, AnimatePresence } from "framer-motion";
import dayjs from "dayjs";
import { PillButton } from "@/components/ui/pill-button";
import { Pause, Play, X } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { TerminalLog } from "@/components/terminal-log";
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
function PauseButton({ policyId }: { policyId: string }) {
  const pause = useMutation(api.policies.pauseExtraction);
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
function ResumeButton({ policyId }: { policyId: string }) {
  const resume = useMutation(api.policies.resumeExtraction);
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
function CancelButton({ policyId }: { policyId: string }) {
  const cancel = useMutation(api.policies.cancelExtraction);
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
      {cancelling ? "Dismissing..." : "Dismiss"}
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

function formatDate(timestamp: number): string {
  return dayjs(timestamp).format("MMM D, YYYY");
}

function ExtractionLogRow({ log, isExpanded, isExtracting }: { log: ExtractionLogEntry[]; isExpanded: boolean; isExtracting: boolean }) {
  if (!log.length || !isExpanded) return null;

  return (
    <tr>
      <td colSpan={5} className="px-4 pt-0 pb-3">
        <TerminalLog entries={log} live={isExtracting} maxHeight={180} />
      </td>
    </tr>
  );
}

export function ExtractionTable({
  extractions,
}: {
  extractions: Extraction[] | undefined;
}) {
  if (!extractions || extractions.length === 0) return null;

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <table className="w-full text-left md:min-w-[700px]">
        <thead>
          <tr className="bg-foreground/[0.02]">
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap">
              Source Email
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap hidden sm:table-cell">
              Attachment
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap">
              Status
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap hidden md:table-cell">
              Date
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap text-right hidden md:table-cell">
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
                        {extraction.emailSubject || (extraction.emailFrom ? "—" : (extraction.fileName ?? "Manual Upload"))}
                      </p>
                      <p className="text-label-sm text-muted-foreground/60 truncate max-w-[250px]">
                        {extraction.emailFrom || (extraction.emailSubject ? "Unknown sender" : "Uploaded file")}
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
                            <CancelButton policyId={extraction._id} />
                          </>
                        )}
                        {(extraction.extractionStatus === "error" || extraction.extractionStatus === "pending") && (
                          <CancelButton policyId={extraction._id} />
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
  );
}
