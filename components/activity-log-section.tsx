"use client";

import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
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

// ── Types ──

export interface LogEntry {
  _id: string;
  status: "running" | "success" | "partial" | "error";
  createdAt: number;
  durationMs: number;
  error?: string;
  log?: string[];
}

export interface StatPill {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  colorClass: string;
}

interface ActivityLogSectionProps<T extends LogEntry> {
  title: string;
  entries: T[] | undefined;
  loading: boolean;
  emptyIcon: React.ComponentType<{ className?: string }>;
  emptyMessage: string;
  emptyDescription: string;
  renderEntryTitle: (entry: T) => string;
  renderStats: (entry: T) => StatPill[];
  classifyLogLine?: (line: string) => "reasoning" | "error" | "complete" | "default";
}

export function ActivityLogSection<T extends LogEntry>({
  title,
  entries,
  loading,
  emptyIcon: EmptyIcon,
  emptyMessage,
  emptyDescription,
  renderEntryTitle,
  renderStats,
  classifyLogLine,
}: ActivityLogSectionProps<T>) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedLogs, setCollapsedLogs] = useState<Set<string>>(new Set());

  function toggleLog(id: string) {
    setCollapsedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <EmptyIcon className="w-5 h-5 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-body-sm text-muted-foreground/60">
            {emptyMessage}
          </p>
          <p className="text-label-sm text-muted-foreground/40 mt-0.5">
            {emptyDescription}
          </p>
        </div>
      </FadeIn>
    );
  }

  const defaultClassify = (line: string): "reasoning" | "error" | "complete" | "default" => {
    if (line.includes("reasoning:")) return "reasoning";
    if (line.startsWith("Error:") || line.includes("failed")) return "error";
    if (line.startsWith("Complete:") || line.startsWith("Complete")) return "complete";
    return "default";
  };

  const classify = classifyLogLine ?? defaultClassify;

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={`w-full px-5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-foreground/[0.03] transition-colors bg-foreground/[0.015] ${collapsed ? "" : "border-b border-foreground/6"}`}
        >
          <p className="text-label-sm font-medium text-muted-foreground">
            {title}
            <span className="ml-1.5 opacity-50">{entries.length}</span>
          </p>
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>

        {!collapsed && (
          <>
            <div className="divide-y divide-foreground/4">
              {entries.map((entry) => {
                const isRunning = entry.status === "running";
                const isError = entry.status === "error";
                const isLogCollapsed = isRunning
                  ? collapsedLogs.has(entry._id)
                  : !collapsedLogs.has(entry._id);
                const stats = renderStats(entry);

                return (
                  <div key={entry._id}>
                    <button
                      type="button"
                      onClick={() => toggleLog(entry._id)}
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
                              {renderEntryTitle(entry)}
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

                            {stats.length > 0 && (
                              <div className="flex items-center gap-3 mt-1">
                                {stats.map((stat, i) => (
                                  <span
                                    key={i}
                                    className={`inline-flex items-center gap-1 text-label-sm ${stat.colorClass}`}
                                  >
                                    <stat.icon className="w-3 h-3" />
                                    {stat.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-start gap-2 shrink-0">
                          <div className="text-right">
                            <p className="text-label-sm text-muted-foreground">
                              {formatDate(entry.createdAt)}
                            </p>
                            <p className="text-label-sm text-muted-foreground/40">
                              {formatTime(entry.createdAt)}
                              {entry.durationMs > 0 &&
                                ` · ${formatDuration(entry.durationMs)}`}
                            </p>
                          </div>
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-muted-foreground/30 mt-1 transition-transform ${isLogCollapsed ? "-rotate-90" : ""}`}
                          />
                        </div>
                      </div>
                    </button>

                    {!isLogCollapsed && (
                      <div className="px-5 pb-3.5 -mt-1">
                        {entry.log && entry.log.length > 0 && (
                          <div className="ml-7 rounded-md bg-foreground/[0.02] border border-foreground/4 px-3 py-2 max-h-60 overflow-y-auto">
                            {entry.log.map((line, i) => {
                              const kind = classify(line);
                              return (
                                <p
                                  key={i}
                                  className={`text-label-sm font-mono leading-relaxed ${
                                    kind === "reasoning"
                                      ? "text-indigo-500/60 dark:text-indigo-400/50 pl-2 border-l-2 border-indigo-500/20 ml-1 my-0.5"
                                      : kind === "error"
                                        ? "text-red-500/70"
                                        : kind === "complete"
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

                        {entry.error && (
                          <p className="ml-7 text-label-sm text-red-500/70 mt-1.5 line-clamp-2 font-mono">
                            {entry.error.slice(0, 200)}
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
                {entries.length} {entries.length === 1 ? "run" : "runs"}
              </p>
            </div>
          </>
        )}
      </div>
    </FadeIn>
  );
}
