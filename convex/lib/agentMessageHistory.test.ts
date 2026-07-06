import { describe, expect, test } from "vitest";
import { buildAssistantMessageContentWithArtifacts } from "./agentMessageHistory";

describe("buildAssistantMessageContentWithArtifacts", () => {
  test("does not append tool artifact data to assistant content", () => {
    expect(
      buildAssistantMessageContentWithArtifacts({
        content: "Certificate follow-up is on hold.",
        toolArtifacts: [
          {
            type: "certificate_hold",
            data: {
              policyId: "policy-1",
              holderName: "Example Holder",
              source: "imessage",
            },
          },
        ],
      }),
    ).toBe("Certificate follow-up is on hold.");
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
