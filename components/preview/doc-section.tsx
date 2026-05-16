"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormattedSectionContent } from "./formatted-section-content";

/** Collapsible document section with formatted content */
export function DocSection({
  title,
  type,
  pages,
  content,
  defaultOpen = false,
  forceOpen,
}: {
  title: string;
  type?: string;
  pages?: string;
  content: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(forceOpen ?? defaultOpen);
  const prevForceOpen = useRef(forceOpen);

  useEffect(() => {
    if (forceOpen !== undefined && forceOpen !== prevForceOpen.current) {
      prevForceOpen.current = forceOpen;
      // Schedule state update outside the synchronous effect body
      const id = setTimeout(() => setOpen(forceOpen), 0);
      return () => clearTimeout(id);
    }
    prevForceOpen.current = forceOpen;
  }, [forceOpen]);

  const typeLabel = type === "endorsement" ? "Endorsement" : type === "exclusion" ? "Exclusion" : type === "condition" ? "Condition" : type === "definition" ? "Definition" : null;

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-foreground/8 bg-card text-card-foreground">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.03] dark:hover:bg-foreground/[0.06]"
      >
        <span className="text-body-sm font-medium text-foreground flex-1 truncate">
          {title || typeLabel || "Section"}
        </span>
        {pages && (
          <span className="text-body-sm text-muted-foreground/40 shrink-0">
            p.{pages}
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground/40 transition-transform duration-150 shrink-0",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="min-w-0 overflow-x-hidden border-t border-foreground/4 px-3 pb-3 pt-3">
          <FormattedSectionContent content={content} />
        </div>
      )}
    </div>
  );
}
