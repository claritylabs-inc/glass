"use client";

import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleReasoningProps {
  reasoning: string;
  isStreaming?: boolean;
  className?: string;
}

export function CollapsibleReasoning({
  reasoning,
  isStreaming = false,
  className
}: CollapsibleReasoningProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Auto-open when streaming starts
  useEffect(() => {
    if (isStreaming && reasoning.length > 0) {
      setIsOpen(true);
    }
  }, [isStreaming, reasoning.length > 0]);

  if (!reasoning || reasoning.trim().length === 0) {
    return null;
  }

  // Count reasoning steps/sentences for the summary
  const lines = reasoning.split(/\n/).filter(l => l.trim().length > 0);
  const stepCount = lines.length;

  return (
    <div className={cn("mt-1.5", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors",
          "text-label-sm text-muted-foreground/50 hover:text-muted-foreground/70",
          "hover:bg-foreground/[0.03]",
          isOpen && "bg-foreground/[0.02]"
        )}
      >
        <ChevronRight
          className={cn(
            "w-3 h-3 transition-transform duration-150",
            isOpen && "rotate-90"
          )}
        />
        {isStreaming ? (
          <span className="flex items-center gap-1.5">
            Thinking
            <span className="flex gap-[2px]">
              <span className="w-[3px] h-[3px] rounded-full bg-current animate-pulse" />
              <span className="w-[3px] h-[3px] rounded-full bg-current animate-pulse [animation-delay:150ms]" />
              <span className="w-[3px] h-[3px] rounded-full bg-current animate-pulse [animation-delay:300ms]" />
            </span>
          </span>
        ) : (
          <span>
            Thought for {stepCount} step{stepCount !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          isOpen ? "max-h-[400px] opacity-100 mt-1.5" : "max-h-0 opacity-0"
        )}
      >
        <div className="ml-2 pl-3 border-l-2 border-foreground/[0.06]">
          <p className="text-label text-muted-foreground/50 leading-relaxed whitespace-pre-wrap">
            {reasoning}
            {isStreaming && (
              <span className="inline-block w-[3px] h-[14px] bg-muted-foreground/30 rounded-[1px] animate-pulse ml-0.5 align-middle" />
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
