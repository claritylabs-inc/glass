import { describe, expect, test } from "vitest";
import { buildAssistantMessageContentWithArtifacts } from "./agentMessageHistory";

describe("buildAssistantMessageContentWithArtifacts", () => {
  test("appends pending certificate program choices for model context", () => {
    expect(
      buildAssistantMessageContentWithArtifacts({
        content: "Choose a program.",
        toolArtifacts: [
          {
            type: "certificate_program_selection",
            data: {
              policyId: "policy-1",
              holderName: "Example Holder",
              candidates: [
                {
                  programId: "program-1",
                  programName: "Example Program",
                },
              ],
              source: "imessage",
            },
          },
        ],
      }),
    ).toContain("PENDING CERTIFIED COI PROGRAM SELECTION:");
  });

  test("leaves ordinary assistant content unchanged", () => {
    expect(
      buildAssistantMessageContentWithArtifacts({
        content: "No pending choices.",
        toolArtifacts: [{ type: "other", data: {} }],
      }),
    ).toBe("No pending choices.");
  });
});
