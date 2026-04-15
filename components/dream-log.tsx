"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Brain,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Sparkles,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";

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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function DreamLog() {
  const logs = useQuery(api.dreamLogs.list, {});
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedLogs, setCollapsedLogs] = useState<Set<string>>(new Set());

  function toggleLog(id: string) {
    setCollapsedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (logs === undefined) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <Brain className="w-5 h-5 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-body-sm text-muted-foreground/60">
            No dream consolidation runs yet
          </p>
          <p className="text-label-sm text-muted-foreground/40 mt-0.5">
            Dream runs weekly to deduplicate and synthesize intelligence
            entries.
          </p>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        {/* Collapsible section header */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={`w-full px-5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-foreground/[0.03] transition-colors bg-foreground/[0.015] ${collapsed ? "" : "border-b border-foreground/6"}`}
        >
          <p className="text-label-sm font-medium text-muted-foreground">
            Dream Runs
            <span className="ml-1.5 opacity-50">{logs.length}</span>
          </p>
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>

        {!collapsed && (
          <>
            <div className="divide-y divide-foreground/4">
              {logs.map((log) => {
                const isRunning = log.status === "running";
                const isError = log.status === "error";
                const isLogCollapsed = collapsedLogs.has(log._id);
                return (
                  <div key={log._id}>
                    {/* Log entry header — clickable to collapse */}
                    <button
                      type="button"
                      onClick={() => toggleLog(log._id)}
                      className="w-full px-5 py-3.5 hover:bg-foreground/[0.015] transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          {isRunning ? (
                            <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0 mt-0.5" />
                          ) : isError ? (
                            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-medium text-foreground">
                              Dream Consolidation
                              {isRunning && (
                                <span className="ml-1.5 text-blue-500 font-normal">
                                  — running
                                </span>
                              )}
                              {isError && (
                                <span className="ml-1.5 text-red-500 font-normal">
                                  — failed
                                </span>
                              )}
                            </p>

                            {/* Stats */}
                            <div className="flex items-center gap-3 mt-1">
                              <span className="inline-flex items-center gap-1 text-label-sm text-muted-foreground">
                                <Brain className="w-3 h-3" />
                                {log.entriesReviewed} reviewed
                              </span>
                              {log.entriesDeleted > 0 && (
                                <span className="inline-flex items-center gap-1 text-label-sm text-red-500/70">
                                  <Trash2 className="w-3 h-3" />
                                  {log.entriesDeleted} removed
                                </span>
                              )}
                              {log.entriesConsolidated > 0 && (
                                <span className="inline-flex items-center gap-1 text-label-sm text-blue-500/70">
                                  <Sparkles className="w-3 h-3" />
                                  {log.entriesConsolidated} consolidated
                                </span>
                              )}
                              {log.gapsIdentified > 0 && (
                                <span className="inline-flex items-center gap-1 text-label-sm text-amber-500/70">
                                  <HelpCircle className="w-3 h-3" />
                                  {log.gapsIdentified} gaps
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 shrink-0">
                          <div className="text-right">
                            <p className="text-label-sm text-muted-foreground">
                              {formatDate(log.createdAt)}
                            </p>
                            <p className="text-label-sm text-muted-foreground/40">
                              {formatTime(log.createdAt)}
                              {log.durationMs > 0 &&
                                ` · ${formatDuration(log.durationMs)}`}
                            </p>
                          </div>
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-muted-foreground/30 mt-1 transition-transform ${isLogCollapsed ? "-rotate-90" : ""}`}
                          />
                        </div>
                      </div>
                    </button>

                    {/* Expanded details */}
                    {!isLogCollapsed && (
                      <div className="px-5 pb-3.5 -mt-1">
                        {/* Streaming log lines */}
                        {log.log && log.log.length > 0 && (
                          <div className="ml-7 rounded-md bg-foreground/[0.02] border border-foreground/4 px-3 py-2 max-h-60 overflow-y-auto">
                            {log.log.map((line, i) => {
                              const isReasoning =
                                line.includes("reasoning:");
                              const isLineError =
                                line.startsWith("Error:") ||
                                line.includes("failed");
                              const isComplete =
                                line.startsWith("Complete:");
                              return (
                                <p
                                  key={i}
                                  className={`text-label-sm font-mono leading-relaxed ${
                                    isReasoning
                                      ? "text-indigo-500/60 dark:text-indigo-400/50 pl-2 border-l-2 border-indigo-500/20 ml-1 my-0.5"
                                      : isLineError
                                        ? "text-red-500/70"
                                        : isComplete
                                          ? "text-emerald-600/70 dark:text-emerald-400/60 font-medium"
                                          : "text-muted-foreground/70"
                                  }`}
                                >
                                  {line}
                                </p>
                              );
                            })}
                          </div>
                        )}

                        {/* Error */}
                        {log.error && (
                          <p className="ml-7 text-label-sm text-red-500/70 mt-1.5 line-clamp-2 font-mono">
                            {log.error.slice(0, 200)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-foreground/[0.04] px-4 py-2 bg-foreground/[0.01]">
              <p className="text-label-sm text-muted-foreground/60">
                {logs.length} dream {logs.length === 1 ? "run" : "runs"}
              </p>
            </div>
          </>
        )}
      </div>
    </FadeIn>
  );
}
