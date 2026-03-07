"use client";

import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface ScanProgress {
  phase: string;
  totalEmails?: number;
  processedEmails?: number;
  insuranceFound?: number;
  extracting?: number;
  extracted?: number;
}

interface ScanStatusProps {
  status?: "scanning" | "success" | "error" | null;
  error?: string | null;
  progress?: ScanProgress | null;
}

export function ScanStatus({ status, error, progress }: ScanStatusProps) {
  // Show progress-based status when actively scanning
  if (progress && progress.phase !== "complete") {
    const { phase, totalEmails, processedEmails, extracting, extracted } = progress;

    let label = "Scanning...";
    if (phase === "fetching") {
      label = totalEmails != null
        ? `Fetching ${totalEmails} emails...`
        : "Fetching emails...";
    } else if (phase === "classifying") {
      label = processedEmails != null && totalEmails
        ? `Classifying ${processedEmails}/${totalEmails} emails...`
        : "Classifying emails...";
    } else if (phase === "extracting") {
      label = extracting != null
        ? `Extracting ${extracted ?? 0}/${extracting} policies...`
        : "Extracting policies...";
    }

    return (
      <div className="flex items-center gap-2 text-label-sm">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        <span className="text-primary font-medium">{label}</span>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="flex items-center gap-2 text-label-sm">
      {status === "scanning" && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          <span className="text-primary font-medium">Scanning inbox...</span>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          <span className="text-success font-medium">Scan complete</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-destructive" />
          <span className="text-destructive font-medium">
            {error || "Scan failed"}
          </span>
        </>
      )}
    </div>
  );
}
