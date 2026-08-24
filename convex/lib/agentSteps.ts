import { v } from "convex/values";
import type { AgentToolAudit } from "./agentToolAudit";

/** Durable tool activity plus read compatibility for older reasoning steps. */
export type AgentReasoningStep = {
  type: "reasoning";
  text: string;
};

export type AgentToolStep = {
  type: "tool";
  name: string;
  input?: string;
  output?: string;
  completed?: boolean;
};

export type AgentStep = AgentReasoningStep | AgentToolStep;

export const agentStepsValidator = v.array(
  v.union(
    v.object({
      type: v.literal("reasoning"),
      text: v.string(),
    }),
    v.object({
      type: v.literal("tool"),
      name: v.string(),
      input: v.optional(v.string()),
      output: v.optional(v.string()),
      completed: v.optional(v.boolean()),
    }),
  ),
);

export function agentToolStepsFromAudit(
  audit: AgentToolAudit,
  outputTools: ReadonlySet<string>,
): AgentToolStep[] {
  const completed = new Set(audit.completedTools);
  return audit.toolCalls.map((call) => ({
    type: "tool",
    name: call.name,
    input: call.input,
    output: outputTools.has(call.name) ? call.output : undefined,
    completed: completed.has(call.name),
  }));
}
