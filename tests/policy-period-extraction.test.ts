import { describe, expect, it } from "vitest";
import {
  applyPolicyPeriodFallback,
  extractPolicyPeriodFromSourceSpans,
} from "../convex/lib/policyPeriodExtraction";

describe("policy period extraction fallback", () => {
  it("extracts clear day/month/year period-of-insurance tables", () => {
    const period = extractPolicyPeriodFromSourceSpans([
      {
        pageStart: 1,
        text: `
          PERIOD OF INSURANCE
          FROM DAY MONTH YEAR TO DAY MONTH YEAR
          12:01 A.M. STANDARD TIME AT THE "COVERED LOCATIONS" SHOWN BELOW
          20 2 2026 20 2 2027
        `,
      },
    ]);

    expect(period).toEqual({
      effectiveDate: "02/20/2026",
      expirationDate: "02/20/2027",
      pageNumber: 1,
      source: "policy_period_label",
    });
  });

  it("overrides missing or malformed SDK dates with source text dates", () => {
    const result = applyPolicyPeriodFallback(
      {
        type: "policy",
        effectiveDate: "Unknown",
        expirationDate: "not a date",
      },
      [
        {
          pageStart: 2,
          text: "Policy Period From 01/15/2026 To 01/15/2027",
        },
      ],
    );

    expect(result.changed).toBe(true);
    expect(result.document.effectiveDate).toBe("01/15/2026");
    expect(result.document.expirationDate).toBe("01/15/2027");
  });
});
