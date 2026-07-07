import { describe, expect, it } from "vitest";
import { deterministicRuleMatch, policyLineHaystacks } from "./policyDeliveryMatching";

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

  it("matches cyber text to an OLIB policy through coverage evidence", () => {
    expect(policyLineHaystacks({
      linesOfBusiness: ["OLIB"],
      coverages: [{ name: "Cyber Liability" }],
    })).toContain("cyber liability");
    expect(
      deterministicRuleMatch(
        {
          filters: {
            linesOfBusiness: ["cyber"],
          },
        },
        {
          linesOfBusiness: ["OLIB"],
          coverages: [{ name: "Cyber Liability" }],
        },
      ),
    ).toBe(true);
  });

  it("matches legacy policy-type needles during the delivery-rule migration", () => {
    expect(
      deterministicRuleMatch(
        {
          filters: {
            policyTypes: ["general_liability"],
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
