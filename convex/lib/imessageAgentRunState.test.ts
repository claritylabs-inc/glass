import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { createImessageAgentRunState } from "./imessageAgentRunState";

describe("createImessageAgentRunState", () => {
  test("dedupes policy references against existing relevant policies", () => {
    const policyA = "policy-a" as Id<"policies">;
    const policyB = "policy-b" as Id<"policies">;
    const relevantPolicyIds = [policyA];
    const state = createImessageAgentRunState({ relevantPolicyIds });

    state.onPolicyReferenced(policyA);
    state.onPolicyReferenced(policyB);

    expect(relevantPolicyIds).toEqual([policyA, policyB]);
  });

  test("collects response attachments, artifacts, workflow outcomes, and email result", () => {
    const state = createImessageAgentRunState({ relevantPolicyIds: [] });
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
    state.appendWorkflowOutcomes([{ kind: "certificate_generated" }]);
    state.setEmailResult(emailResult);

    expect(state.responseFileAttachments).toEqual([
      { filename: "coi.pdf", storageId: fileId },
    ]);
    expect(state.toolArtifacts).toEqual([
      { type: "certificate_result", data: { fileId } },
      { type: "workflow_outcome", data: { kind: "certificate_generated" } },
    ]);
    expect(state.getEmailResult()).toBe(emailResult);
  });
});
