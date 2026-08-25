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
      completedTools: ["lookup_policy"],
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
    const workflowOutcome = {
      workflowKind: "certificate_request",
      status: "completed",
      nextAction: "generate_certificate",
      requiredSlots: [],
      forbiddenQuestions: [],
      forbiddenClaims: [],
      sideEffects: [],
      artifacts: [],
      comms: { headline: "Certificate generated." },
      audit: [],
    };
    expect(
      collectToolAudit({
        steps: [
          {
            toolCalls: [{ name: "generate_coi", args: { holder: "Acme" } }],
            toolResults: [
              {
                name: "generate_coi",
                output: {
                  workflowOutcome,
                },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      usedTools: ["generate_coi"],
      completedTools: ["generate_coi"],
      workflowOutcomes: [workflowOutcome],
    });
  });

  test("drops malformed workflow outcomes", () => {
    expect(
      collectToolAudit({
        toolResults: [
          {
            toolName: "generate_coi",
            output: {
              workflowOutcome: { kind: "certificate_generated" },
            },
          },
        ],
      }).workflowOutcomes,
    ).toEqual([]);
  });
});
