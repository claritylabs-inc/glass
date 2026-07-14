// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { buildAgentActivityItems } from "../components/agent-thread/agent-activity";
import type { AgentStep } from "../convex/lib/agentSteps";

describe("buildAgentActivityItems", () => {
  it("keeps tool calls at their position between thinking segments", () => {
    const steps: AgentStep[] = [
      { type: "reasoning", text: "First I need the policy details." },
      { type: "tool", name: "lookup_policy", completed: true },
      { type: "reasoning", text: "The policy covers general liability." },
    ];

    const items = buildAgentActivityItems(steps, "");
    expect(items.map((item) => item.kind)).toEqual([
      "thought",
      "tool",
      "thought",
    ]);
  });

  it("splits a thinking segment into paragraphs on blank lines", () => {
    const items = buildAgentActivityItems(
      [
        {
          type: "reasoning",
          text: "First paragraph of thought.\n\nSecond paragraph of thought.",
        },
      ],
      "",
    );

    expect(items).toEqual([
      {
        kind: "thought",
        paragraphs: [
          "First paragraph of thought.",
          "Second paragraph of thought.",
        ],
      },
    ]);
  });

  it("falls back to the legacy reasoning string for old messages", () => {
    const items = buildAgentActivityItems(
      undefined,
      "Old message reasoning. It has two sentences.",
    );

    expect(items).toEqual([
      {
        kind: "thought",
        paragraphs: [
          "Old message reasoning.",
          "It has two sentences.",
        ],
      },
    ]);
  });

  it("appends legacy tool calls after the legacy thought", () => {
    const items = buildAgentActivityItems(
      undefined,
      "Old message reasoning.",
      [{ name: "lookup_policy", input: '{"query":"gl"}' }],
    );

    expect(items).toEqual([
      { kind: "thought", paragraphs: ["Old message reasoning."] },
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

  it("ignores legacy tool calls when ordered steps exist", () => {
    const items = buildAgentActivityItems(
      [{ type: "tool", name: "generate_coi", completed: true }],
      "",
      [{ name: "lookup_policy" }],
    );

    expect(items).toEqual([
      { kind: "tool", step: { type: "tool", name: "generate_coi", completed: true } },
    ]);
  });

  it("returns nothing when there is no activity", () => {
    expect(buildAgentActivityItems(undefined, "  ")).toEqual([]);
    expect(buildAgentActivityItems([], "")).toEqual([]);
  });
});
