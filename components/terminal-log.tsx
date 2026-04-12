"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";

interface LogEntry {
  timestamp: number;
  message: string;
}

/**
 * Terminal-style log display with auto-scroll, monospace font, and color-coded messages.
 */
export function TerminalLog({
  entries,
  maxHeight = 300,
  className,
}: {
  entries: LogEntry[];
  maxHeight?: number;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className={cn("rounded-lg bg-neutral-950 border border-neutral-800 px-4 py-6 text-center", className)}>
        <p className="text-label-sm text-neutral-500 font-mono">No log entries</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg bg-neutral-950 border border-neutral-800 overflow-hidden", className)}>
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900/80 border-b border-neutral-800">
        <span className="text-label-sm text-neutral-600 font-mono select-none">$</span>
        <span className="text-label-sm text-neutral-500 font-mono">extraction</span>
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        className="overflow-y-auto px-3 py-2 font-mono text-label-sm leading-relaxed"
        style={{ maxHeight }}
      >
        {entries.map((entry, i) => {
          const isError = /^(failed|error)/i.test(entry.message);
          const isSuccess = /(complete|success|stored)/i.test(entry.message);
          const isWarning = /^warning/i.test(entry.message);
          const time = dayjs(entry.timestamp).format("HH:mm:ss");

          return (
            <div key={i} className="flex gap-2 py-px">
              <span className="text-neutral-600 select-none shrink-0">{time}</span>
              <span
                className={cn(
                  isError ? "text-red-400" :
                  isWarning ? "text-yellow-400" :
                  isSuccess ? "text-emerald-400" :
                  "text-neutral-300"
                )}
              >
                {entry.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
