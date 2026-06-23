import { describe, expect, test } from "vitest";
import { collectToolAudit } from "./agentToolAudit";

describe("collectToolAudit", () => {
  test("collects root-level tool calls and results", () => {
    expect(
      collectToolAudit({
        toolCalls: [{ toolName: "lookup_policy", input: { policyId: "p1" } }],
        toolResults: [{ toolName: "lookup_policy", output: { ok: true } }],
      }),
    ).toEqual({
      usedTools: ["lookup_policy"],
      toolCalls: [
        {
          name: "lookup_policy",
          input: "{\"policyId\":\"p1\"}",
          output: "{\"ok\":true}",
        },
      ],
      workflowOutcomes: [],
    });
  });

  test("collects step-level workflow outcomes", () => {
    expect(
      collectToolAudit({
        steps: [
          {
            toolCalls: [{ name: "generate_coi", args: { holder: "Acme" } }],
            toolResults: [
              {
                name: "generate_coi",
                output: {
                  workflowOutcome: { kind: "certificate_generated" },
                },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      usedTools: ["generate_coi"],
      workflowOutcomes: [{ kind: "certificate_generated" }],
    });
  });
});
