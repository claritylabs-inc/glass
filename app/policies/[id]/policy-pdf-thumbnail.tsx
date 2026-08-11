"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { usePdf } from "@/components/pdf-context";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PolicyPdfThumbnail({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const { openWithUrl } = usePdf();

  return (
    <button
      type="button"
      onClick={() => openWithUrl(url)}
      className="group relative block w-40 shrink-0 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border"
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
      <div className="pointer-events-none absolute inset-0 z-10 rounded-md border border-input bg-transparent transition-[background-color,border-color] duration-150 ease-out group-hover:border-border-hover group-hover:bg-black/6 group-focus-visible:border-border-hover group-focus-visible:bg-black/6" />
    </button>
  );
}
