"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Clock3, Loader2 } from "lucide-react";
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
  const summary = lines[0] ?? (isStreaming ? "Thinking" : "Reasoning");
  const detailLines = lines.length > 1 ? lines.slice(1) : lines;

  return (
    <div className={cn("mt-1.5 text-label text-muted-foreground/55", className)}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className={cn(
          "group flex max-w-full items-center gap-1.5 text-left leading-5 transition-colors",
          "text-muted-foreground/50 hover:text-muted-foreground/75",
          isOpen && "text-muted-foreground/75",
        )}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-150",
            !isOpen && "-rotate-90",
          )}
        />
        {isStreaming ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : null}
        <span className="min-w-0 truncate">{summary}</span>
        {!isStreaming && lines.length > 1 ? (
          <span className="shrink-0 text-muted-foreground/30">
            {lines.length - 1} detail{lines.length === 2 ? "" : "s"}
          </span>
        ) : null}
      </button>

      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity,margin] duration-150 ease-out motion-reduce:transition-none",
          isOpen ? "mt-2 max-h-72 opacity-100" : "mt-0 max-h-0 opacity-0",
        )}
      >
        <div className="ml-[5px] max-h-72 overflow-y-auto border-l border-foreground/10 pl-4">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
              <div className="space-y-1.5 text-base leading-5 text-muted-foreground/70">
                {detailLines.map((line, index) => (
                  <p
                    key={`${index}-${line.slice(0, 16)}`}
                    className="whitespace-pre-wrap wrap-break-word wrap-anywhere"
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
            {!isStreaming ? (
              <div className="flex items-center gap-2 text-label leading-5 text-muted-foreground/55">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />
                <span>Done</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
