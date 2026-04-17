"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import { Search } from "lucide-react";
import { useLogDetail } from "@/hooks/use-log-detail";

// ── Types ────────────────────────────────────────────────────────────────────

export type LogStatus = "success" | "error" | "warning" | "info" | "running";

export interface LogSubEntry {
  timestamp: number;
  message: string;
  status?: LogStatus;
}

export interface StructuredLogEntry {
  id: string;
  timestamp: number;
  status: LogStatus;
  event: string;
  detail?: string;
  meta?: Record<string, string | number | boolean | undefined>;
  /** Child log lines shown in the detail panel (e.g. extraction steps) */
  subEntries?: LogSubEntry[];
}

// ── Status config ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<LogStatus, { dot: string; label: string; text: string }> = {
  success: {
    dot: "bg-emerald-500",
    label: "Success",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    dot: "bg-red-500",
    label: "Error",
    text: "text-red-600 dark:text-red-400",
  },
  warning: {
    dot: "bg-amber-500",
    label: "Warning",
    text: "text-amber-600 dark:text-amber-400",
  },
  info: {
    dot: "bg-blue-500",
    label: "Info",
    text: "text-blue-600 dark:text-blue-400",
  },
  running: {
    dot: "bg-blue-500 animate-pulse",
    label: "Running",
    text: "text-blue-600 dark:text-blue-400",
  },
};

// ── Filter pills ─────────────────────────────────────────────────────────────

const STATUS_FILTERS: { value: LogStatus; label: string }[] = [
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "success", label: "Success" },
  { value: "info", label: "Info" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function StructuredLog({
  entries,
  live = false,
  emptyMessage = "No log entries",
  maxHeight = 480,
  className,
}: {
  entries: StructuredLogEntry[];
  live?: boolean;
  emptyMessage?: string;
  maxHeight?: number;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<LogStatus>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(entries.length);
  const { entry: selectedEntry, openLogDetail, closeLogDetail } = useLogDetail();

  // Auto-scroll on new entries when live
  useEffect(() => {
    if (live && entries.length > prevLengthRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
    prevLengthRef.current = entries.length;
  }, [entries.length, live]);

  // Close panel when navigating away
  useEffect(() => {
    return () => closeLogDetail();
  }, [closeLogDetail]);

  const filtered = useMemo(() => {
    let result = entries;
    if (statusFilter.size > 0) {
      result = result.filter((e) => statusFilter.has(e.status));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.event.toLowerCase().includes(q) ||
          e.detail?.toLowerCase().includes(q) ||
          Object.values(e.meta ?? {}).some((v) =>
            String(v).toLowerCase().includes(q),
          ) ||
          e.subEntries?.some((s) => s.message.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [entries, search, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<LogStatus, number> = {
      success: 0, error: 0, warning: 0, info: 0, running: 0,
    };
    for (const e of entries) counts[e.status]++;
    return counts;
  }, [entries]);

  const toggleFilter = (status: LogStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const handleRowClick = (entry: StructuredLogEntry) => {
    if (selectedEntry?.id === entry.id) {
      closeLogDetail();
    } else {
      openLogDetail(entry);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-foreground/6 bg-card overflow-hidden",
        className,
      )}
    >
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/6 bg-foreground/[0.015]">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs bg-transparent border border-foreground/8 rounded-md outline-none focus:border-foreground/20 transition-colors placeholder:text-muted-foreground/30"
          />
        </div>

        {/* Status filters */}
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => {
            const count = statusCounts[f.value];
            if (count === 0) return null;
            const active = statusFilter.has(f.value);
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleFilter(f.value)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer",
                  active
                    ? `${STATUS_STYLES[f.value].text} bg-foreground/5 ring-1 ring-foreground/10`
                    : "text-muted-foreground/40 hover:text-muted-foreground/60",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    STATUS_STYLES[f.value].dot,
                    !active && "opacity-40",
                  )}
                />
                {f.label}
                <span className="opacity-50">{count}</span>
              </button>
            );
          })}
        </div>

        {live && (
          <span className="flex items-center gap-1.5 ml-auto shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium text-emerald-600/70 dark:text-emerald-500/70">
              Live
            </span>
          </span>
        )}
      </div>

      {/* ── Column headers ── */}
      <div className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1.5fr)] gap-x-3 px-4 py-1.5 border-b border-foreground/4 bg-foreground/[0.01] text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider">
        <span>Time</span>
        <span>Event</span>
        <span>Detail</span>
      </div>

      {/* ── Rows ── */}
      {filtered.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-xs text-muted-foreground/40">
            {search || statusFilter.size > 0
              ? "No matching entries"
              : emptyMessage}
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{ maxHeight }}
        >
          {filtered.map((entry, i) => {
            const style = STATUS_STYLES[entry.status];
            const isSelected = selectedEntry?.id === entry.id;
            const isLatest = live && i === filtered.length - 1;

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => handleRowClick(entry)}
                className={cn(
                  "w-full grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1.5fr)] gap-x-3 px-4 py-2 text-left transition-colors cursor-pointer",
                  isSelected
                    ? "bg-foreground/[0.04]"
                    : "hover:bg-foreground/[0.02]",
                  isLatest && !isSelected && "bg-foreground/[0.015]",
                  i !== filtered.length - 1 && "border-b border-foreground/[0.04]",
                )}
              >
                {/* Time */}
                <span className="text-[12px] tabular-nums text-muted-foreground/50 font-mono whitespace-nowrap">
                  {dayjs(entry.timestamp).format("HH:mm:ss")}
                </span>

                {/* Event */}
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn("w-1.5 h-1.5 rounded-full shrink-0", style.dot)}
                  />
                  <span
                    className={cn(
                      "text-xs truncate",
                      isSelected || isLatest
                        ? "text-foreground font-medium"
                        : "text-foreground/80",
                    )}
                  >
                    {entry.event}
                  </span>
                  {entry.subEntries && entry.subEntries.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/30 tabular-nums shrink-0">
                      {entry.subEntries.length} steps
                    </span>
                  )}
                </span>

                {/* Detail */}
                <span className="text-xs text-muted-foreground/50 truncate">
                  {entry.detail}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-foreground/4 bg-foreground/[0.01]">
        <span className="text-[11px] text-muted-foreground/35 tabular-nums">
          {filtered.length === entries.length
            ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
            : `${filtered.length} of ${entries.length} entries`}
        </span>
        {filtered.length > 0 && (
          <span className="text-[11px] text-muted-foreground/25 tabular-nums">
            {dayjs(filtered[0].timestamp).format("MMM D")} — {dayjs(filtered[filtered.length - 1].timestamp).format("MMM D")}
          </span>
        )}
      </div>
    </div>
  );
}
