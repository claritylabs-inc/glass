"use client";

/**
 * Entity preview panel shell — resizable sidebar that renders policy or quote previews.
 * Content components are in components/preview/.
 */

import { useState, useRef, useCallback } from "react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf } from "@/components/pdf-context";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PolicyPreview } from "./preview/policy-preview";
import { PillButton } from "@/components/ui/pill-button";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 320;
const MAX_WIDTH = 700;
const DEFAULT_WIDTH = 400;

export function EntityPreviewPanel() {
  const { preview, closePreview } = useEntityPreview();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);
  const [headerInfo, setHeaderInfo] = useState<{ carrier: string; policyNum?: string } | null>(null);
  const [headerActions, setHeaderActions] = useState<{ fileUrl?: string; policyId: string; page?: number } | null>(null);

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
      {preview && (
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
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            {/* Toolbar */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-foreground/6 shrink-0 gap-3">
              <div className="min-w-0 flex-1">
                {headerInfo ? (
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">
                      {headerInfo.carrier}
                    </span>
                    {headerInfo.policyNum && (
                      <span className="text-sm text-muted-foreground/60 shrink-0">
                        {headerInfo.policyNum}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-sm font-medium text-foreground">
                    Policy Preview
                  </span>
                )}
              </div>
              
              {headerActions && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {headerActions.fileUrl && (
                    <PolicyPreviewButtons 
                      fileUrl={headerActions.fileUrl} 
                      policyId={headerActions.policyId}
                      page={headerActions.page}
                      onClose={closePreview}
                    />
                  )}
                </div>
              )}
              
              <button
                type="button"
                onClick={closePreview}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <PolicyPreview 
                id={preview.id} 
                page={preview.page} 
                citedSections={preview.citedSections}
                citedCoverageNames={preview.citedCoverageNames}
                onHeaderInfo={setHeaderInfo}
                onHeaderActions={setHeaderActions}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Separate component to handle the PDF context that requires being inside the provider
function PolicyPreviewButtons({ fileUrl, policyId, page, onClose }: { fileUrl: string; policyId: string; page?: number; onClose: () => void }) {
  const { openWithUrl } = usePdf();
  
  return (
    <>
      <PillButton
        size="compact"
        variant="secondary"
        onClick={() => { openWithUrl(fileUrl, page); onClose(); }}
      >
        View PDF
      </PillButton>
      <a href={`/policies/${policyId}`} className="no-underline">
        <PillButton size="compact" variant="secondary">Details</PillButton>
      </a>
    </>
  );
}
