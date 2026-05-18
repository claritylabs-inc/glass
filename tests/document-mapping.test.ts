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
});
