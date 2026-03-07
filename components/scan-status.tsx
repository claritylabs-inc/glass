"use client";

import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface ScanStatusProps {
  status?: "scanning" | "success" | "error" | null;
  error?: string | null;
}

export function ScanStatus({ status, error }: ScanStatusProps) {
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
