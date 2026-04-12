"use client";

/**
 * Entity preview panel shell — resizable sidebar that renders policy or quote previews.
 * Content components are in components/preview/.
 */

import { useState, useRef, useCallback } from "react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PolicyPreview } from "./preview/policy-preview";
import { QuotePreview } from "./preview/quote-preview";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 320;
const MAX_WIDTH = 700;
const DEFAULT_WIDTH = 400;

export function EntityPreviewPanel() {
  const { preview, closePreview } = useEntityPreview();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
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
      {preview && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={isDragging.current ? { duration: 0 } : { duration: 0.4, ease: EASE }}
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
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            {/* Toolbar */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground">
                {preview.type === "policy" ? "Policy" : "Quote"} Preview
              </span>
              <button
                type="button"
                onClick={closePreview}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {preview.type === "policy" && (
                <PolicyPreview id={preview.id} page={preview.page} citedSections={preview.citedSections} />
              )}
              {preview.type === "quote" && (
                <QuotePreview id={preview.id} page={preview.page} citedSections={preview.citedSections} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
