import { CircleAlert, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AutoSaveStatus as AutoSaveStatusValue } from "@/lib/sync/use-local-first-auto-save";

const STATUS_LABELS: Record<AutoSaveStatusValue, string> = {
  saved: "Saved",
  saving: "Saving",
  unsaved: "Unsaved",
  error: "Not saved",
};

function AutoSaveStatus({
  status,
  className,
}: {
  status: AutoSaveStatusValue;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-status={status}
      className={cn(
        "inline-flex min-w-20 shrink-0 items-center justify-end gap-1.5 whitespace-nowrap text-label text-muted-foreground",
        status === "error" && "text-destructive",
        className,
      )}
    >
      {status === "saving" ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : status === "saved" ? (
        <Check className="size-3" aria-hidden="true" />
      ) : status === "error" ? (
        <CircleAlert className="size-3" aria-hidden="true" />
      ) : null}
      {STATUS_LABELS[status]}
    </span>
  );
}

function combineAutoSaveStatuses(
  ...statuses: AutoSaveStatusValue[]
): AutoSaveStatusValue {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("saving")) return "saving";
  if (statuses.includes("unsaved")) return "unsaved";
  return "saved";
}

export { AutoSaveStatus, combineAutoSaveStatuses };
