import { describe, expect, it } from "vitest";
import { insuranceDocToPolicy } from "../convex/lib/documentMapping";

describe("insurance document mapping", () => {
  it("promotes policy period and policy number from declarations when top-level fields are missing", () => {
    const fields = insuranceDocToPolicy({
      type: "policy",
      carrier: "Sentinel Pacific Specialty Insurance Company",
      insuredName: "Clarity Labs Inc.",
      policyNumber: "Unknown",
      effectiveDate: "Unknown",
      expirationDate: "Unknown",
      policyTypes: ["professional_liability"],
      coverages: [],
      declarations: {
        fields: [
          {
            field: "policyNumber",
            value: "SPS-TPC-2026-00481-04",
          },
          {
            field: "policyPeriodFrom",
            value: "05/01/2026",
          },
          {
            field: "policyPeriodTo",
            value: "05/01/2027",
          },
        ],
      },
    } as never);

    expect(fields.policyNumber).toBe("SPS-TPC-2026-00481-04");
    expect(fields.effectiveDate).toBe("05/01/2026");
    expect(fields.expirationDate).toBe("05/01/2027");
    expect(fields.policyYear).toBe(2026);
  });

  it("maps effective and expiry declaration aliases into top-level policy period fields", () => {
    const fields = insuranceDocToPolicy({
      type: "policy",
      carrier: "Starstone Specialty Insurance Company",
      insuredName: "Clarity Labs Inc.",
      policyNumber: "SS-MEC-2026-09921",
      effectiveDate: "Unknown",
      expirationDate: "Unknown",
      policyTypes: ["general_liability"],
      coverages: [],
      declarations: {
        fields: [
          {
            field: "Effective Date / Time",
            value: "09/09/2026 at 8:00 AM",
          },
          {
            field: "Expiration Date / Time",
            value: "09/10/2026 at 8:00 PM",
          },
        ],
      },
    } as never);

    expect(fields.effectiveDate).toBe("09/09/2026");
    expect(fields.expirationDate).toBe("09/10/2026");
    expect(fields.policyYear).toBe(2026);
  });

  it("normalizes dates and monetary extracted values into canonical storage fields", () => {
    const fields = insuranceDocToPolicy({
      type: "policy",
      carrier: "RLI Insurance Company",
      insuredName: "Clarity Labs Inc.",
      policyNumber: "RLI-EVT-2026-72190",
      effectiveDate: "2026-07-16",
      expirationDate: "07/16/2026 at 11:59 PM",
      premium: "$325.00",
      totalCost: "325",
      policyTypes: ["general_liability"],
      coverages: [
        {
          name: "General Liability",
          limit: "$1,000,000",
          deductible: "$0",
        },
        {
          name: "Liquor Liability",
          limit: "1m",
          deductible: "$500.00",
        },
      ],
      premiumBreakdown: [{ line: "Premium", amount: "$325.00" }],
      taxesAndFees: [{ name: "Policy fee", amount: "12.5" }],
    } as never);

    expect(fields.effectiveDate).toBe("07/16/2026");
    expect(fields.expirationDate).toBe("07/16/2026");
    expect(fields.premium).toBe("$325");
    expect(fields.premiumAmount).toBe(325);
    expect(fields.totalCostAmount).toBe(325);
    expect(fields.coverages).toMatchObject([
      { limit: "$1,000,000", limitAmount: 1000000, deductible: "$0", deductibleAmount: 0 },
      { limit: "$1,000,000", limitAmount: 1000000, deductible: "$500", deductibleAmount: 500 },
    ]);
    expect(fields.premiumBreakdown).toMatchObject([{ amount: "$325", amountValue: 325 }]);
    expect(fields.taxesAndFees).toMatchObject([{ amount: "$12.50", amountValue: 12.5 }]);
  });
});
