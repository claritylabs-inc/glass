import { describe, expect, it } from "vitest";

import { formatCoverageBreakdownForPrompt } from "../convex/lib/coverageBreakdown";

describe("coverage breakdown formatting", () => {
  it("presents core and endorsement rows as one coverage list", () => {
    const text = formatCoverageBreakdownForPrompt({
      operationalProfile: {
        coverages: [
          {
            name: "Technology Professional Liability",
            coverageOrigin: "core",
            limits: [{ label: "Each Claim", value: "$2,000,000" }],
            deductible: "$10,000",
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

    expect(text).toContain("Coverage limits:");
    expect(text).toContain("Technology Professional Liability");
    expect(text).toContain("Network Security and Privacy Liability");
    expect(text).not.toContain("Core coverage limits");
    expect(text).not.toContain("Endorsement coverage limits");
  });
});
