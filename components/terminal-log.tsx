"use client";

import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import { Terminal } from "lucide-react";

interface LogEntry {
  timestamp: number;
  message: string;
}

export function TerminalLog({
  entries,
  title = "Extraction Log",
  live = false,
  emptyMessage = "No log entries",
  maxHeight = 300,
  className,
}: {
  entries: LogEntry[];
  title?: string;
  live?: boolean;
  emptyMessage?: string;
  maxHeight?: number;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const [now, setNow] = useState(() => dayjs().valueOf());

  useEffect(() => {
    if (entries.length > prevLengthRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: entries.length === 1 ? "instant" : "smooth",
      });
    }
    prevLengthRef.current = entries.length;
  }, [entries.length]);

  useEffect(() => {
    if (!live) return;
    const interval = window.setInterval(() => setNow(dayjs().valueOf()), 15000);
    return () => window.clearInterval(interval);
  }, [live]);

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-foreground/8 bg-foreground/[0.02] dark:bg-foreground/[0.04] overflow-hidden",
          className
        )}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-foreground/6 bg-foreground/[0.02]">
          <Terminal className="w-3 h-3 text-muted-foreground/40" />
          <span className="text-xs font-medium text-muted-foreground/50 font-mono">{title}</span>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-label-sm text-muted-foreground/50 font-mono">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-foreground/8 bg-foreground/[0.02] dark:bg-foreground/[0.04] overflow-hidden",
        className
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-foreground/6 bg-foreground/[0.02]">
        <Terminal className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-xs font-medium text-muted-foreground/50 font-mono">{title}</span>
        {live && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-mono text-emerald-600/70 dark:text-emerald-500/70">live</span>
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto p-3 space-y-0.5"
        style={{ maxHeight }}
      >
        {entries.map((entry, i) => {
          const isError = /^(failed|error)/i.test(entry.message);
          const isSuccess = /(complete|success|stored)/i.test(entry.message);
          const isWarning = /^warning/i.test(entry.message);
          const isLatest = live && i === entries.length - 1;
          const seconds = Math.round((now - entry.timestamp) / 1000);
          const time =
            seconds < 5
              ? "just now"
              : seconds < 60
                ? `${seconds}s ago`
                : seconds < 3600
                  ? `${Math.round(seconds / 60)}m ago`
                  : dayjs(entry.timestamp).format("HH:mm:ss");

          return (
            <div key={i} className="flex items-baseline gap-2.5 py-[1px]">
              <span className="text-xs tabular-nums text-muted-foreground/35 shrink-0 w-16 whitespace-nowrap text-right font-mono">
                {time}
              </span>
              <span
                className={cn(
                  "text-xs font-mono leading-relaxed",
                  isLatest ? "text-foreground" : "text-muted-foreground/70",
                  !isLatest && isError && "text-red-600 dark:text-red-400",
                  !isLatest && isWarning && "text-amber-600 dark:text-amber-400",
                  !isLatest && isSuccess && "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {isLatest && (
                  <span className="text-emerald-600 dark:text-emerald-500 mr-1.5">{">"}</span>
                )}
                {entry.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
