"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, FileText, Download } from "lucide-react";
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
          className="hidden lg:flex shrink-0 sticky top-21 self-start overflow-hidden"
          style={{ height: "calc(100vh - 6.8rem)" }}
        >
          <motion.div
            initial={{ opacity: 0, x: 40, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 40, filter: "blur(4px)" }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 py-2 pr-1 pl-2"
            style={{ width: 540 }}
          >
            <div className="flex flex-col flex-1 min-h-0 border border-foreground/6 rounded-xl bg-white overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-foreground/4 bg-foreground/[0.02] shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    PDF Viewer
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => window.open(fileUrl, "_blank")}
                    className="p-1.5 rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer"
                    title="Download PDF"
                  >
                    <Download className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button
                    type="button"
                    onClick={closePdf}
                    className="p-1.5 rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              </div>

              {/* Viewer */}
              <PdfViewer
                fileUrl={fileUrl}
                currentPage={currentPage}
                highlightedPage={highlightedPage}
                onPageChange={navigateToPage}
                onDocumentLoad={setNumPages}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
