import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildOperatorSlackConfirmationBlocks,
  buildOperatorSlackConfirmationResolvedBlocks,
  buildSlackClassicFinalBlocks,
  buildSlackFinalBlocks,
  formatSlackAnswerText,
} from "./slackBlocks";

describe("Slack Block Kit renderers", () => {
  test("renders operator confirmations as human-readable Slack controls", () => {
    const confirmationId =
      "q97dk6d86fgsdtpnqxbp0s6w2h8dgzf0" as Id<"operatorAgentConfirmations">;
    const summary =
      'Create procurement request "1305 Carroll Avenue Building Purchase" for organization Sigillo Supply';
    const blocks = buildOperatorSlackConfirmationBlocks({
      confirmationId,
      summary,
      destructive: false,
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        text: expect.stringContaining("Sigillo Supply"),
      },
    });
    expect((blocks[0] as any).text.text).not.toContain(confirmationId);
    expect(blocks[1]).toMatchObject({
      type: "actions",
      elements: [
        {
          action_id: "spot_operator_confirmation_reject",
          value: confirmationId,
          text: { text: "Cancel" },
        },
        {
          action_id: "spot_operator_confirmation_approve",
          value: confirmationId,
          text: { text: "Confirm" },
          style: "primary",
        },
      ],
    });

    const resolved = buildOperatorSlackConfirmationResolvedBlocks({
      summary,
      decision: "approve",
    });
    expect(JSON.stringify(resolved)).toContain("Confirmed");
    expect(JSON.stringify(resolved)).not.toContain("actions");
  });

  test("renders an accessible final answer with trace, policy action, handoff, and feedback", () => {
    const blocks = buildSlackFinalBlocks({
      message: {
        _id: "message-1" as Id<"threadMessages">,
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
      emailDraft: {
        recipientEmail: "recipient@example.com",
        subject: "Certificate of insurance",
        attachmentCount: 1,
        reviewUrl: "https://app.spot.insure/share/email/review-token",
      },
      actionToken: "opaque-token",
      revision: 2,
      showHandoff: true,
    });

    expect(JSON.stringify(blocks)).not.toContain("private reasoning");
    expect(JSON.stringify(blocks)).not.toContain("secret");
    expect(JSON.stringify(blocks)).not.toContain("tool activity");
    expect(JSON.stringify(blocks)).toContain("spot_response_feedback");
    expect(JSON.stringify(blocks)).toContain("spot_request_human");
    expect(JSON.stringify(blocks)).toContain("tab=certificates");
    expect(JSON.stringify(blocks)).toContain("spot_open_email_draft");
    expect(JSON.stringify(blocks)).toContain("Review draft");
    expect(JSON.stringify(blocks)).toContain("/share/email/review-token");
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

  test("preserves the email draft action in classic Block Kit fallback", () => {
    const blocks = buildSlackClassicFinalBlocks({
      message: {
        _id: "message-1" as Id<"threadMessages">,
        content: "The email draft is ready.",
        status: undefined,
        attachments: [],
        agentSteps: [],
      },
      policies: [],
      emailDraft: {
        recipientEmail: "recipient@example.com",
        subject: "Certificate of insurance",
        attachmentCount: 1,
        reviewUrl: "https://app.spot.insure/share/email/review-token",
      },
      actionToken: "opaque-token",
      revision: 2,
      showHandoff: false,
    });

    expect(JSON.stringify(blocks)).toContain("spot_open_email_draft");
    expect(JSON.stringify(blocks)).toContain("/share/email/review-token");
  });
});
