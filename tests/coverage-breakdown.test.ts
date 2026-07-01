import { describe, expect, it } from "vitest";

import { buildCoverageBreakdown, formatCoverageBreakdownForPrompt } from "../convex/lib/coverageBreakdown";

describe("coverage breakdown formatting", () => {
  it("keeps base policy and endorsement rows separated", () => {
    const text = formatCoverageBreakdownForPrompt({
      operationalProfile: {
        coverages: [
          {
            name: "Network Security and Privacy Liability",
            coverageOrigin: "core",
            limits: [{ label: "Each Claim", value: "$1,000,000" }],
            deductible: "$5,000",
            formNumber: "SPS-TPC 03 25",
          },
          {
            name: "Network Security and Privacy Liability",
            coverageOrigin: "endorsement",
            limits: [{ label: "Aggregate Sub-Limit", value: "$1,000,000" }],
            deductible: "$5,000",
            formNumber: "SPS-END 001 03 25",
          },
        ],
      },
    });

    expect(text).toContain("Policy coverage schedules:");
    expect(text).toContain("Endorsement coverage schedules:");
    expect(text.match(/Network Security and Privacy Liability/g)).toHaveLength(2);
  });

  it("keeps unknown-origin rows visible without classifying them as base policy", () => {
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
            coverageOrigin: "core",
            limits: [{ label: "Policy Aggregate", value: "$2,000,000" }],
            formNumber: "SPS-TPC 03 25",
          },
        ],
      },
    };

    const breakdown = buildCoverageBreakdown(policy);
    expect(breakdown.core.map((row) => row.name)).toEqual(["Technology Professional Liability"]);
    expect(breakdown.unclassified.map((row) => row.name)).toEqual(["Technology Professional Liability"]);

    const text = formatCoverageBreakdownForPrompt(policy);
    expect(text).toContain("Policy coverage schedules:");
    expect(text).toContain("Source-backed coverage schedules:");
  });
});
