import { describe, expect, it } from "vitest";
import {
  postProcessFeedbackRequest,
  stripUngroundedSourceSensitiveValues,
} from "./extractionPostProcess";
import { applyFieldReviewResults } from "./extractionFieldReview";

describe("extraction post-process feedback", () => {
  it("deduplicates the reviewed-field denominator across review passes", () => {
    const result = applyFieldReviewResults({}, [
      {
        groupId: "identity_and_period",
        corrections: [],
        reviewedFields: ["policyNumber", "insuredName"],
      },
      {
        groupId: "identity_and_period",
        corrections: [],
        reviewedFields: ["insuredName", "effectiveDate"],
      },
    ]);

    expect(result.reviewedFieldCount).toBe(3);
  });

  it("counts a field corrected by overlapping passes only once", () => {
    const fieldReview = applyFieldReviewResults({}, [
      {
        groupId: "identity_and_period",
        corrections: [{
          field: "policyNumber",
          value: "ABC-123",
          confidence: "high",
          reason: "first pass",
          evidenceQuote: "Policy No. ABC-123",
        }],
        reviewedFields: ["policyNumber"],
      },
      {
        groupId: "identity_and_period",
        corrections: [{
          field: "policyNumber",
          value: "ABC-123",
          confidence: "high",
          reason: "reconciliation pass",
          evidenceQuote: "Policy No. ABC-123",
        }],
        reviewedFields: ["policyNumber"],
      },
    ]);

    expect(fieldReview.applied).toHaveLength(2);
    expect(fieldReview.reviewedFieldCount).toBe(1);
    expect(postProcessFeedbackRequest({
      originRequestId: "origin-request-1",
      fieldReview,
      ungroundedStripCount: 0,
      sensitiveFieldCount: 0,
      escalationCount: 0,
    })?.signals).toMatchObject({
      reviewCorrectionCount: 1,
      reviewedFieldCount: 1,
    });
  });

  it("counts source-sensitive checks as the denominator for stripped values", () => {
    const result = stripUngroundedSourceSensitiveValues({
      carrier: "Acme Insurance",
      policyNumber: "NOT-IN-SOURCE",
    }, [{ text: "Policy issued by Acme Insurance" }]);

    expect(result.value.carrier).toBe("Acme Insurance");
    expect(result.value.policyNumber).toBeUndefined();
    expect(result.removed).toHaveLength(1);
    expect(result.sensitiveFieldCount).toBe(2);
  });

  it("builds one stable aggregate event for the proven operational-profile origin", () => {
    const request = postProcessFeedbackRequest({
      originRequestId: "origin-request-1",
      fieldReview: {
        document: {},
        applied: [
          {
            groupId: "identity_and_period",
            field: "policyNumber",
            value: "ABC-123",
            confidence: "high",
            reason: "source evidence",
            evidenceQuote: "Policy No. ABC-123",
          },
        ],
        skipped: [],
        reviewedFieldCount: 12,
      },
      ungroundedStripCount: 2,
      sensitiveFieldCount: 20,
      escalationCount: 1,
      traceId: "trace-1",
      policyId: "policy-1",
    });

    expect(request).toEqual({
      requestId: "origin-request-1",
      idempotencyKey: "extraction-postprocess-v1",
      signals: {
        reviewCorrectionCount: 1,
        reviewedFieldCount: 12,
        ungroundedStripCount: 2,
        sensitiveFieldCount: 20,
        escalationCount: 1,
      },
      trace: {
        traceId: "trace-1",
        policyId: "policy-1",
        phase: "post_process",
        originTaskKind: "extraction_operational_profile",
      },
    });
  });
});
