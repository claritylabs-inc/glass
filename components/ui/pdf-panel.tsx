"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePdf } from "@/components/pdf-context";
import { PdfViewer } from "@/components/ui/pdf-viewer";

const EASE = [0.2, 0, 0, 1] as const;
export function PdfPanel() {
  const {
    isPdfOpen,
    closePdf,
    fileUrl,
    currentPage,
    navigateToPage,
    setNumPages,
    highlightedPage,
    highlightBoxes,
  } = usePdf();
  const reduceMotion = useReducedMotion();

  if (!fileUrl || !isPdfOpen) return null;

  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.1, ease: EASE }}
        className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col border-l border-foreground/6 bg-background"
      >
        <PdfViewer
          fileUrl={fileUrl}
          currentPage={currentPage}
          highlightedPage={highlightedPage}
          highlightBoxes={highlightBoxes}
          onPageChange={navigateToPage}
          onDocumentLoad={setNumPages}
          onClose={closePdf}
        />
      </motion.div>
    </div>
  );
}
