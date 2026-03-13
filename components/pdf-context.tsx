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
  /** Imperatively open a PDF by URL, optionally jumping to a page */
  openWithUrl: (url: string, page?: number) => void;
}

const PdfContext = createContext<PdfContextValue | null>(null);

export function PdfProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
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
      setHighlightedPage(clamped);
    },
    [fileUrl, numPages]
  );

  const openWithUrl = useCallback((url: string, page?: number) => {
    setFileUrl(url);
    setIsPdfOpen(true);
    setCurrentPage(page ?? 1);
    setHighlightedPage(page ?? null);
    setNumPages(0);
  }, []);

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
    openWithUrl,
  }), [currentPage, numPages, setNumPages, navigateToPage, isPdfOpen, togglePdf, openPdf, closePdf, fileUrl, highlightedPage, openWithUrl]);

  return (
    <PdfContext.Provider value={value}>
      {children}
    </PdfContext.Provider>
  );
}

const NOOP_PDF: PdfContextValue = {
  currentPage: 1,
  numPages: 0,
  setNumPages: () => {},
  navigateToPage: () => {},
  isPdfOpen: false,
  togglePdf: () => {},
  openPdf: () => {},
  closePdf: () => {},
  fileUrl: null,
  highlightedPage: null,
  openWithUrl: () => {},
};

export function usePdf() {
  const ctx = useContext(PdfContext);
  return ctx ?? NOOP_PDF;
}
