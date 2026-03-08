"use client";

import { useEffect, useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, FileText, Download } from "lucide-react";
import { usePdf } from "@/components/pdf-context";
import { PdfViewer } from "@/components/ui/pdf-viewer";

export function PdfModal() {
  const { isPdfOpen, closePdf, fileUrl, currentPage, navigateToPage, numPages, setNumPages, highlightedPage } = usePdf();

  // Track viewport width reactively so the modal shows/hides on resize
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Lock body scroll when open on mobile
  useEffect(() => {
    if (isPdfOpen && isMobile) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isPdfOpen, isMobile]);

  const handleClose = useCallback(() => {
    closePdf();
  }, [closePdf]);

  if (!fileUrl || !isMobile) return null;

  return (
    <AnimatePresence>
      {isPdfOpen && (
        <motion.div
          initial={{ opacity: 0, y: "100%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: "100%" }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden"
          style={{ touchAction: "none" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/6 bg-foreground/[0.02] shrink-0">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Policy PDF
              </span>
              {numPages > 0 && (
                <span className="text-label-sm text-muted-foreground/50">
                  Page {currentPage} of {numPages}
                </span>
              )}
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
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Viewer — flex-1 + min-h-0 + overflow contained inside PdfViewer */}
          <div className="flex-1 min-h-0 overflow-hidden" style={{ touchAction: "pan-y" }}>
            <PdfViewer
              fileUrl={fileUrl}
              currentPage={currentPage}
              highlightedPage={highlightedPage}
              onPageChange={navigateToPage}
              onDocumentLoad={setNumPages}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
