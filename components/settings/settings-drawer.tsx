"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

export function SettingsDrawer({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
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
    },
    [width],
  );

  return (
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={
            isDraggingState ? { duration: 0 } : { duration: 0.4, ease: EASE }
          }
          className="max-lg:!fixed max-lg:!inset-0 max-lg:!z-50 max-lg:!w-full flex shrink-0 overflow-hidden h-full relative"
        >
          <div
            onPointerDown={onPointerDown}
            className="hidden lg:block absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          />

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="max-lg:!w-full flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                {title}
              </span>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {children}
            </div>

            {footer && (
              <div className="border-t border-foreground/6 px-4 py-3 flex flex-col-reverse items-stretch gap-2 shrink-0 lg:flex-row lg:items-center lg:justify-end [&>button]:w-full [&>button]:min-h-8 [&>button]:py-2 lg:[&>button]:w-auto lg:[&>button]:min-h-7 lg:[&>button]:py-1">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
