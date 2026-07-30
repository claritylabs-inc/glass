import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("external extraction document gate", () => {
  it("gates uploads and full retries before external worker handoff", () => {
    const actions = read("convex/actions/policyExtraction.ts");

    expect(actions).toContain("async function rejectedByDocumentGateBeforeExternalHandoff");

    const uploadBody = actions.slice(
      actions.indexOf("export const startPolicyExtractionFromUpload"),
      actions.indexOf("export const retryPolicyExtraction"),
    );
    const retryBody = actions.slice(
      actions.indexOf("export const retryPolicyExtraction"),
    );
    for (const body of [uploadBody, retryBody]) {
      const gateAt = body.indexOf("rejectedByDocumentGateBeforeExternalHandoff");
      const handoffAt = body.indexOf("pipelineStartExternalWorkerJob");
      expect(gateAt).toBeGreaterThan(-1);
      expect(handoffAt).toBeGreaterThan(-1);
      expect(gateAt).toBeLessThan(handoffAt);
    }
    // Resume retries must not repeat the gate; only full retries re-classify.
    expect(retryBody).toContain('mode === "full" &&');
  });

  it("rejects with the shared gate decision and never blocks on gate failures", () => {
    const actions = read("convex/actions/policyExtraction.ts");
    const gateBody = actions.slice(
      actions.indexOf("async function rejectedByDocumentGateBeforeExternalHandoff"),
      actions.indexOf("export const startPolicyExtractionFromUpload"),
    );

    expect(gateBody).toContain("classifyInsuranceExtractability");
    expect(gateBody).toContain("tryConvertPdfWithLiteParse");
    expect(gateBody.match(/tryConvertPdfWithLiteParse/g)).toHaveLength(1);
    expect(gateBody).toContain("preparePdfTextWithPdfJs");
    expect(gateBody).not.toContain("preparePdfTextWithParserFallback");
    expect(gateBody).toContain("shouldRejectDocument(gateDecision)");
    expect(gateBody).toContain("NON_INSURANCE_DOCUMENT_ERROR");
    expect(gateBody).toContain('status: "not_insurance"');
    expect(gateBody).toContain("pipelineRejectExternalJob");
    expect(gateBody).toContain("Document gate failed; continuing extraction");
  });

  it("auto-archives rejected non-insurance documents in both extraction modes", () => {
    const policies = read("convex/policies.ts");
    const actions = read("convex/actions/policyExtraction.ts");

    expect(policies).toContain("export const pipelineRejectExternalJob");
    expect(policies).toContain("async function archiveRejectedPolicyDocument");
    expect(policies).toContain("export const archiveRejectedDocumentInternal");
    expect(policies).toContain("Auto-archived: rejected by the document intake gate");

    const rejectBody = policies.slice(
      policies.indexOf("export const pipelineRejectExternalJob"),
      policies.indexOf("export const pipelineClaimExternalWorkerJob"),
    );
    expect(rejectBody).toContain("archiveRejectedPolicyDocument(ctx, policyId, userId)");

    // The in-Convex extract phase shares the same auto-archive on rejection.
    expect(actions).toContain("archiveRejectedDocumentInternal");
  });
});
