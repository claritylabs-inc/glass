"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePdf } from "@/components/pdf-context";
import { PdfViewer } from "@/components/ui/pdf-viewer";

const EASE = [0.16, 1, 0.3, 1] as const;

export function PdfPanel() {
  const { isPdfOpen, closePdf, fileUrl, currentPage, navigateToPage, setNumPages, highlightedPage } = usePdf();

  if (!fileUrl) return null;

  return (
    <AnimatePresence mode="popLayout">
      {isPdfOpen && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width: 540 }}
          exit={{ width: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full"
        >
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width: 540 }}
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
