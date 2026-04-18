"use client";

import { useState, useRef, useCallback } from "react";
import { useLogDetail } from "@/hooks/use-log-detail";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import type { LogStatus } from "@/components/structured-log";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 320;
const MAX_WIDTH = 700;
const DEFAULT_WIDTH = 420;

const STATUS_DOT: Record<LogStatus, string> = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  running: "bg-blue-500 animate-pulse",
};

export function LogDetailPanel() {
  const { entry, closeLogDetail } = useLogDetail();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setIsDraggingState(true);
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      setIsDraggingState(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [width]);

  return (
    <AnimatePresence mode="popLayout">
      {entry && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={isDraggingState ? { duration: 0 } : { duration: 0.4, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full relative"
        >
          {/* Resize handle */}
          <div
            onPointerDown={onPointerDown}
            className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize group hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] -translate-x-[1px]" />
          </div>

          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            {/* Header */}
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT[entry.status])} />
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                {entry.event}
              </span>
              <button
                type="button"
                onClick={closeLogDetail}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Key-value fields */}
              <div className="px-4 py-3 space-y-0 border-b border-foreground/6">
                <DetailRow
                  label="Timestamp"
                  value={dayjs(entry.timestamp).format("MMM D, YYYY HH:mm:ss")}
                />
                {entry.detail && (
                  <DetailRow label="Detail" value={entry.detail} />
                )}
              </div>

              {/* Metadata */}
              {entry.meta && Object.keys(entry.meta).length > 0 && (
                <div className="px-4 py-3 border-b border-foreground/6 space-y-0">
                  {Object.entries(entry.meta).map(([key, val]) => {
                    if (val === undefined) return null;
                    return (
                      <DetailRow
                        key={key}
                        label={key}
                        value={String(val)}
                        mono
                      />
                    );
                  })}
                </div>
              )}

              {/* Sub-entries / extraction log */}
              {entry.subEntries && entry.subEntries.length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground/50 mb-2">
                    {entry.subEntries.length} steps
                  </p>
                  <div className="rounded-md bg-foreground/[0.02] border border-foreground/5 overflow-hidden">
                    <div className="max-h-[600px] overflow-y-auto py-1">
                      {entry.subEntries.map((sub, i) => {
                        const dot = STATUS_DOT[sub.status ?? "info"];
                        return (
                          <div
                            key={i}
                            className="flex items-start gap-2 py-1 px-2.5 hover:bg-foreground/[0.02] transition-colors"
                          >
                            <span className="text-xs tabular-nums text-muted-foreground/40 font-mono shrink-0 w-[52px] text-right pt-px">
                              {dayjs(sub.timestamp).format("HH:mm:ss")}
                            </span>
                            <span className={cn("w-1 h-1 rounded-full shrink-0 mt-[5px]", dot)} />
                            <span className="text-xs font-mono text-foreground/60 leading-relaxed break-words min-w-0">
                              {sub.message}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground/50 shrink-0">{label}</span>
      <span className={cn("text-xs text-foreground/80 text-right break-all", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
