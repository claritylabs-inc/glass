"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
  X,
  RotateCw,
  Trash2,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { ActivitySection } from "@/components/activity-section";
import { TerminalLog } from "@/components/terminal-log";

// ── Types ──

interface ExtractionLogEntry {
  timestamp: number;
  message: string;
}

interface PolicyEntry {
  _id: string;
  carrier: string;
  policyNumber: string;
  insuredName?: string;
  policyTypes?: string[];
  policyType?: string;
  documentType?: string;
  extractionStatus: string;
  extractionError?: string;
  extractionLog?: ExtractionLogEntry[];
  _creationTime: number;
  emailSubject?: string;
  emailFrom?: string;
  emailId?: string;
  fileId?: string;
  fileName?: string;
  hasRawResponse?: boolean;
  hasRawMetadata?: boolean;
  isDemo?: boolean;
}

// ── Action buttons ──

function ActionButton({
  onClick,
  disabled,
  icon: Icon,
  label,
  loadingLabel,
  className,
}: {
  onClick: () => Promise<unknown>;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  loadingLabel: string;
  className: string;
}) {
  const [running, setRunning] = useState(false);
  return (
    <button
      type="button"
      disabled={running || disabled}
      onClick={async (e) => {
        e.stopPropagation();
        setRunning(true);
        try {
          await onClick();
        } finally {
          setRunning(false);
        }
      }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-label-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${className}`}
    >
      <Icon className="w-3 h-3" />
      {running ? loadingLabel : label}
    </button>
  );
}

function EntryActions({ entry }: { entry: PolicyEntry }) {
  const pause = useMutation(api.policies.pauseExtraction);
  const resume = useMutation(api.policies.resumeExtraction);
  const cancel = useMutation(api.policies.cancelExtraction);
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const router = useRouter();

  const id = entry._id as unknown as Id<"policies">;
  const status = entry.extractionStatus;

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      {status === "extracting" && (
        <ActionButton
          onClick={() => pause({ id })}
          icon={Pause}
          label="Pause"
          loadingLabel="Pausing..."
          className="border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60"
        />
      )}
      {status === "paused" && (
        <>
          <ActionButton
            onClick={() => resume({ id })}
            icon={Play}
            label="Resume"
            loadingLabel="Resuming..."
            className="border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:border-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60"
          />
          <ActionButton
            onClick={() => cancel({ id })}
            icon={X}
            label="Dismiss"
            loadingLabel="Dismissing..."
            className="border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:border-red-300 hover:bg-red-100 dark:hover:bg-red-950/60"
          />
        </>
      )}
      {(status === "error" || status === "pending") && (
        <ActionButton
          onClick={() => cancel({ id })}
          icon={X}
          label="Dismiss"
          loadingLabel="Dismissing..."
          className="border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:border-red-300 hover:bg-red-100 dark:hover:bg-red-950/60"
        />
      )}
      {(entry.fileId || entry.emailId) && !entry.isDemo && (status === "complete" || status === "error") && (
        <ActionButton
          onClick={() => retryExtraction({ policyId: id, mode: "full" })}
          icon={RotateCw}
          label="Re-extract"
          loadingLabel="Re-extracting..."
          className="border-foreground/12 bg-card text-muted-foreground hover:border-foreground/20 hover:bg-foreground/[0.03]"
        />
      )}
      {status === "complete" && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/policies/${entry._id}`);
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-card text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          View
        </button>
      )}
    </div>
  );
}

// ── Status helpers ──

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "extracting":
      return <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0 mt-0.5" />;
    case "paused":
      return <Pause className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />;
    case "error":
      return <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />;
    case "not_insurance":
      return <Trash2 className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />;
    case "pending":
      return <Loader2 className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />;
    default:
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />;
  }
}

function statusSuffix(status: string): string | null {
  switch (status) {
    case "extracting":
      return "extracting";
    case "paused":
      return "paused";
    case "error":
      return "failed";
    case "pending":
      return "pending";
    case "not_insurance":
      return "dismissed";
    default:
      return null;
  }
}

function statusSuffixColor(status: string): string {
  switch (status) {
    case "extracting":
      return "text-amber-500";
    case "paused":
      return "text-yellow-500";
    case "error":
      return "text-red-500";
    default:
      return "text-muted-foreground/50";
  }
}

function entryTitle(entry: PolicyEntry): string {
  if (entry.carrier && entry.carrier !== "Extracting...") {
    const num = entry.policyNumber && entry.policyNumber !== "Extracting..." ? ` ${entry.policyNumber}` : "";
    return `${entry.carrier}${num}`;
  }
  return entry.fileName ?? entry.emailSubject ?? "Extraction";
}

function entrySubtitle(entry: PolicyEntry): string | null {
  if (entry.carrier && entry.carrier !== "Extracting...") {
    return entry.insuredName ?? entry.emailFrom ?? entry.fileName ?? null;
  }
  return entry.emailFrom ?? null;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Main component ──

export function PolicyExtractionsLog() {
  const pending = useQuery(api.policies.listPending, {});
  const completed = useQuery(api.policies.listExtractionLog, {});
  const [collapsedEntries, setCollapsedEntries] = useState<Set<string>>(new Set());

  const loading = pending === undefined || completed === undefined;

  // Merge: pending first (newest first), then completed (newest first)
  const entries: PolicyEntry[] = loading
    ? []
    : [
        ...(pending as PolicyEntry[]).sort((a, b) => b._creationTime - a._creationTime),
        ...(completed as PolicyEntry[]).sort((a, b) => b._creationTime - a._creationTime),
      ];

  function toggleEntry(id: string) {
    setCollapsedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isActive = (s: string) => s === "extracting" || s === "paused" || s === "pending" || s === "error";

  return (
    <ActivitySection
      title="Policy Extractions"
      count={loading ? undefined : entries.length}
      loading={loading}
      skeletonRows={3}

      emptyMessage="No policy extractions yet"
      emptyDescription="Extractions will appear here after scanning emails or uploading documents."
      isEmpty={!loading && entries.length === 0}
      footerText={entries.length > 0 ? `${entries.length} ${entries.length === 1 ? "extraction" : "extractions"}` : undefined}
    >
      <div className="divide-y divide-foreground/4">
        {entries.map((entry) => {
          const active = isActive(entry.extractionStatus);
          // Active entries default expanded, completed default collapsed
          const isCollapsed = active
            ? collapsedEntries.has(entry._id)
            : !collapsedEntries.has(entry._id);
          const suffix = statusSuffix(entry.extractionStatus);
          const types = entry.policyTypes ?? [entry.policyType ?? "other"];
          const firstType = types[0];
          const sub = entrySubtitle(entry);
          const hasLog = entry.extractionLog && entry.extractionLog.length > 0;
          const showLog = hasLog && (entry.extractionStatus === "extracting" || entry.extractionStatus === "error");

          return (
            <div key={entry._id}>
              <button
                type="button"
                onClick={() => toggleEntry(entry._id)}
                className="w-full px-5 py-3.5 hover:bg-foreground/[0.015] transition-colors cursor-pointer text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <StatusIcon status={entry.extractionStatus} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground">
                        {entryTitle(entry)}
                        {suffix && (
                          <span className={`ml-1.5 font-normal ${statusSuffixColor(entry.extractionStatus)}`}>
                            — {suffix}
                          </span>
                        )}
                      </p>
                      {/* Stat pills row */}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {entry.extractionStatus === "complete" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400">
                            {entry.documentType === "quote" ? "Quote" : "Policy"}
                          </span>
                        )}
                        {entry.extractionStatus === "complete" && firstType && (
                          <span className="text-label-sm text-muted-foreground">
                            {POLICY_TYPE_LABELS[firstType] || firstType}
                            {types.length > 1 && ` +${types.length - 1}`}
                          </span>
                        )}
                        {sub && (
                          <span className="text-label-sm text-muted-foreground/50 truncate max-w-[200px]">
                            {sub}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-label-sm text-muted-foreground">
                        {formatDate(entry._creationTime)}
                      </p>
                      <p className="text-label-sm text-muted-foreground/40">
                        {formatTime(entry._creationTime)}
                      </p>
                    </div>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-muted-foreground/30 mt-1 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                  </div>
                </div>
              </button>

              {!isCollapsed && (
                <div className="px-5 pb-3.5 -mt-1 ml-7 space-y-2">
                  {/* Terminal log for active extractions */}
                  {showLog && (
                    <TerminalLog
                      entries={entry.extractionLog!}
                      live={entry.extractionStatus === "extracting"}
                      maxHeight={180}
                    />
                  )}

                  {/* Error message */}
                  {entry.extractionError && (
                    <pre className="text-label-sm text-red-500/70 font-mono bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-md p-2 whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto">
                      {entry.extractionError.slice(0, 500)}
                    </pre>
                  )}

                  {/* Action buttons */}
                  <EntryActions entry={entry} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ActivitySection>
  );
}
