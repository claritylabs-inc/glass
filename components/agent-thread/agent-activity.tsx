"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  Wrench,
} from "lucide-react";
import type { AgentStep, AgentToolStep } from "@/convex/lib/agentSteps";
import {
  TOOL_DISPLAY_NAMES,
  ToolCallCard,
} from "@/components/agent-thread/tool-call-card";
import { getReasoningDisclosureLines } from "@/lib/reasoning-format";
import { cn } from "@/lib/utils";

export type AgentActivityItem =
  | { kind: "thought"; paragraphs: string[] }
  | { kind: "tool"; step: AgentToolStep };

function thoughtParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  return getReasoningDisclosureLines(text);
}

/**
 * Interleaved timeline of thinking segments and tool calls, in stream order.
 * Messages saved before `agentSteps` existed fall back to the legacy
 * concatenated `reasoning` string rendered as a single thought, followed by
 * their unordered tool calls.
 */
export function buildAgentActivityItems(
  steps: AgentStep[] | undefined,
  reasoning: string,
  fallbackToolCalls?: { name: string; input?: string; output?: string }[],
): AgentActivityItem[] {
  const source: AgentStep[] = steps?.length
    ? steps
    : [
        ...(reasoning.trim()
          ? [{ type: "reasoning", text: reasoning } as const]
          : []),
        ...(fallbackToolCalls ?? []).map(
          (toolCall) =>
            ({ type: "tool", completed: true, ...toolCall }) as const,
        ),
      ];
  return source.flatMap((step): AgentActivityItem[] => {
    if (step.type === "tool") return [{ kind: "tool", step }];
    const paragraphs = thoughtParagraphs(step.text);
    return paragraphs.length > 0 ? [{ kind: "thought", paragraphs }] : [];
  });
}

function itemLabel(item: AgentActivityItem, position: "first" | "last") {
  if (item.kind === "tool") {
    return TOOL_DISPLAY_NAMES[item.step.name] ?? item.step.name;
  }
  return position === "first"
    ? item.paragraphs[0]
    : item.paragraphs[item.paragraphs.length - 1];
}

interface AgentActivityProps {
  reasoning: string;
  steps?: AgentStep[];
  /** Legacy messages saved without `agentSteps`: shown after the thought. */
  fallbackToolCalls?: { name: string; input?: string; output?: string }[];
  isStreaming?: boolean;
  className?: string;
}

export function AgentActivity({
  reasoning,
  steps,
  fallbackToolCalls,
  isStreaming = false,
  className,
}: AgentActivityProps) {
  const [isOpen, setIsOpen] = useState(false);

  const items = buildAgentActivityItems(steps, reasoning, fallbackToolCalls);
  if (items.length === 0) return null;

  // While streaming, surface the latest activity; when done, lead with the
  // opening thought like a title.
  const summary = isStreaming
    ? itemLabel(items[items.length - 1], "last")
    : itemLabel(items[0], "first");

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
        <div className="ml-[5px] max-h-96 overflow-y-auto border-l border-foreground/10 pl-4">
          <div className="space-y-3">
            {items.map((item, index) =>
              item.kind === "thought" ? (
                <div key={index} className="flex gap-2">
                  <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
                  <div className="space-y-1.5 text-base leading-5 text-muted-foreground/70">
                    {item.paragraphs.map((paragraph, paragraphIndex) => (
                      <p
                        key={`${paragraphIndex}-${paragraph.slice(0, 16)}`}
                        className="whitespace-pre-wrap wrap-break-word wrap-anywhere"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
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
              ),
            )}
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
