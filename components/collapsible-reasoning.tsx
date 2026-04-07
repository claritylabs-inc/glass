"use client";

import { useState } from "react";
import { ChevronDown, BrainCircuit } from "lucide-react";
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
  
  // Don't render if there's no reasoning
  if (!reasoning || reasoning.trim().length === 0) {
    return null;
  }

  // Truncate reasoning for the preview line
  const previewText = reasoning.slice(0, 60).replace(/\n/g, " ");
  const hasMore = reasoning.length > 60;

  return (
    <div className={cn("mt-2", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 w-full group transition-colors",
          "text-muted-foreground/60 hover:text-muted-foreground/80"
        )}
      >
        <div className="flex items-center gap-1.5">
          <BrainCircuit className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">
            {isStreaming ? "Thinking..." : "Thought process"}
          </span>
        </div>
        <div className="flex-1 h-px bg-foreground/5" />
        <ChevronDown 
          className={cn(
            "w-3.5 h-3.5 transition-transform duration-200",
            isOpen && "rotate-180"
          )} 
        />
      </button>
      
      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="rounded-md bg-foreground/[0.03] border border-foreground/5 px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap font-mono">
              {reasoning}
              {isStreaming && (
                <span className="inline-block w-1 h-3 bg-muted-foreground/40 rounded-sm animate-pulse ml-0.5 align-middle" />
              )}
            </p>
          </div>
        </div>
      </div>
      
      {/* Preview line when collapsed */}
      {!isOpen && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/40 truncate">
          {previewText}{hasMore ? "..." : ""}
        </p>
      )}
    </div>
  );
}
