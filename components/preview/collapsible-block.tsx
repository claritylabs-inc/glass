"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Generic collapsible block with title and optional count badge */
export function CollapsibleBlock({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full group cursor-pointer"
      >
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground/30 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
        <span className="text-label-sm font-medium text-muted-foreground/40 uppercase tracking-wider">
          {title}
        </span>
        {count != null && (
          <span className="text-label-sm text-muted-foreground/25">{count}</span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
