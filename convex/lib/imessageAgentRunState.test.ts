import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { createImessageAgentRunState } from "./imessageAgentRunState";

describe("createImessageAgentRunState", () => {
  test("collects and dedupes intentionally presented policies", () => {
    const policyA = "policy-a" as Id<"policies">;
    const policyB = "policy-b" as Id<"policies">;
    const state = createImessageAgentRunState();

    state.onPolicyPresented(policyA);
    state.onPolicyPresented(policyA);
    state.onPolicyPresented(policyB);

    expect(state.presentedPolicyIds).toEqual([policyA, policyB]);
  });

  test("collects response attachments, artifacts, workflow outcomes, and email result", () => {
    const state = createImessageAgentRunState();
    const fileId = "file-1" as Id<"_storage">;
    const emailResult = {
      status: "draft" as const,
      responseBody: "Draft ready.",
      responseTo: "broker@example.com",
      subject: "Endorsement request",
      emailBody: "Please add the endorsement.",
    };

    state.onResponseAttachment({ filename: "coi.pdf" });
    state.onResponseAttachment({ filename: "coi.pdf", fileId });
    state.onToolArtifact({ type: "certificate_result", data: { fileId } });
    const workflowOutcome = {
      workflowKind: "certificate_request" as const,
      status: "completed" as const,
      nextAction: "none",
      requiredSlots: [],
      forbiddenQuestions: [],
      forbiddenClaims: [],
      sideEffects: [],
      artifacts: [{ type: "certificate", id: String(fileId) }],
      comms: { headline: "Certificate generated." },
      audit: [],
    };
    state.appendWorkflowOutcomes([workflowOutcome]);
    state.setEmailResult(emailResult);

    expect(state.responseFileAttachments).toEqual([
      { filename: "coi.pdf", storageId: fileId },
    ]);
    expect(state.toolArtifacts).toEqual([
      { type: "certificate_result", data: { fileId } },
      { type: "workflow_outcome", data: workflowOutcome },
    ]);
    expect(state.getEmailResult()).toBe(emailResult);
  });
});
