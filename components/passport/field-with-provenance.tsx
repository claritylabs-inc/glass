"use client";

import { type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";

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
        <div className="flex items-start gap-1.5 rounded-md bg-foreground/[0.02] px-2 py-1.5 text-xs">
          <LogoIcon size={12} color="#A0D2FA" static className="mt-0.5 shrink-0 opacity-70" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-muted-foreground" title={String(provenance!.suggestedValue)}>
              {hasConflict ? "Different: " : "Suggested: "}
              <span className="font-medium text-foreground">
                {String(provenance!.suggestedValue)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {onAccept && (
              <button
                type="button"
                onClick={onAccept}
                aria-label={hasConflict ? "Replace with suggestion" : "Accept suggestion"}
                title={hasConflict ? "Replace" : "Accept"}
                className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
              >
                <Check className="h-3 w-3" />
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss suggestion"
                title="Dismiss"
                className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
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
