"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePdf } from "@/components/pdf-context";
import { PdfViewer } from "@/components/ui/pdf-viewer";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 540;

export function PdfPanel({ fitContainer = false }: { fitContainer?: boolean }) {
  const { isPdfOpen, closePdf, fileUrl, currentPage, navigateToPage, setNumPages, highlightedPage } = usePdf();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);
  const widthRef = useRef(DEFAULT_WIDTH);
  const dragFrame = useRef<number | null>(null);
  const pendingWidth = useRef<number | null>(null);

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
      const delta = startX - ev.clientX; // dragging left = wider
      const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
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

  if (!fileUrl) return null;

  return (
    <AnimatePresence mode="popLayout">
      {isPdfOpen && (
        <motion.div
          layout
          initial={fitContainer ? false : { width: 0 }}
          animate={fitContainer ? { width: "100%" } : { width }}
          exit={fitContainer ? undefined : { width: 0 }}
          transition={isDraggingState ? { duration: 0 } : { duration: 0.5, ease: EASE }}
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
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}
            className="flex min-w-0 max-w-full flex-1 flex-col min-h-0 border-l border-foreground/6 bg-background"
            style={fitContainer ? undefined : { width }}
          >
            <PdfViewer
              fileUrl={fileUrl}
              currentPage={currentPage}
              highlightedPage={highlightedPage}
              onPageChange={navigateToPage}
              onDocumentLoad={setNumPages}
              onClose={closePdf}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
