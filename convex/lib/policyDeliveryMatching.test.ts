import { describe, expect, it } from "vitest";
import { deterministicRuleMatch } from "./policyDeliveryMatching";

describe("policyDeliveryMatching", () => {
  it("matches a general liability rule to a CGL policy by ACORD label", () => {
    expect(
      deterministicRuleMatch(
        {
          filters: {
            linesOfBusiness: ["general liability"],
          },
        },
        {
          carrier: "Zurich",
          linesOfBusiness: ["CGL"],
          coverages: [],
        },
      ),
    ).toBe(true);
  });

  it("matches cyber text to a CYBER policy through coverage evidence", () => {
    expect(
      deterministicRuleMatch(
        {
          filters: {
            linesOfBusiness: ["cyber"],
          },
        },
        {
          linesOfBusiness: ["CYBER"],
          coverages: [{ name: "Cyber Liability" }],
        },
      ),
    ).toBe(true);
  });

  it("matches legacy line-of-business text saved in the canonical filter", () => {
    expect(
      deterministicRuleMatch(
        {
          filters: {
            linesOfBusiness: ["general_liability"],
          },
        },
        {
          linesOfBusiness: ["CGL"],
          coverages: [],
        },
      ),
    ).toBe(true);
  });
});
