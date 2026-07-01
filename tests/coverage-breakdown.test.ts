import { describe, expect, it } from "vitest";

import { formatCoverageBreakdownForPrompt } from "../convex/lib/coverageBreakdown";

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

    expect(text).toContain("Base policy coverages:");
    expect(text).toContain("Endorsement coverages:");
    expect(text.match(/Network Security and Privacy Liability/g)).toHaveLength(2);
  });
});
