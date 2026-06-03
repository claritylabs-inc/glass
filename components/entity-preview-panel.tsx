"use client";

/**
 * Entity preview panel shell — resizable sidebar that renders policy or quote previews.
 * Content components are in components/preview/.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf, type PdfHighlightBox } from "@/components/pdf-context";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PolicyPreview } from "./preview/policy-preview";
import { PillButton } from "@/components/ui/pill-button";

const EASE = [0.2, 0, 0, 1] as const;
const MIN_WIDTH = 320;
const MAX_WIDTH = 700;
const DEFAULT_WIDTH = 400;
type HighlightBox = PdfHighlightBox;

export function EntityPreviewPanel({
  fitContainer = false,
}: {
  fitContainer?: boolean;
}) {
  const { preview, closePreview } = useEntityPreview();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);
  const widthRef = useRef(DEFAULT_WIDTH);
  const dragFrame = useRef<number | null>(null);
  const pendingWidth = useRef<number | null>(null);
  const [headerInfo, setHeaderInfo] = useState<{
    carrier: string;
    policyNum?: string;
  } | null>(null);
  const [headerActions, setHeaderActions] = useState<{
    fileUrl?: string;
    policyId: string;
    page?: number;
    highlightBoxes?: HighlightBox[];
  } | null>(null);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setIsDraggingState(true);
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX;
      const nextWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + delta),
      );
      if (nextWidth === widthRef.current) return;
      pendingWidth.current = nextWidth;
      if (dragFrame.current !== null) return;
      dragFrame.current = window.requestAnimationFrame(() => {
        dragFrame.current = null;
        const widthToApply = pendingWidth.current;
        pendingWidth.current = null;
        if (widthToApply == null || widthToApply === widthRef.current) return;
        widthRef.current = widthToApply;
        setWidth(widthToApply);
      });
    };
    const onUp = () => {
      isDragging.current = false;
      setIsDraggingState(false);
      if (dragFrame.current !== null) {
        window.cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      pendingWidth.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  return (
    <AnimatePresence mode="popLayout">
      {preview && (
        <motion.div
          initial={fitContainer ? false : { width: 0 }}
          animate={fitContainer ? { width: "100%" } : { width }}
          exit={fitContainer ? undefined : { width: 0 }}
          transition={
            isDraggingState ? { duration: 0 } : { duration: 0.12, ease: EASE }
          }
          className={`flex h-full overflow-hidden relative ${fitContainer ? "min-w-0 w-full max-w-full flex-1" : "shrink-0"}`}
        >
          {/* Resize handle */}
          {!fitContainer && (
            <div
              onPointerDown={onPointerDown}
              className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize group hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
            >
              <div className="absolute left-0 top-0 bottom-0 w-0.75 -translate-x-px" />
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.1, ease: EASE }}
            className="flex min-w-0 max-w-full flex-1 flex-col min-h-0 border-l border-foreground/6 bg-background"
            style={fitContainer ? undefined : { width }}
          >
            {/* Toolbar */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-foreground/6 shrink-0 gap-3">
              <div className="min-w-0 flex-1">
                {headerInfo ? (
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-base font-medium text-foreground truncate">
                      {headerInfo.carrier}
                    </span>
                    {headerInfo.policyNum && (
                      <span className="min-w-0 max-w-[45%] truncate text-base text-muted-foreground/60">
                        {headerInfo.policyNum}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-base font-medium text-foreground">
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
                    />
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={closePreview}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
              <PolicyPreview
                id={preview.id}
                page={preview.page}
                citedSections={preview.citedSections}
                citedCoverageNames={preview.citedCoverageNames}
                citedSourceSpanIds={preview.citedSourceSpanIds}
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
function PolicyPreviewButtons({
  fileUrl,
  policyId,
  page,
  highlightBoxes,
}: {
  fileUrl: string;
  policyId: string;
  page?: number;
  highlightBoxes?: HighlightBox[];
}) {
  const { openWithUrl } = usePdf();

  return (
    <>
      <PillButton
        size="compact"
        variant="secondary"
        onClick={() => openWithUrl(fileUrl, page, highlightBoxes)}
      >
        View PDF
      </PillButton>
      <a href={`/policies/${policyId}`} className="no-underline">
        <PillButton size="compact" variant="secondary">
          Details
        </PillButton>
      </a>
    </>
  );
}
