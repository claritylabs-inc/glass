// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { buildAgentActivityItems } from "../components/agent-thread/agent-activity";
import type { AgentStep } from "../convex/lib/agentSteps";

describe("buildAgentActivityItems", () => {
  it("keeps tool calls while hiding provider reasoning segments", () => {
    const steps: AgentStep[] = [
      { type: "reasoning", text: "First I need the policy details." },
      { type: "tool", name: "lookup_policy", completed: true },
      { type: "reasoning", text: "The policy covers general liability." },
    ];

    const items = buildAgentActivityItems(steps);
    expect(items).toEqual([
      { kind: "tool", step: { type: "tool", name: "lookup_policy", completed: true } },
    ]);
  });

  it("does not expose reasoning-only activity", () => {
    const items = buildAgentActivityItems(
      [
        {
          type: "reasoning",
          text: "First paragraph of thought.\n\nSecond paragraph of thought.",
        },
      ],
    );

    expect(items).toEqual([]);
  });

  it("does not create activity without tool calls", () => {
    expect(buildAgentActivityItems(undefined)).toEqual([]);
  });

  it("uses legacy tool calls when ordered steps are unavailable", () => {
    const items = buildAgentActivityItems(
      undefined,
      [{ name: "lookup_policy", input: '{"query":"gl"}' }],
    );

    expect(items).toEqual([
      {
        kind: "tool",
        step: {
          type: "tool",
          name: "lookup_policy",
          input: '{"query":"gl"}',
          completed: true,
        },
      },
    ]);
  });

  it("ignores legacy tool calls when ordered tool steps exist", () => {
    const items = buildAgentActivityItems(
      [{ type: "tool", name: "generate_coi", completed: true }],
      [{ name: "lookup_policy" }],
    );

    expect(items).toEqual([
      { kind: "tool", step: { type: "tool", name: "generate_coi", completed: true } },
    ]);
  });

  it("returns nothing when there is no activity", () => {
    expect(buildAgentActivityItems(undefined)).toEqual([]);
    expect(buildAgentActivityItems([])).toEqual([]);
  });
});
