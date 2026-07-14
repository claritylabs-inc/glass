import { describe, expect, it } from "vitest";

import {
  addToolStep,
  appendReasoningDelta,
  beginReasoningStep,
  completeToolStep,
  serializeAgentSteps,
  type AgentStep,
} from "../convex/lib/agentSteps";

describe("agent step timeline", () => {
  it("interleaves reasoning segments and tool calls in stream order", () => {
    const steps: AgentStep[] = [];
    beginReasoningStep(steps);
    appendReasoningDelta(steps, "Let me look up ");
    appendReasoningDelta(steps, "the policy.");
    addToolStep(steps, { name: "lookup_policy", input: '{"query":"gl"}' });
    beginReasoningStep(steps);
    appendReasoningDelta(steps, "Now I can answer.");

    expect(steps).toEqual([
      { type: "reasoning", text: "Let me look up the policy." },
      { type: "tool", name: "lookup_policy", input: '{"query":"gl"}' },
      { type: "reasoning", text: "Now I can answer." },
    ]);
  });

  it("opens a reasoning segment on delta when no reasoning-start was emitted", () => {
    const steps: AgentStep[] = [];
    appendReasoningDelta(steps, "Thinking without a start part.");
    addToolStep(steps, { name: "lookup_policy" });
    appendReasoningDelta(steps, "A tool call closed the previous segment.");

    expect(steps.map((step) => step.type)).toEqual([
      "reasoning",
      "tool",
      "reasoning",
    ]);
  });

  it("completes the most recent incomplete call for the tool name", () => {
    const steps: AgentStep[] = [];
    addToolStep(steps, { name: "lookup_policy_section" });
    completeToolStep(steps, "lookup_policy_section");
    addToolStep(steps, { name: "lookup_policy_section" });
    completeToolStep(steps, "lookup_policy_section");
    addToolStep(steps, { name: "email_expert" });
    completeToolStep(steps, "email_expert", '{"status":"draft"}');

    expect(steps).toEqual([
      { type: "tool", name: "lookup_policy_section", completed: true },
      { type: "tool", name: "lookup_policy_section", completed: true },
      {
        type: "tool",
        name: "email_expert",
        completed: true,
        output: '{"status":"draft"}',
      },
    ]);
  });

  it("ignores results for tools with no pending call", () => {
    const steps: AgentStep[] = [];
    addToolStep(steps, { name: "lookup_policy" });
    completeToolStep(steps, "generate_coi");

    expect(steps).toEqual([{ type: "tool", name: "lookup_policy" }]);
  });

  it("serializes by dropping empty segments and normalizing reasoning text", () => {
    const steps: AgentStep[] = [];
    beginReasoningStep(steps);
    addToolStep(steps, { name: "lookup_policy" });
    beginReasoningStep(steps);
    appendReasoningDelta(steps, "raw");

    const snapshot = serializeAgentSteps(steps, (text) => text.toUpperCase());

    expect(snapshot).toEqual([
      { type: "tool", name: "lookup_policy" },
      { type: "reasoning", text: "RAW" },
    ]);
    // The live accumulator is untouched so streaming can keep appending.
    expect(steps).toHaveLength(3);
    expect(steps[2]).toEqual({ type: "reasoning", text: "raw" });
  });
});
