"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { RotateCw, FileText, Sparkles, Wand2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface RetryExtractionModalProps {
  policyId: string;
  hasRawResponse: boolean;
  hasRawMetadata: boolean;
  hasDocument: boolean;
  trigger: React.ReactNode;
  onComplete?: () => void;
}

export function RetryExtractionModal({
  policyId,
  hasRawResponse,
  hasRawMetadata,
  hasDocument,
  trigger,
  onComplete,
}: RetryExtractionModalProps) {
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const handleRetry = async (mode: "reparse" | "enrich_only" | "sections_only" | "full") => {
    setOpen(false);
    setRunning(true);
    try {
      await retryExtraction({ policyId: policyId as Id<"policies">, mode });
      onComplete?.();
    } finally {
      setRunning(false);
    }
  };

  const options: Array<{
    mode: "reparse" | "enrich_only" | "sections_only" | "full";
    icon: typeof FileText;
    title: string;
    description: string;
    show: boolean;
  }> = [
    {
      mode: "reparse",
      icon: FileText,
      title: "Re-parse saved output",
      description: "Re-read the saved AI response without making any API calls.",
      show: hasRawResponse,
    },
    {
      mode: "enrich_only",
      icon: Wand2,
      title: "Enrich details only",
      description: "Structure regulatory, complaint, fees, and claims fields from existing text.",
      show: hasDocument,
    },
    {
      mode: "sections_only",
      icon: RotateCw,
      title: "Re-extract sections",
      description: "Re-run section extraction and enrichment, keeping existing metadata.",
      show: hasRawMetadata,
    },
    {
      mode: "full",
      icon: Sparkles,
      title: "Full re-extraction",
      description: "Re-download the PDF and re-run the entire extraction pipeline.",
      show: true,
    },
  ];

  const visibleOptions = options.filter((o) => o.show);

  return (
    <>
      <span onClick={() => !running && setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Re-extract Policy</DialogTitle>
            <DialogDescription>
              Choose how to re-extract policy data from this document.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {visibleOptions.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                onClick={() => handleRetry(opt.mode)}
                className="flex items-start gap-3 rounded-lg border border-foreground/8 p-3 text-left hover:bg-foreground/[0.02] hover:border-foreground/15 transition-colors cursor-pointer"
              >
                <opt.icon className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-body-sm font-medium text-foreground">{opt.title}</p>
                  <p className="text-label-sm text-muted-foreground">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
