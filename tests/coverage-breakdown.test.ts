import { describe, expect, it } from "vitest";

import { buildCoverageBreakdown, formatCoverageBreakdownForPrompt } from "../convex/lib/coverageBreakdown";

describe("coverage breakdown formatting", () => {
  it("keeps duplicate schedule rows visible", () => {
    const text = formatCoverageBreakdownForPrompt({
      operationalProfile: {
        coverages: [
          {
            name: "Network Security and Privacy Liability",
            limits: [{ label: "Each Claim", value: "$1,000,000" }],
            deductible: "$5,000",
            formNumber: "SPS-TPC 03 25",
          },
          {
            name: "Network Security and Privacy Liability",
            limits: [{ label: "Aggregate Sub-Limit", value: "$1,000,000" }],
            deductible: "$5,000",
            formNumber: "SPS-END 001 03 25",
          },
        ],
      },
    });

    expect(text).toContain("Coverage schedules:");
    expect(text.match(/Network Security and Privacy Liability/g)).toHaveLength(2);
  });

  it("keeps schedule rows in source order without origin buckets", () => {
    const policy = {
      operationalProfile: {
        coverages: [
          {
            name: "Technology Professional Liability",
            limits: [{ label: "Each Claim", value: "$2,000,000" }],
            formNumber: "SPS-TPC 03 25",
          },
          {
            name: "Technology Professional Liability",
            limits: [{ label: "Policy Aggregate", value: "$2,000,000" }],
            formNumber: "SPS-TPC 03 25",
          },
        ],
      },
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.all.map((row) => row.name)).toEqual([
      "Technology Professional Liability",
      "Technology Professional Liability",
    ]);

    const text = formatCoverageBreakdownForPrompt(policy);
    expect(text).toContain("Coverage schedules:");
  });
});
