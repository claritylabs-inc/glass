"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PretextText } from "@/components/pretext-text";

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
          "border-foreground/8 bg-foreground/[0.02] text-[11px] leading-none text-muted-foreground/55",
          "hover:border-foreground/12 hover:bg-foreground/[0.04] hover:text-muted-foreground/80",
          isOpen && "border-foreground/12 bg-foreground/[0.045] text-muted-foreground/80"
        )}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            !isOpen && "-rotate-90"
          )}
        />
        {isStreaming ? (
          <span className="flex items-center gap-1.5">
            Thinking
            <span className="flex items-center gap-[2px]">
              <span className="h-[3px] w-[3px] rounded-full bg-current animate-pulse" />
              <span className="h-[3px] w-[3px] rounded-full bg-current animate-pulse [animation-delay:150ms]" />
              <span className="h-[3px] w-[3px] rounded-full bg-current animate-pulse [animation-delay:300ms]" />
            </span>
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
          "overflow-hidden transition-[max-height,opacity,margin] duration-200 ease-out",
          isOpen ? "mt-2 max-h-64 opacity-100" : "mt-0 max-h-0 opacity-0"
        )}
      >
        <div className="max-h-64 overflow-y-auto rounded-lg border border-foreground/8 bg-foreground/[0.025] px-3 pt-2 pb-1.5 shadow-sm shadow-black/[0.02]">
          <div className="space-y-1.5 text-[13px] leading-5 text-muted-foreground/70">
            {lines.map((line, index) => (
              <PretextText
                key={`${index}-${line.slice(0, 16)}`}
                as="p"
                text={line}
                whiteSpace="pre-wrap"
              />
            ))}
            {isStreaming && (
              <span className="inline-block h-3.5 w-[3px] rounded-[1px] bg-muted-foreground/35 align-middle animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
