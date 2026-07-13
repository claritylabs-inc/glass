import { v } from "convex/values";

/**
 * Ordered agent activity timeline persisted on thread messages: discrete
 * reasoning segments interleaved with tool calls in the order they streamed.
 * The legacy `reasoning` string field remains for messages saved before this
 * timeline existed.
 */
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

/** Open a new reasoning segment (AI SDK `reasoning-start`). */
export function beginReasoningStep(steps: AgentStep[]): void {
  steps.push({ type: "reasoning", text: "" });
}

/**
 * Append streamed reasoning text (AI SDK `reasoning-delta`). Starts a segment
 * when the provider never emitted `reasoning-start` or a tool call closed the
 * previous one.
 */
export function appendReasoningDelta(steps: AgentStep[], text: string): void {
  const last = steps[steps.length - 1];
  if (last?.type === "reasoning") {
    last.text += text;
    return;
  }
  steps.push({ type: "reasoning", text });
}

export function addToolStep(
  steps: AgentStep[],
  call: { name: string; input?: string },
): void {
  steps.push({ type: "tool", name: call.name, input: call.input });
}

/** Mark the most recent incomplete call to `name` completed (AI SDK `tool-result`). */
export function completeToolStep(
  steps: AgentStep[],
  name: string,
  output?: string,
): void {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step.type === "tool" && step.name === name && !step.completed) {
      step.completed = true;
      if (output !== undefined) step.output = output;
      return;
    }
  }
}

/** Snapshot for persistence: drop empty reasoning segments, normalize text. */
export function serializeAgentSteps(
  steps: AgentStep[],
  normalizeReasoning: (text: string) => string,
): AgentStep[] {
  return steps.flatMap((step): AgentStep[] => {
    if (step.type !== "reasoning") return [{ ...step }];
    if (!step.text.trim()) return [];
    return [{ ...step, text: normalizeReasoning(step.text) }];
  });
}
