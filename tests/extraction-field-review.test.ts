import { describe, expect, it } from "vitest";
import {
  TEST_FIELD_REVIEW_GROUPS,
  applyFieldReviewResults,
  selectEvidenceForFieldGroup,
} from "../convex/lib/extractionFieldReview";

const financialGroup = TEST_FIELD_REVIEW_GROUPS.find((group) => group.id === "financial_terms")!;

describe("extraction field review", () => {
  it("selects field-group evidence from source spans and document sections", () => {
    const evidence = selectEvidenceForFieldGroup({
      group: financialGroup,
      document: {
        sections: [
          {
            title: "Item 10. Premium",
            pageStart: 4,
            type: "declarations",
            content: [
              "Annual Premium CAD $42,000",
              "Provincial Premium Tax (Ontario, 3.5%) CAD $1,470",
              "Policy Fee CAD $350",
              "Total Payable CAD $43,820",
            ].join("\n"),
          },
        ],
      },
      sourceSpans: [
        { id: "boring", text: "This policy contains several conditions." },
        { id: "fee-row", pageStart: 4, text: "Policy Fee CAD $350" },
      ],
    });

    expect(evidence[0]?.text).toContain("Annual Premium CAD $42,000");
    expect(evidence.some((item) => item.id === "fee-row")).toBe(true);
  });

  it("applies evidence-backed missing-field corrections through registered groups", () => {
    const result = applyFieldReviewResults(
      {
        type: "policy",
        premium: "Unknown",
        totalCost: undefined,
      },
      [
        {
          groupId: "financial_terms",
          corrections: [
            {
              field: "premium",
              value: "CAD $42,000",
              confidence: "high",
              reason: "The premium table lists annual premium.",
              evidenceQuote: "Annual Premium CAD $42,000",
            },
            {
              field: "taxesAndFees",
              value: [{ name: "Policy Fee", amount: "CAD $350", type: "fee" }],
              confidence: "high",
              reason: "The premium table lists a policy fee row.",
              evidenceQuote: "Policy Fee CAD $350",
            },
          ],
        },
      ],
    );

    expect(result.document.premium).toBe("CAD $42,000");
    expect(result.document.taxesAndFees).toEqual([
      { name: "Policy Fee", amount: "CAD $350", type: "fee" },
    ]);
    expect(result.applied).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it("does not replace existing values without high-confidence evidence", () => {
    const result = applyFieldReviewResults(
      {
        type: "policy",
        insuredName: "Existing Insured LLC",
      },
      [
        {
          groupId: "identity_and_period",
          corrections: [
            {
              field: "insuredName",
              value: "Different Insured LLC",
              confidence: "medium",
              reason: "Evidence might indicate a different insured.",
              evidenceQuote: "Named Insured Different Insured LLC",
            },
            {
              field: "unregisteredField",
              value: "bad",
              confidence: "high",
              reason: "Should never apply.",
              evidenceQuote: "bad",
            },
          ],
        },
      ],
    );

    expect(result.document.insuredName).toBe("Existing Insured LLC");
    expect(result.applied).toHaveLength(0);
    expect(result.skipped.map((item) => item.field)).toEqual([
      "insuredName",
      "unregisteredField",
    ]);
  });
});
