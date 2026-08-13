"use client";

import { memo, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  Wrench,
} from "lucide-react";
import type { AgentStep, AgentToolStep } from "@/convex/lib/agentSteps";
import {
  TOOL_DISPLAY_NAMES,
  ToolCallCard,
} from "@/components/agent-thread/tool-call-card";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

export type AgentActivityItem = { kind: "tool"; step: AgentToolStep };

/**
 * Customer-visible timeline of tool calls in stream order. Provider reasoning
 * is never rendered: it can repeat hidden prompt instructions and is not an
 * auditable product action. Older messages fall back to their tool-call list.
 */
export function buildAgentActivityItems(
  steps: AgentStep[] | undefined,
  fallbackToolCalls?: { name: string; input?: string; output?: string }[],
): AgentActivityItem[] {
  const orderedTools = steps?.filter(
    (step): step is AgentToolStep => step.type === "tool",
  );
  const tools = orderedTools?.length
    ? orderedTools
    : (fallbackToolCalls ?? []).map(
        (toolCall): AgentToolStep => ({
          type: "tool",
          completed: true,
          ...toolCall,
        }),
      );
  return tools.map((step) => ({ kind: "tool", step }));
}

function itemLabel(item: AgentActivityItem) {
  return TOOL_DISPLAY_NAMES[item.step.name] ?? item.step.name;
}

interface AgentActivityProps {
  steps?: AgentStep[];
  /** Legacy messages saved without `agentSteps`: used for tool-call fallback. */
  fallbackToolCalls?: { name: string; input?: string; output?: string }[];
  isStreaming?: boolean;
  className?: string;
}

export const AgentActivity = memo(function AgentActivity({
  steps,
  fallbackToolCalls,
  isStreaming = false,
  className,
}: AgentActivityProps) {
  const [isOpen, setIsOpen] = useState(false);

  const items = useMemo(
    () => buildAgentActivityItems(steps, fallbackToolCalls),
    [fallbackToolCalls, steps],
  );
  if (items.length === 0) return null;

  // While streaming, surface the latest tool; when done, lead with the first.
  const summary = isStreaming
    ? itemLabel(items[items.length - 1])
    : itemLabel(items[0]);

  return (
    <div className={cn(`mt-1.5 text-muted-foreground/55 ${typeStyle("caption.default")}`, className)}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className={cn(
          `group flex max-w-full items-center gap-1.5 text-left transition-colors ${typeStyle("control.button")}`,
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
        {!isStreaming && items.length > 1 ? (
          <span className="shrink-0 text-muted-foreground/30">
            {items.length} steps
          </span>
        ) : null}
      </button>

      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity,margin] duration-150 ease-out motion-reduce:transition-none",
          isOpen ? "mt-2 max-h-96 opacity-100" : "mt-0 max-h-0 opacity-0",
        )}
      >
        <div className="ml-[5px] max-h-96 overflow-y-auto border-l border-border-emphasized pl-4">
          <div className="space-y-3">
            {items.map((item, index) =>
                <div key={index} className="flex gap-2">
                  <Wrench className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
                  <div className="min-w-0 flex-1">
                    <ToolCallCard
                      toolCall={item.step}
                      index={index}
                      showOutput={Boolean(item.step.output)}
                      isRunning={isStreaming && !item.step.completed}
                    />
                  </div>
                </div>
            )}
            {!isStreaming ? (
              <div className={`flex items-center gap-2 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />
                <span>Done</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
