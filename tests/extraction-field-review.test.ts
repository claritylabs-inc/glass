import { describe, expect, it } from "vitest";
import {
  TEST_FIELD_REVIEW_GROUPS,
  applyFieldReviewResults,
  fieldReviewRouteForPrimary,
  selectEvidenceForFieldGroup,
} from "../convex/lib/extractionFieldReview";
import { FALLBACK_MODEL, FIREWORKS_MODEL_IDS } from "../convex/lib/modelCatalog";

const financialGroup = TEST_FIELD_REVIEW_GROUPS.find((group) => group.id === "financial_terms")!;

describe("extraction field review", () => {
  it("uses the reliable review route directly for Fireworks extraction", () => {
    expect(
      fieldReviewRouteForPrimary({
        provider: "fireworks",
        model: FIREWORKS_MODEL_IDS.deepseekV4Flash,
      }),
    ).toEqual(FALLBACK_MODEL);
  });

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

  it("allows high-confidence review to keep percentage-only premium terms textual", () => {
    const result = applyFieldReviewResults(
      {
        type: "policy",
        minimumPremium: "$25",
        premiumBreakdown: [
          { line: "Annual Premium", amount: "$42,000", amountValue: 42000 },
          { line: "Minimum Earned Premium", amount: "$25" },
        ],
      },
      [
        {
          groupId: "financial_terms",
          corrections: [
            {
              field: "minimumPremium",
              value: "25% of Annual Premium, fully earned at inception",
              confidence: "high",
              reason: "The premium table states a percentage-only minimum earned premium term.",
              evidenceQuote: "Minimum Earned Premium 25% of Annual Premium, fully earned at inception",
            },
            {
              field: "premiumBreakdown",
              value: [
                { line: "Annual Premium", amount: "CAD $42,000", amountValue: 42000 },
                { line: "Total Payable", amount: "CAD $43,820", amountValue: 43820 },
              ],
              confidence: "high",
              reason: "The table contains currency rows for annual premium and total payable.",
              evidenceQuote: "Annual Premium CAD $42,000 Total Payable CAD $43,820",
            },
          ],
        },
      ],
    );

    expect(result.document.minimumPremium).toBe(
      "25% of Annual Premium, fully earned at inception",
    );
    expect(result.document.premiumBreakdown).toEqual([
      { line: "Annual Premium", amount: "CAD $42,000", amountValue: 42000 },
      { line: "Total Payable", amount: "CAD $43,820", amountValue: 43820 },
    ]);
    expect(result.applied).toHaveLength(2);
  });

  it("drops table correction rows that cannot satisfy destination schema", () => {
    const result = applyFieldReviewResults(
      { type: "policy", coverages: [] },
      [
        {
          groupId: "coverage_terms",
          corrections: [
            {
              field: "coverages",
              value: [
                {
                  limit: "$1",
                  limitType: "aggregate",
                  originalContent: "01/01/2022",
                  pageNumber: 5,
                },
              ],
              confidence: "high",
              reason: "Malformed review row without a coverage name.",
              evidenceQuote: "Item 6. Coverages, Limits of Liability",
            },
          ],
        },
      ],
    );

    expect(result.document.coverages).toEqual([]);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toMatchObject([
      { field: "coverages", reasonSkipped: "empty correction value" },
    ]);
  });

  it("drops row-shaped corrections for scalar fields", () => {
    const result = applyFieldReviewResults(
      { type: "policy", retroactiveDate: undefined },
      [
        {
          groupId: "coverage_terms",
          corrections: [
            {
              field: "retroactiveDate",
              value: [{ pageNumber: 5 }],
              confidence: "high",
              reason: "Malformed review row for a string field.",
              evidenceQuote: "Retroactive Date Item 8.",
            },
          ],
        },
      ],
    );

    expect(result.document.retroactiveDate).toBeUndefined();
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toMatchObject([
      { field: "retroactiveDate", reasonSkipped: "empty correction value" },
    ]);
  });
});
