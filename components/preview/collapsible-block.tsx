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
        className="flex items-center gap-2 w-full group cursor-pointer"
      >
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground/40 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
        <span className="text-body-sm font-medium text-muted-foreground/60">
          {title}
        </span>
        {count != null && (
          <span className="text-body-sm text-muted-foreground/40">{count}</span>
        )}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
