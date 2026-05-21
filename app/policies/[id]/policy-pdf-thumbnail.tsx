"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { usePdf } from "@/components/pdf-context";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export function PolicyPdfThumbnail({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const { openWithUrl } = usePdf();

  return (
    <button
      type="button"
      onClick={() => openWithUrl(url)}
      className="group relative shrink-0 w-40 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15"
      aria-label="Open policy PDF"
    >
      <div className="relative z-0">
        <Document
          file={url}
          loading={<div className="aspect-8.5/11 w-full bg-foreground/5" />}
          error={null}
          onLoadSuccess={() => setLoaded(true)}
        >
          <Page
            pageNumber={1}
            width={160}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className={`transition-opacity duration-100 [&_.react-pdf\_\_Page\_\_canvas]:block [&_.react-pdf\_\_Page\_\_canvas]:w-full! [&_.react-pdf\_\_Page\_\_canvas]:h-auto! ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        </Document>
      </div>
      <div className="pointer-events-none absolute inset-0 z-10 rounded-md border border-foreground/8 transition-colors group-hover:border-foreground/25 group-focus-visible:border-foreground/25" />
    </button>
  );
}
