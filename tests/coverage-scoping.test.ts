import { describe, expect, it } from "vitest";
import { applyCoverageDeclarationScoping } from "../convex/lib/coverageScoping";

describe("coverage declaration scoping", () => {
  it("does not deterministically collapse competing coverage limits", () => {
    const result = applyCoverageDeclarationScoping({
      nowMs: 123,
      fields: {
        coverages: [
          {
            name: "Errors and Omissions",
            limit: "$1,000,000",
            limitType: "per_claim",
            originalContent: "Available option: $1,000,000",
          },
          {
            name: "Errors and Omissions",
            limit: "$2,000,000",
            limitType: "per_claim",
            sourceSpanIds: ["span-2"],
          },
        ],
      },
      sourceSpans: [
        {
          id: "span-2",
          text: "Declarations - Errors and Omissions Limit $2,000,000 per claim",
          pageStart: 2,
        },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.fields.coverages).toHaveLength(2);
    expect(result.review.questions).toHaveLength(0);
  });

  it("recovers declaration coverages and schedules while separating billing", () => {
    const span = (id: string, pageStart: number, text: string, sourceUnit = "text") => ({
      id,
      pageStart,
      pageEnd: pageStart,
      sourceUnit,
      text,
    });
    const result = applyCoverageDeclarationScoping({
      nowMs: 123,
      fields: {
        premium: "$5,166.32",
        coverages: [
          { name: "MOTOR TRUCK CARGO - MTC", lineOfBusiness: "INMRC", limit: "$250,000", premium: "$3,272.40" },
          { name: "PHYSICAL DAMAGE - PD", lineOfBusiness: "AUTOB", limit: "$25,000", premium: "$1,300.00", limits: [{ kind: "other", label: "Vehicle PD Values", value: "$25,000" }] },
        ],
      },
      sourceSpans: [
        span("fee", 1, "COVERAGE: MGA Fee | MTC: $200.00 | PD: $200.00", "table_row"),
        span("total", 1, "TOTAL PREMIUM WITH FEES & TAXES: $5,166.32"),
        span("mtc", 11, "II. MOTOR TRUCK CARGO LIABILITY COVERAGE"),
        span("mtc-occ", 11, "A. Per ‘Occurrence’ Limit: $250,000"),
        span("mtc-auto", 11, "Per ‘Covered Auto’ / ‘Trailer’ Limit: $250,000"),
        span("mtc-location", 11, "Maximum Limit at Any One Location (Terminal/Warehouse): $250,000"),
        span("mtc-ded", 11, "B. Deductible: $2,500"),
        span("mtc-ded-scope", 11, "Per ‘Occurrence’ resulting in covered loss"),
        span("optional", 12, "IV. OPTIONAL COVERAGE ENDORSEMENTS"),
        span("declined", 12, "A. Refrigeration Breakdown Coverage Endorsement:"),
        span("declined-value", 12, "Decline Refrigeration Breakdown"),
        span("trailer", 12, "B. Trailer Interchange Coverage:"),
        span("trailer-occ", 12, "Per ‘Occurrence’ Limit: $50,000"),
        span("trailer-item", 12, "Per ‘Interchanged Trailer’ Limit: $50,000"),
        span("trailer-ded", 12, "Deductible per ‘Occurrence’: $2,500"),
        span("additional", 12, "V. ADDITIONAL COVERAGES"),
        span("additional-1", 12, "A. Debris Removal and Pollution Cleanup Expense Coverage: Limit: $5,000"),
        span("additional-2", 12, "B. Earned Freight Charges Coverage: Limit: $5,000"),
        span("additional-3", 12, "C. Terminal/Warehouse Coverage (Temporary Storage): Limit: $25,000"),
        span("additional-4", 12, "D. Contract Penalty Coverage: Limit: $5,000"),
        span("additional-5", 12, "E. Expediting Expenses Coverage: Limit: $5,000"),
        span("additional-6", 12, "F. Moving Equipment Coverage: Limit: $5,000"),
        span("additional-7", 12, "G. Fictitious Pickup / Voluntary Parting Coverage: Limit: $10,000"),
        span("mtc-schedule", 20, "Covered Auto Schedule - Motor Truck Cargo"),
        span("mtc-schedule-status", 20, "Coverage Active. Unscheduled Auto, Vehicles or Trailers are hereby excluded."),
        span("mtc-schedule-rows", 20, "1. VIN: REDACTED | PD Limit: $15,000 | Status: Active 2. VIN: REDACTED | PD Limit: $10,000 | Status: Active", "table_row"),
        span("pd", 21, "II. COMMERCIAL AUTO PHYSICAL DAMAGE COVERAGE"),
        span("pd-auto", 21, "A. Maximum Limit at Any One Vehicle: Actual Cash Value of Scheduled Autos"),
        span("pd-location", 21, "Maximum Limit at Any One Location (Terminal/Warehouse): $250,000"),
        span("pd-occ", 21, "Maximum per ‘Occurrence’: $250,000"),
        span("pd-hired", 21, "Hired Auto Physical Damage Limit: $25,000"),
        span("pd-ded", 21, "B. Deductible per ‘Auto’: $2,500"),
        span("pd-additional", 22, "III. ADDITIONAL COVERAGES - Per ‘Occurrence’"),
        span("pd-additional-1", 22, "1. Towing and Labor Coverage: $20,000"),
        span("pd-additional-2", 22, "2. Rental Reimbursement Coverage: $5,000"),
        span("pd-additional-3", 22, "3. Customized Equipment Coverage: $2,500"),
        span("pd-additional-45", 22, "4. Trucking Income Coverage: $2,500 5. Loan and Lease Gap Coverage: $5,000"),
        span("pd-additional-6", 22, "6. Expedited Repairs Coverage: $2,500"),
        span("pd-schedule", 30, "Covered Auto Schedule - Commercial Auto Physical Damage"),
        span("pd-schedule-status", 30, "Coverage Active. Unscheduled Auto, Vehicles or Trailers are hereby excluded."),
        span("pd-schedule-rows", 30, "1. VIN: REDACTED | PD Limit: $15,000 | Status: Active 2. VIN: REDACTED | PD Limit: $10,000 | Status: Active", "table_row"),
      ],
    });

    const coverages = result.fields.coverages as Array<Record<string, unknown>>;
    expect(coverages).toHaveLength(16);
    expect(coverages.some((coverage) => /Refrigeration/i.test(String(coverage.name)))).toBe(false);
    expect(coverages.every((coverage) => coverage.premium === undefined)).toBe(true);
    expect(coverages.find((coverage) => coverage.name === "MOTOR TRUCK CARGO - MTC")?.limits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Per 'Covered Auto' / 'Trailer' Limit", value: "$250,000" }),
        expect.objectContaining({ label: "Maximum Limit at Any One Location (Terminal/Warehouse)", value: "$250,000" }),
      ]),
    );
    expect(coverages.find((coverage) => coverage.name === "Terminal/Warehouse Coverage (Temporary Storage)")).toMatchObject({
      limit: "$25,000",
      lineOfBusiness: "INMRC",
    });
    expect(coverages.find((coverage) => coverage.name === "Towing and Labor Coverage")?.lineOfBusiness).toBe("AUTOB");
    expect(result.fields.coverageSchedules).toEqual([
      expect.objectContaining({ kind: "vehicle", items: [expect.any(Object), expect.any(Object)] }),
      expect.objectContaining({ kind: "vehicle", items: [expect.any(Object), expect.any(Object)] }),
    ]);
    expect(result.fields).toMatchObject({
      premium: "$4,572.40",
      premiumAmount: 4572.4,
      totalCost: "$5,166.32",
      totalCostAmount: 5166.32,
      premiumBreakdown: [
        expect.objectContaining({ amountValue: 3272.4 }),
        expect.objectContaining({ amountValue: 1300 }),
      ],
      taxesAndFees: [
        expect.objectContaining({ type: "fee", amountValue: 400 }),
        expect.objectContaining({ type: "tax", amountValue: 193.92 }),
      ],
    });
  });
});
