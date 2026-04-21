"use client";

import { type ReactNode } from "react";
import { Check, X } from "lucide-react";

export type ProvenanceRow = {
  fieldPath: string;
  confidence: "confirmed" | "suggested";
  suggestedValue?: unknown;
  sourceLabel?: string;
};

interface FieldWithProvenanceProps {
  fieldPath: string;
  currentValue: unknown;
  provenance?: ProvenanceRow;
  onAccept?: () => void;
  onDismiss?: () => void;
  children: ReactNode;
  label: string;
}

export function FieldWithProvenance({
  fieldPath: _fieldPath,
  currentValue,
  provenance,
  onAccept,
  onDismiss,
  children,
  label,
}: FieldWithProvenanceProps) {
  const hasSuggestion =
    provenance?.confidence === "suggested" && provenance.suggestedValue !== undefined;
  const hasConflict =
    hasSuggestion &&
    currentValue !== undefined &&
    currentValue !== "" &&
    currentValue !== provenance.suggestedValue;

  return (
    <div className="space-y-1.5">
      <label className="text-label-sm font-medium text-muted-foreground block">
        {label}
      </label>
      {children}
      {hasSuggestion && (
        <div className="flex items-start gap-2 rounded-md border border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-sm">
          <div className="flex-1 min-w-0">
            {hasConflict ? (
              <span className="text-muted-foreground">
                Different value detected:{" "}
                <span className="font-medium text-foreground">
                  {String(provenance!.suggestedValue)}
                </span>
                {provenance?.sourceLabel ? ` (source: ${provenance.sourceLabel})` : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Suggested:{" "}
                <span className="font-medium text-foreground">
                  {String(provenance!.suggestedValue)}
                </span>
                {provenance?.sourceLabel ? ` — ${provenance.sourceLabel}` : ""}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onAccept && (
              <button
                type="button"
                onClick={onAccept}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-foreground hover:bg-foreground/5 transition-colors"
              >
                <Check className="h-3 w-3" />
                {hasConflict ? "Replace" : "Accept"}
              </button>
            )}
            {hasConflict && onAccept && (
              <button
                type="button"
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-foreground/5 transition-colors"
              >
                Keep current
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-foreground/5 transition-colors"
                aria-label="Dismiss suggestion"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
