"use client";

/**
 * Entity preview panel content rendered inside the app shell panel layout.
 * Content components are in components/preview/.
 */

import { useState } from "react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf, type PdfHighlightBox } from "@/components/pdf-context";
import { X } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { PolicyPreview } from "./preview/policy-preview";
import { PillButton } from "@/components/ui/pill-button";

const EASE = [0.2, 0, 0, 1] as const;
type HighlightBox = PdfHighlightBox;

export function EntityPreviewPanel() {
  const { preview, closePreview } = useEntityPreview();
  const reduceMotion = useReducedMotion();
  const [headerInfo, setHeaderInfo] = useState<{
    policyId: string;
    carrier: string;
    policyNum?: string;
  } | null>(null);
  const [footerActions, setFooterActions] = useState<{
    fileUrl?: string;
    policyId: string;
    page?: number;
    highlightBoxes?: HighlightBox[];
  } | null>(null);
  const currentHeaderInfo =
    preview && headerInfo?.policyId === preview.id ? headerInfo : null;
  const currentFooterActions =
    preview && footerActions?.policyId === preview.id ? footerActions : null;

  if (!preview) return null;

  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.1, ease: EASE }}
        className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col border-l border-foreground/6 bg-background"
      >
        {/* Toolbar */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-foreground/6 shrink-0 gap-3">
          <div className="min-w-0 flex-1">
            {currentHeaderInfo ? (
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-base font-medium text-foreground truncate">
                  {currentHeaderInfo.carrier}
                </span>
                {currentHeaderInfo.policyNum && (
                  <span className="min-w-0 max-w-[45%] truncate text-base text-muted-foreground/60">
                    {currentHeaderInfo.policyNum}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-base font-medium text-foreground">
                Policy Preview
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={closePreview}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
          <PolicyPreview
            id={preview.id}
            page={preview.page}
            citedSections={preview.citedSections}
            citedCoverageNames={preview.citedCoverageNames}
            citedSourceSpanIds={preview.citedSourceSpanIds}
            onHeaderInfo={setHeaderInfo}
            onFooterActions={setFooterActions}
          />
        </div>

        {currentFooterActions && (
          <div className="shrink-0 border-t border-foreground/6 px-4 py-3">
            <div className="flex min-w-0 items-center justify-end gap-2">
              <PolicyPreviewButtons
                fileUrl={currentFooterActions.fileUrl}
                policyId={currentFooterActions.policyId}
                page={currentFooterActions.page}
                highlightBoxes={currentFooterActions.highlightBoxes}
              />
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// Separate component to handle the PDF context that requires being inside the provider
function PolicyPreviewButtons({
  fileUrl,
  policyId,
  page,
  highlightBoxes,
}: {
  fileUrl?: string;
  policyId: string;
  page?: number;
  highlightBoxes?: HighlightBox[];
}) {
  const { openWithUrl } = usePdf();

  return (
    <>
      {fileUrl && (
        <PillButton
          size="compact"
          variant="secondary"
          onClick={() => openWithUrl(fileUrl, page, highlightBoxes)}
        >
          View PDF
        </PillButton>
      )}
      <PillButton
        href={`/policies/${policyId}`}
        size="compact"
        variant="secondary"
      >
        Details
      </PillButton>
    </>
  );
}
