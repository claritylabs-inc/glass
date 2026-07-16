import { describe, expect, it } from "vitest";
import { normalizeEditableFields } from "../convex/policies";
import { normalizeExtractedDate } from "../convex/lib/valueNormalization";

describe("policy field normalization", () => {
  it.each([
    ["Mar 08 2026", "03/08/2026"],
    ["March 8th, 2026 at 12:01 AM", "03/08/2026"],
    ["8 Mar 2026", "03/08/2026"],
    ["2026-03-08T12:01:00.000Z", "03/08/2026"],
    ["03-08-26", "03/08/2026"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeExtractedDate(input)).toBe(expected);
  });

  it("normalizes every extracted date-bearing destination", () => {
    const fields = normalizeEditableFields({
      effectiveDate: "Mar 08 2026",
      expirationDate: "March 8th, 2027",
      nextReviewDate: "8 Mar 2027",
      policyNumber: "03/08/2026",
      coverages: [
        {
          name: "Professional Liability",
          retroactiveDate: "March 01 2020",
        },
      ],
      operationalProfile: {
        effectiveDate: {
          value: "Mar 08 2026",
          normalizedValue: "2026-03-08",
          sourceNodeIds: ["node-1"],
          sourceSpanIds: ["span-1"],
        },
        coverages: [
          { name: "Cyber", retroactiveDate: "1 March 2021" },
        ],
      },
      document: {
        endorsements: [
          {
            editionDate: "Mar 08 2026",
            effectiveDate: "March 09, 2026",
          },
        ],
      },
      declarations: {
        fields: [
          { field: "Effective Date / Time", value: "Mar 08 2026" },
          { field: "policyPeriodEnd", value: "Mar 08 2027" },
          { field: "policyNumber", value: "03/08/2026" },
        ],
        lineDetails: {
          line: "travel",
          tripDepartureDate: "Mar 10 2026",
          tripReturnDate: "20 Mar 2026",
        },
      },
      supplementaryFacts: [
        { key: "continuityDate", value: "Mar 08 2024" },
        { fieldGroup: "loss_history", valueKind: "date", value: "Mar 08 2023" },
      ],
    });

    expect(fields).toMatchObject({
      effectiveDate: "03/08/2026",
      expirationDate: "03/08/2027",
      nextReviewDate: "03/08/2027",
      policyNumber: "03/08/2026",
      coverages: [{ retroactiveDate: "03/01/2020" }],
      operationalProfile: {
        effectiveDate: {
          value: "03/08/2026",
          normalizedValue: "03/08/2026",
        },
        coverages: [{ retroactiveDate: "03/01/2021" }],
      },
      document: {
        endorsements: [
          { editionDate: "03/08/2026", effectiveDate: "03/09/2026" },
        ],
      },
      declarations: {
        fields: [
          { value: "03/08/2026" },
          { value: "03/08/2027" },
          { value: "03/08/2026" },
        ],
        lineDetails: {
          tripDepartureDate: "03/10/2026",
          tripReturnDate: "03/20/2026",
        },
      },
      supplementaryFacts: [
        { value: "03/08/2024" },
        { value: "03/08/2023" },
      ],
    });
  });

  it("preserves LLM-owned extraction money text when numeric derivation is disabled", () => {
    const fields = normalizeEditableFields(
      {
        premium: "CAD $42,000",
        minPremium: "25% of Annual Premium, fully earned at inception",
        premiumBreakdown: [
          { line: "Annual Premium", amount: "CAD $42,000", amountValue: 42000 },
        ],
      },
      { deriveNumericAmounts: false, normalizeMoneyText: false },
    );

    expect(fields.premium).toBe("CAD $42,000");
    expect(fields.minPremium).toBe("25% of Annual Premium, fully earned at inception");
    expect(fields.premiumBreakdown).toEqual([
      { line: "Annual Premium", amount: "CAD $42,000", amountValue: 42000 },
    ]);
  });

  it("keeps editable/manual money normalization on by default", () => {
    const fields = normalizeEditableFields({
      premium: "325",
      coverages: [{ name: "General Liability", limit: "1m", deductible: "500" }],
    });

    expect(fields.premium).toBe("$325");
    expect(fields.premiumAmount).toBe(325);
    expect(fields.coverages).toMatchObject([
      { limit: "$1,000,000", limitAmount: 1000000, deductible: "$500", deductibleAmount: 500 },
    ]);
  });
});
