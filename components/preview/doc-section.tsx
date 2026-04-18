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
    <div className="border border-foreground/8 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-secondary/50 transition-colors cursor-pointer"
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
        <div className="px-3 pb-3 pt-3 border-t border-foreground/4">
          <FormattedSectionContent content={content} />
        </div>
      )}
    </div>
  );
}
