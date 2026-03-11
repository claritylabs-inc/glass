"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";

interface PdfContextValue {
  currentPage: number;
  numPages: number;
  setNumPages: (n: number) => void;
  navigateToPage: (page: number) => void;
  isPdfOpen: boolean;
  togglePdf: () => void;
  openPdf: () => void;
  closePdf: () => void;
  fileUrl: string | null;
  highlightedPage: number | null;
}

const PdfContext = createContext<PdfContextValue | null>(null);

export function PdfProvider({
  fileUrl,
  initialPage,
  children,
}: {
  fileUrl: string | null;
  initialPage?: number;
  children: React.ReactNode;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [isPdfOpen, setIsPdfOpen] = useState(false);
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);

  const navigateToPage = useCallback(
    (page: number) => {
      if (!fileUrl) return;
      const clamped = Math.max(1, Math.min(page, numPages || Infinity));
      setCurrentPage(clamped);
      setIsPdfOpen(true);
      // Persist highlight until a different page is selected
      setHighlightedPage(clamped);
    },
    [fileUrl, numPages]
  );

  const didAutoNav = useRef(false);
  useEffect(() => {
    if (initialPage && fileUrl && !didAutoNav.current) {
      didAutoNav.current = true;
      navigateToPage(initialPage);
    }
  }, [initialPage, fileUrl, navigateToPage]);

  // Auto-open when fileUrl changes from null/different to a new value
  const prevFileUrl = useRef(fileUrl);
  useEffect(() => {
    if (fileUrl && fileUrl !== prevFileUrl.current) {
      setIsPdfOpen(true);
      setCurrentPage(1);
      setHighlightedPage(null);
    }
    prevFileUrl.current = fileUrl;
  }, [fileUrl]);

  const togglePdf = useCallback(() => setIsPdfOpen((v) => !v), []);
  const openPdf = useCallback(() => setIsPdfOpen(true), []);
  const closePdf = useCallback(() => setIsPdfOpen(false), []);

  const value = useMemo(() => ({
    currentPage,
    numPages,
    setNumPages,
    navigateToPage,
    isPdfOpen,
    togglePdf,
    openPdf,
    closePdf,
    fileUrl,
    highlightedPage,
  }), [currentPage, numPages, setNumPages, navigateToPage, isPdfOpen, togglePdf, openPdf, closePdf, fileUrl, highlightedPage]);

  return (
    <PdfContext.Provider value={value}>
      {children}
    </PdfContext.Provider>
  );
}

export function usePdf() {
  const ctx = useContext(PdfContext);
  if (!ctx) throw new Error("usePdf must be used within PdfProvider");
  return ctx;
}
