"use client";

import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePdf } from "@/components/pdf-context";
import { PdfViewer } from "@/components/ui/pdf-viewer";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 540;

export function PdfPanel() {
  const { isPdfOpen, closePdf, fileUrl, currentPage, navigateToPage, setNumPages, highlightedPage } = usePdf();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX; // dragging left = wider
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

  if (!fileUrl) return null;

  return (
    <AnimatePresence mode="popLayout">
      {isPdfOpen && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={isDragging.current ? { duration: 0 } : { duration: 0.5, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full relative"
        >
          {/* Resize handle */}
          <div
            onPointerDown={onPointerDown}
            className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize group hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] -translate-x-[1px] " />
          </div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
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
