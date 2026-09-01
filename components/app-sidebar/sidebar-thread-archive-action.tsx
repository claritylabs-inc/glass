"use client";

import { Archive, Loader2 } from "lucide-react";

export function SidebarThreadArchiveAction({
  disabled = false,
  pending = false,
  onArchive,
}: {
  disabled?: boolean;
  pending?: boolean;
  onArchive: () => void | Promise<void>;
}) {
  return (
    <span className="relative h-5 w-5 shrink-0">
      <button
        type="button"
        aria-label="Archive thread"
        title="Archive"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void onArchive();
        }}
        className="absolute inset-0 flex items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-[background-color,color,opacity] duration-100 hover:bg-foreground/6 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Archive className="size-3" />
        )}
      </button>
    </span>
  );
}
