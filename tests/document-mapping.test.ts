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
      linesOfBusiness: ["EO"],
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
    expect(fields.linesOfBusiness).toEqual(["EO"]);
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
      linesOfBusiness: ["CGL"],
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
    expect(fields.linesOfBusiness).toEqual(["CGL"]);
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
      premiumAmount: 325,
      totalCost: "325",
      totalCostAmount: 325,
      linesOfBusiness: ["CGL"],
      coverages: [
        {
          name: "General Liability",
          limit: "$1,000,000",
          limitAmount: 1000000,
          deductible: "$0",
          deductibleAmount: 0,
        },
        {
          name: "Liquor Liability",
          limit: "$1,000,000",
          limitAmount: 1000000,
          deductible: "$500",
          deductibleAmount: 500,
        },
      ],
      premiumBreakdown: [{ line: "Premium", amount: "$325.00", amountValue: 325 }],
      taxesAndFees: [{ name: "Policy fee", amount: "12.5", amountValue: 12.5 }],
    } as never);

    expect(fields.effectiveDate).toBe("07/16/2026");
    expect(fields.expirationDate).toBe("07/16/2026");
    expect(fields.premium).toBe("$325.00");
    expect(fields.premiumAmount).toBe(325);
    expect(fields.totalCostAmount).toBe(325);
    expect(fields.coverages).toMatchObject([
      { limit: "$1,000,000", limitAmount: 1000000, deductible: "$0", deductibleAmount: 0 },
      { limit: "$1,000,000", limitAmount: 1000000, deductible: "$500", deductibleAmount: 500 },
    ]);
    expect(fields.premiumBreakdown).toMatchObject([{ amount: "$325.00", amountValue: 325 }]);
    expect(fields.taxesAndFees).toMatchObject([{ amount: "12.5", amountValue: 12.5 }]);
  });

  it("preserves explicit clears for minimum and deposit premium fields", () => {
    const fields = insuranceDocToPolicy({
      type: "policy",
      carrier: "RLI Insurance Company",
      insuredName: "Clarity Labs Inc.",
      policyNumber: "RLI-EVT-2026-72190",
      effectiveDate: "2026-07-16",
      expirationDate: "2027-07-16",
      policyTypes: ["general_liability"],
      coverages: [],
      minimumPremium: "25% of Annual Premium, fully earned at inception",
      minimumPremiumAmount: undefined,
      depositPremium: undefined,
      depositPremiumAmount: undefined,
    } as never);

    expect(fields.minPremium).toBe("25% of Annual Premium, fully earned at inception");
    expect(fields).toHaveProperty("minPremiumAmount", undefined);
    expect(fields).toHaveProperty("depositPremium", undefined);
    expect(fields).toHaveProperty("depositPremiumAmount", undefined);
  });

  it("does not strip legal or administration clauses from model-owned organization names", () => {
    const fields = insuranceDocToPolicy({
      type: "policy",
      carrier: "ReLease Coverage Company Inc. (administered by Coverage Admin LLC)",
      security: "ReLease Coverage Company Inc., administered by Coverage Admin LLC",
      brokerAgency: "Brokerage Inc. DBA Coverage Team",
      insuredName: "ReLease Coverage Company Inc.",
      policyNumber: "SLS-EO-26-110482",
      effectiveDate: "2026-01-01",
      expirationDate: "2027-01-01",
      linesOfBusiness: ["EO"],
      coverages: [],
    } as never);

    expect(fields.carrier).toBe("ReLease Coverage Company Inc. (administered by Coverage Admin LLC)");
    expect(fields.security).toBe("ReLease Coverage Company Inc., administered by Coverage Admin LLC");
    expect(fields.brokerAgency).toBe("Brokerage Inc. DBA Coverage Team");
  });
});
