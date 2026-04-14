"use client";

import { useState, useEffect } from "react";
import { ChevronDown, BookOpen, ScrollText, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormattedSectionContent } from "./formatted-section-content";

/** Collapsible document section with icon by type and formatted content */
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
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen]);

  const icon =
    type === "endorsement" ? <ScrollText className="w-3 h-3" /> :
    type === "exclusion" ? <AlertTriangle className="w-3 h-3" /> :
    <BookOpen className="w-3 h-3" />;

  return (
    <div className="border border-foreground/6 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-foreground/[0.02] transition-colors cursor-pointer"
      >
        <span className="text-muted-foreground/40">{icon}</span>
        <span className="text-label font-medium text-foreground flex-1 truncate">
          {title || (type === "endorsement" ? "Endorsement" : type === "exclusion" ? "Exclusion" : type === "condition" ? "Condition" : type === "definition" ? "Definition" : "Section")}
        </span>
        {pages && (
          <span className="text-label-sm text-muted-foreground/30 shrink-0">
            p.{pages}
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground/30 transition-transform duration-150 shrink-0",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2.5 border-t border-foreground/4">
          <FormattedSectionContent content={content} />
        </div>
      )}
    </div>
  );
}
