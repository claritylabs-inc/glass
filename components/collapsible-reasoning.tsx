"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleReasoningProps {
  reasoning: string;
  isStreaming?: boolean;
  className?: string;
}

export function CollapsibleReasoning({
  reasoning,
  isStreaming = false,
  className,
}: CollapsibleReasoningProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!reasoning || reasoning.trim().length === 0) {
    return null;
  }

  const lines = reasoning.split(/\n+/).filter((line) => line.trim().length > 0);
  const stepCount = lines.length;

  return (
    <div className={cn("mt-1.5", className)}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 transition-colors",
          "border-foreground/8 bg-foreground/2 text-label leading-none text-muted-foreground/55",
          "hover:border-foreground/12 hover:bg-foreground/4 hover:text-muted-foreground/80",
          isOpen &&
            "border-foreground/12 bg-foreground/4.5 text-muted-foreground/80",
        )}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            !isOpen && "-rotate-90",
          )}
        />
        {isStreaming ? (
          <span className="flex items-center gap-1.5">
            Thinking
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        ) : (
          <span>Reasoning</span>
        )}
        {!isStreaming && (
          <span className="text-muted-foreground/35">
            {stepCount} step{stepCount !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity,margin] duration-100 ease-out",
          isOpen ? "mt-2 max-h-64 opacity-100" : "mt-0 max-h-0 opacity-0",
        )}
      >
        <div className="max-h-64 overflow-y-auto rounded-lg border border-foreground/8 bg-foreground/2.5 px-3 pt-2 pb-1.5 shadow-sm shadow-black/2">
          <div className="space-y-1.5 text-base leading-5 text-muted-foreground/70">
            {lines.map((line, index) => (
              <p
                key={`${index}-${line.slice(0, 16)}`}
                className="whitespace-pre-wrap wrap-break-word wrap-anywhere"
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
