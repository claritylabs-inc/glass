import { describe, expect, it } from "vitest";
import { normalizeEditableFields } from "../convex/policies";

describe("policy field normalization", () => {
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
