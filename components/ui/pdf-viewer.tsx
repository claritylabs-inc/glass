"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, Loader2, AlertTriangle } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  fileUrl: string;
  currentPage: number;
  highlightedPage: number | null;
  onPageChange: (page: number) => void;
  onDocumentLoad: (numPages: number) => void;
}

const RENDER_BUFFER = 2;
const PAGE_GAP = 12; // mb-3 = 0.75rem = 12px

type PageDims = Map<number, { width: number; height: number }>;

/** Compute scaled page height from intrinsic dimensions */
function getPageHeight(page: number, pageWidth: number | undefined, dims: PageDims): number {
  if (!pageWidth) return 792;
  const d = dims.get(page);
  if (!d) return 792;
  return (d.height / d.width) * pageWidth;
}

/** Compute scroll offset to the top of a target page using cached dimensions */
function computeScrollOffset(targetPage: number, pageWidth: number, dims: PageDims, gap: number, containerPadding: number): number {
  let offset = 0;
  for (let p = 1; p < targetPage; p++) {
    offset += getPageHeight(p, pageWidth, dims) + gap;
  }
  // The container has padding at the top, and pages start after that padding.
  // scrollTop=0 means we're at the top of the padded area, so no need to add padding.
  return offset;
}

/** Find which page is visible at a given scroll position */
function findVisiblePage(scrollTop: number, viewportHeight: number, numPages: number, pageWidth: number, dims: PageDims, gap: number): number {
  const scrollCenter = scrollTop + viewportHeight / 3; // bias toward top
  let offset = 0;
  for (let p = 1; p <= numPages; p++) {
    const h = getPageHeight(p, pageWidth, dims);
    const pageTop = offset;
    const pageBottom = offset + h;
    // If scroll center is within this page, it's the visible one
    if (scrollCenter >= pageTop && scrollCenter < pageBottom + gap) {
      return p;
    }
    offset = pageBottom + gap;
  }
  return numPages;
}

export function PdfViewer({
  fileUrl,
  currentPage,
  highlightedPage,
  onPageChange,
  onDocumentLoad,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [visiblePage, setVisiblePage] = useState(1);
  const [pageDimensions, setPageDimensions] = useState<PageDims>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollingToPage = useRef<number | null>(null);
  const visiblePageRef = useRef(1);
  const [pageInput, setPageInput] = useState(String(currentPage));

  // Keep ref in sync
  useEffect(() => {
    visiblePageRef.current = visiblePage;
  }, [visiblePage]);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scroll to page when currentPage changes (from click or toolbar)
  useEffect(() => {
    if (!numPages || !containerRef.current) return;
    const container = containerRef.current;
    const pw = pageWidth;

    if (!pw || pageDimensions.size === 0) {
      // Dimensions not loaded yet — try DOM-based fallback
      const pageEl = pageRefs.current.get(currentPage);
      if (pageEl) {
        const elRect = pageEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
        const targetTop = elRect.top - containerRect.top + container.scrollTop - paddingTop;
        const diff = Math.abs(container.scrollTop - targetTop);
        if (diff > 10) {
          scrollingToPage.current = currentPage;
          container.scrollTo({ top: targetTop, behavior: "smooth" });
          clearScrollFlag(container);
        }
      }
    } else {
      // Use arithmetic offset
      const targetTop = computeScrollOffset(currentPage, pw, pageDimensions, PAGE_GAP, 0);
      const diff = Math.abs(container.scrollTop - targetTop);
      if (diff > 10) {
        scrollingToPage.current = currentPage;
        const viewportH = container.clientHeight;
        const isDistant = diff > viewportH * 2;

        if (isDistant) {
          // Instant jump for distant pages, then micro-correct
          container.scrollTo({ top: targetTop, behavior: "instant" });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // Micro-correct using actual DOM position if the page is now rendered
              const pageEl = pageRefs.current.get(currentPage);
              if (pageEl) {
                const elRect = pageEl.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
                const corrected = elRect.top - containerRect.top + container.scrollTop - paddingTop;
                const corrDiff = Math.abs(container.scrollTop - corrected);
                if (corrDiff > 2) {
                  container.scrollTo({ top: corrected, behavior: "instant" });
                }
              }
              scrollingToPage.current = null;
            });
          });
        } else {
          container.scrollTo({ top: targetTop, behavior: "smooth" });
          clearScrollFlag(container);
        }
      }
    }

    setPageInput(String(currentPage));
    setVisiblePage(currentPage);
  }, [currentPage, numPages, pageDimensions.size]);

  /** Clear scrollingToPage flag using scrollend event with fallback */
  function clearScrollFlag(container: HTMLElement) {
    let cleared = false;
    const cleanup = () => {
      if (cleared) return;
      cleared = true;
      scrollingToPage.current = null;
      container.removeEventListener("scrollend", onScrollEnd);
    };
    const onScrollEnd = () => cleanup();
    container.addEventListener("scrollend", onScrollEnd, { once: true });
    // Fallback timeout in case scrollend isn't fired
    setTimeout(cleanup, 2000);
  }

  // Detect visible page on manual scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !numPages) return;

    const handleScroll = () => {
      if (scrollingToPage.current !== null) return;
      const pw = pageWidth;

      if (pw && pageDimensions.size > 0) {
        // Arithmetic-based detection
        const page = findVisiblePage(container.scrollTop, container.clientHeight, numPages, pw, pageDimensions, PAGE_GAP);
        if (page !== visiblePageRef.current) {
          visiblePageRef.current = page;
          setVisiblePage(page);
          setPageInput(String(page));
        }
      } else {
        // DOM-based fallback
        const scrollCenter = container.scrollTop + container.clientHeight / 3;
        let closest = 1;
        let closestDist = Infinity;
        for (const [page, el] of pageRefs.current) {
          const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
          const dist = Math.abs(elTop - scrollCenter);
          if (dist < closestDist) {
            closestDist = dist;
            closest = page;
          }
        }
        if (closest !== visiblePageRef.current) {
          visiblePageRef.current = closest;
          setVisiblePage(closest);
          setPageInput(String(closest));
        }
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [numPages, pageDimensions]);

  // Zoom preservation: when scale changes, keep current page in view
  const prevScaleRef = useRef(scale);
  useEffect(() => {
    if (prevScaleRef.current !== scale && numPages > 0) {
      const pageToRestore = visiblePageRef.current;
      prevScaleRef.current = scale;
      // After layout updates, scroll back to the same page
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = containerRef.current;
          const pw = pageWidth;
          if (!container || !pw) return;
          if (pageDimensions.size > 0) {
            const targetTop = computeScrollOffset(pageToRestore, pw, pageDimensions, PAGE_GAP, 0);
            container.scrollTo({ top: targetTop, behavior: "instant" });
          } else {
            const pageEl = pageRefs.current.get(pageToRestore);
            if (pageEl) {
              const elRect = pageEl.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
              const targetTop = elRect.top - containerRect.top + container.scrollTop - paddingTop;
              container.scrollTo({ top: targetTop, behavior: "instant" });
            }
          }
        });
      });
    }
  }, [scale, numPages, pageDimensions]);

  const handleDocumentLoad = useCallback(
    (pdf: any) => {
      const n = pdf.numPages;
      setNumPages(n);
      setError(null);
      onDocumentLoad(n);
      // Pre-fetch page dimensions from PDF metadata
      (async () => {
        const dims: PageDims = new Map();
        await Promise.all(
          Array.from({ length: n }, (_, i) =>
            pdf.getPage(i + 1).then((page: any) => {
              const vp = page.getViewport({ scale: 1 });
              dims.set(i + 1, { width: vp.width, height: vp.height });
            })
          )
        );
        setPageDimensions(dims);
      })();
    },
    [onDocumentLoad]
  );

  const handleLoadError = useCallback(() => {
    setError("Failed to load PDF");
  }, []);

  // Navigate via toolbar buttons or page input
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages));
      onPageChange(clamped);
    },
    [numPages, onPageChange]
  );

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= numPages) {
      goToPage(page);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

  const pageWidth = containerWidth > 0 ? (containerWidth - 24) * scale : undefined;

  const displayPage = scrollingToPage.current !== null ? currentPage : visiblePage;

  const shouldRenderPage = (page: number) => {
    return Math.abs(page - displayPage) <= RENDER_BUFFER;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-foreground/6 bg-foreground/[0.02] shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToPage(displayPage - 1)}
            disabled={displayPage <= 1}
            className="p-1 rounded hover:bg-foreground/5 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => goToPage(displayPage + 1)}
            disabled={displayPage >= numPages}
            className="p-1 rounded hover:bg-foreground/5 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1 ml-1">
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              className="w-10 text-center text-label-sm border border-foreground/10 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-foreground/20"
            />
            <span className="text-label-sm text-muted-foreground">/ {numPages || "—"}</span>
          </form>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="p-1 rounded hover:bg-foreground/5 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-label-sm text-muted-foreground w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= 3}
            className="p-1 rounded hover:bg-foreground/5 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PDF content */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto bg-neutral-100/80 p-3 -webkit-overflow-scrolling-touch" style={{ overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-body-sm">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
              }}
              className="text-label-sm text-blue-600 hover:underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={handleDocumentLoad}
            onLoadError={handleLoadError}
            loading={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => {
              const h = getPageHeight(page, pageWidth, pageDimensions);
              return (
                <div
                  key={page}
                  ref={(el) => {
                    if (el) pageRefs.current.set(page, el);
                    else pageRefs.current.delete(page);
                  }}
                  data-page={page}
                  className="mb-3 last:mb-0 mx-auto relative"
                  style={{ width: pageWidth ? `${pageWidth}px` : "100%" }}
                >
                  {/* Highlight overlay */}
                  {highlightedPage === page && (
                    <div
                      className="absolute inset-0 z-10 pointer-events-none rounded-sm"
                      style={{
                        boxShadow: "inset 0 0 0 2px rgba(59, 130, 246, 0.5)",
                        backgroundColor: "rgba(59, 130, 246, 0.04)",
                      }}
                    />
                  )}
                  {shouldRenderPage(page) ? (
                    <Page
                      pageNumber={page}
                      width={pageWidth}
                      loading={
                        <div
                          className="flex items-center justify-center bg-white"
                          style={{ height: h, width: pageWidth }}
                        >
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div
                      className="bg-white"
                      style={{ height: h, width: pageWidth }}
                    />
                  )}
                </div>
              );
            })}
          </Document>
        )}
      </div>
    </div>
  );
}
