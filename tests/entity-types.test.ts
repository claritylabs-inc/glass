import { describe, expect, it } from "vitest";
import { normalizeIrsEntityType } from "../convex/lib/entityTypes";

describe("IRS entity type normalization", () => {
  it.each([
    ["single-member LLC", "limited_liability_company"],
    ["S Corp", "s_corporation"],
    ["C Corporation", "corporation"],
    ["general partnership", "partnership"],
    ["sole proprietor", "sole_proprietorship"],
    ["nonprofit organization", "tax_exempt_organization"],
    ["municipal government", "government_entity"],
    ["family trust", "trust_estate"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeIrsEntityType(input)).toBe(expected);
  });

  it("bounds unknown model output to Other", () => {
    expect(normalizeIrsEntityType("unrecognized bespoke structure")).toBe("other");
  });
});
