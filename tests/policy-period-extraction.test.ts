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

  it("continues past generic policy-period mentions to the declaration label", () => {
    const period = extractPolicyPeriodFromSourceSpans([
      {
        pageStart: 5,
        text: `
          THIS POLICY ONLY AFFORDS COVERAGE FOR CLAIMS FIRST MADE AGAINST THE
          INSURED AND REPORTED IN WRITING TO THE INSURER DURING THE POLICY PERIOD.
          Item 3. Policy Period
          From 05/01/2026 To 05/01/2027
          Both dates at 12:01 A.M. Local Standard Time
        `,
      },
    ]);

    expect(period).toMatchObject({
      effectiveDate: "05/01/2026",
      expirationDate: "05/01/2027",
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

  it("falls back to extracted declaration period fields when source text has no label match", () => {
    const result = applyPolicyPeriodFallback(
      {
        type: "policy",
        effectiveDate: "Unknown",
        expirationDate: "Unknown",
        declarations: {
          fields: [
            { field: "policyPeriodFrom", value: "05/01/2026" },
            { field: "policyPeriodTo", value: "05/01/2027" },
          ],
        },
      },
      [{ pageStart: 1, text: "No declaration label in this span." }],
    );

    expect(result.period?.source).toBe("declarations_field");
    expect(result.document.effectiveDate).toBe("05/01/2026");
    expect(result.document.expirationDate).toBe("05/01/2027");
  });

  it("treats effective and expiration date/time rows as policy period dates", () => {
    const result = applyPolicyPeriodFallback(
      {
        type: "policy",
        effectiveDate: "Unknown",
        expirationDate: "Unknown",
      },
      [
        {
          pageStart: 1,
          text: `
            POLICY PERIOD
            Effective Date / Time 09/09/2026 at 8:00 AM
            Expiration Date / Time 09/10/2026 at 8:00 PM
            Prior Policy No. NEW
          `,
        },
      ],
    );

    expect(result.period?.source).toBe("policy_period_label");
    expect(result.document.effectiveDate).toBe("09/09/2026");
    expect(result.document.expirationDate).toBe("09/10/2026");
  });

  it("keeps same-day effective and expiration date/time rows as distinct policy period endpoints", () => {
    const result = applyPolicyPeriodFallback(
      {
        type: "policy",
        effectiveDate: "Unknown",
        expirationDate: "Unknown",
      },
      [
        {
          pageStart: 1,
          text: `
            POLICY PERIOD
            Effective Date / Time 07/16/2026 at 6:00 PM
            Expiration Date / Time 07/16/2026 at 11:59 PM
            Prior Policy No. NEW
          `,
        },
      ],
    );

    expect(result.period).toMatchObject({
      effectiveDate: "07/16/2026",
      expirationDate: "07/16/2026",
      source: "policy_period_label",
    });
    expect(result.document.effectiveDate).toBe("07/16/2026");
    expect(result.document.expirationDate).toBe("07/16/2026");
  });

  it("accepts close declaration field names for policy period start and end", () => {
    const result = applyPolicyPeriodFallback(
      {
        type: "policy",
        effectiveDate: "Unknown",
        expirationDate: "Unknown",
        declarations: {
          fields: [
            { field: "Effective Date / Time", value: "09/09/2026 at 8:00 AM" },
            { field: "Expiry Date / Time", value: "09/10/2026 at 8:00 PM" },
          ],
        },
      },
      [{ pageStart: 1, text: "No usable policy period source span." }],
    );

    expect(result.period?.source).toBe("declarations_field");
    expect(result.document.effectiveDate).toBe("09/09/2026");
    expect(result.document.expirationDate).toBe("09/10/2026");
  });
});
