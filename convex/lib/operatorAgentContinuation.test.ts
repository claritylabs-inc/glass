import { describe, expect, test } from "vitest";

import { shouldContinueOperatorRun } from "./operatorAgentContinuation";

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
});
