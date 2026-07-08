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

  it("groups coverage schedules by ACORD line of business while preserving flat order", () => {
    const policy = {
      operationalProfile: {
        linesOfBusiness: ["CGL"],
        coverages: [
          {
            name: "Commercial General Liability",
            limits: [
              { label: "Each Occurrence", value: "$1,000,000" },
              { label: "General Aggregate", value: "$2,000,000" },
              { label: "Products-Completed Operations Aggregate", value: "$2,000,000" },
            ],
            deductible: "$10,000",
          },
        ],
      },
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.all.map((row) => row.name)).toEqual(["Commercial General Liability"]);
    expect(breakdown.groups).toEqual([
      expect.objectContaining({
        lineOfBusiness: "CGL",
        label: "Commercial General Liability",
        items: [
          expect.objectContaining({
            name: "Commercial General Liability",
            lineOfBusiness: "CGL",
            deductible: "$10,000",
          }),
        ],
      }),
    ]);
    expect(breakdown.unassigned).toEqual([]);

    const text = formatCoverageBreakdownForPrompt(policy);
    expect(text).toContain("Commercial General Liability coverage schedules:");
    expect(text).toContain("- Commercial General Liability: Each Occurrence $1,000,000");
    expect(text).not.toContain("Products-Completed Operations Aggregate coverage schedules:");
  });

  it("leaves ambiguous multi-line rows unassigned", () => {
    const policy = {
      operationalProfile: {
        linesOfBusiness: ["CGL", "PROPC"],
        coverages: [
          {
            name: "Package Coverage",
            limits: [
              { label: "Products-Completed Operations Aggregate", value: "$2,000,000" },
            ],
          },
        ],
      },
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.groups).toEqual([]);
    expect(breakdown.unassigned).toEqual([
      expect.objectContaining({
        name: "Package Coverage",
        lineOfBusiness: undefined,
      }),
    ]);
    expect(formatCoverageBreakdownForPrompt(policy)).toContain("Coverage schedules:");
  });
});
