"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PromptReferenceTagKind =
  | "policy"
  | "quote"
  | "requirement"
  | "mailbox";

export function promptReferenceMarker(kind: PromptReferenceTagKind) {
  return kind === "mailbox" ? "/" : "@";
}

export function PromptReferenceTag({
  kind,
  label,
  onRemove,
  className,
}: {
  kind: PromptReferenceTagKind;
  label: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-[min(16rem,100%)] shrink-0 items-center gap-1.5 align-middle rounded-full bg-foreground/5 px-2.5 text-label font-medium text-foreground/75",
        className,
      )}
    >
      <span className="text-muted-foreground/45">
        {promptReferenceMarker(kind)}
      </span>
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          title={`Remove ${label}`}
          className="-mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
