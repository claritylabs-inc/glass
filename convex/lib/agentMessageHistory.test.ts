import { describe, expect, test } from "vitest";
import { buildAssistantMessageContentWithArtifacts } from "./agentMessageHistory";

describe("buildAssistantMessageContentWithArtifacts", () => {
  test("does not append raw tool artifact data when no tool metadata exists", () => {
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

  test("appends compact tool and attachment activity", () => {
    expect(
      buildAssistantMessageContentWithArtifacts({
        content: "COI generated.",
        usedTools: ["lookup_policy", "generate_coi"],
        attachments: [
          { filename: "COI - Polychain Capital Fund IV.pdf" },
        ],
      }),
    ).toBe(
      'COI generated.\n\n[tool activity: tools: lookup_policy, generate_coi; attached: "COI - Polychain Capital Fund IV.pdf"]',
    );
  });

  test("appends compact attachment failure activity", () => {
    expect(
      buildAssistantMessageContentWithArtifacts({
        content: "COI generated.",
        usedTools: ["generate_coi"],
        toolArtifacts: [
          {
            type: "imessage_attachment_delivery",
            data: {
              status: "failed",
              stage: "worker_delivery",
              failures: [
                {
                  filename: "COI - Signalfire Fund III.pdf",
                  error: "Photon rejected the attachment",
                },
              ],
            },
          },
        ],
      }),
    ).toBe(
      'COI generated.\n\n[tool activity: tools: generate_coi; attachment failed: "COI - Signalfire Fund III.pdf"]',
    );
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
