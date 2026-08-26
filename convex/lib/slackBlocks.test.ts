import { describe, expect, test } from "vitest";
import { buildSlackFinalBlocks, formatSlackAnswerText } from "./slackBlocks";

describe("Slack Block Kit renderers", () => {
  test("renders an accessible final answer with trace, policy action, handoff, and feedback", () => {
    const blocks = buildSlackFinalBlocks({
      message: {
        _id: "message-1" as any,
        content:
          "[[g:The policy is active]]. **Review the limits below.**\n\n[tool activity: tools: lookup_policy]",
        status: undefined,
        attachments: [{
          filename: "Cove certificate.pdf",
          contentType: "application/pdf",
          size: 1024,
          fileId: "storage-1" as any,
          kind: "coi",
        }],
        agentSteps: [
          { type: "reasoning", text: "private reasoning" },
          { type: "tool", name: "lookup_policy", completed: true, input: "secret" },
        ],
      },
      policies: [{
        _id: "policy-1",
        policyNumber: "GL-123",
        insuredName: "Cove",
        carrier: "Zurich",
        effectiveDate: "2026-01-01",
        expirationDate: "2027-01-01",
        linesOfBusiness: ["CGL"],
        extractionDataStage: "final",
      } as any],
      actionToken: "opaque-token",
      revision: 2,
      showHandoff: true,
    });

    expect(JSON.stringify(blocks)).not.toContain("private reasoning");
    expect(JSON.stringify(blocks)).not.toContain("secret");
    expect(JSON.stringify(blocks)).not.toContain("tool activity");
    expect(JSON.stringify(blocks)).toContain("glass_response_feedback");
    expect(JSON.stringify(blocks)).toContain("glass_request_human");
    expect(JSON.stringify(blocks)).toContain("tab=certificates");
  });

  test("removes emoji while converting CommonMark", () => {
    expect(
      formatSlackAnswerText(
        "✅ :white_check_mark: **Policy:** [Open](https://example.test/policy) with *review notes*",
      ),
    ).toBe(
      ":white_check_mark: *Policy:* <https://example.test/policy|Open> with _review notes_",
    );
  });
});
