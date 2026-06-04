import { describe, expect, it } from "vitest";

import { normalizeCoverageName } from "./coverageNames";

describe("normalizeCoverageName", () => {
  it("uses the first column from serialized coverage rows", () => {
    expect(normalizeCoverageName(
      "Column 1: Bricking Loss — Each Loss / Aggregate | Column 2: $500,000 / $500,000 (part of Coverage Part B Aggregate)",
    )).toBe("Bricking Loss — Each Loss / Aggregate");
    expect(normalizeCoverageName(
      "Column 1: Item 8. Defense Expenses | Column 2: OUTSIDE THE LIMITS OF LIABILITY (Supplementary) Subject to a separate Supplementary Defense Annual Cap of $5,000,000 in the aggregate for all Coverage Parts combined.",
    )).toBe("Item 8. Defense Expenses");
  });

  it("normalizes coverage part labels without keeping parser labels", () => {
    expect(normalizeCoverageName(
      "Coverage Part: A. Technology Errors & Omissions Liability | Each Claim Limit: $5,000,000",
    )).toBe("Coverage Part A: Technology Errors & Omissions Liability");
    expect(normalizeCoverageName("Part: Regulatory Defense & Fines")).toBe("Regulatory Defense & Fines");
    expect(normalizeCoverageName("Part B Aggregate Limit")).toBe("Coverage Part B Aggregate Limit");
  });

  it("trims prose and amount suffixes from paragraph-derived labels", () => {
    expect(normalizeCoverageName(
      "A. Coverage Part C Refinements. Pursuant to Insuring Agreement C of the Policy, this endorsement extends coverage to Damages and Defense Expenses, subject to the $1,000,000 Each Claim Limit.",
    )).toBe("Coverage Part C Refinements");
    expect(normalizeCoverageName(
      "Part C Refinements (Insuring Agreement C) — $1,000,000 Each Claim Limit",
    )).toBe("Part C Refinements (Insuring Agreement C)");
  });
});
