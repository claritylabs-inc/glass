import { describe, expect, test } from "vitest";

import {
  buildOperatorRunCheckpointSummary,
  shouldContinueOperatorRun,
} from "./operatorAgentContinuation";

describe("operator run continuation", () => {
  test("continues only when a tool-bearing segment exhausts its step budget", () => {
    const toolSteps = Array.from({ length: 25 }, (_, index) => ({
      toolCalls: index === 24 ? [{ toolName: "list_policies" }] : [],
    }));
    expect(shouldContinueOperatorRun({ steps: toolSteps }, 25)).toBe(true);
    expect(shouldContinueOperatorRun({ steps: toolSteps.slice(0, 24) }, 25)).toBe(
      false,
    );
    expect(
      shouldContinueOperatorRun(
        { steps: Array.from({ length: 25 }, () => ({ toolCalls: [] })) },
        25,
      ),
    ).toBe(false);
  });

  test("carries bounded tool results into the next segment", () => {
    const summary = buildOperatorRunCheckpointSummary({
      previous: "Earlier work",
      audit: {
        usedTools: ["get_organization"],
        completedTools: ["get_organization"],
        toolCalls: [
          {
            name: "get_organization",
            input: '{"orgId":"org-1"}',
            output: '{"name":"Cove"}',
          },
        ],
        workflowOutcomes: [],
      },
    });

    expect(summary).toContain("Earlier work");
    expect(summary).toContain("Tool get_organization");
    expect(summary.length).toBeLessThanOrEqual(6_000);
  });
});
