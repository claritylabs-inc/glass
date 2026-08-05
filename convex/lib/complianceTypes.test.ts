import { describe, expect, it } from "vitest";
import { normalizeRequirementLineOfBusiness } from "./complianceTypes";

describe("normalizeRequirementLineOfBusiness", () => {
  it("preserves explicit unspecified coverage requirements", () => {
    expect(normalizeRequirementLineOfBusiness("UN")).toBe("UN");
  });

  it("normalizes retired codes without accepting invalid values as unspecified", () => {
    expect(normalizeRequirementLineOfBusiness("crime")).toBe("CRIM");
    expect(normalizeRequirementLineOfBusiness("not-a-line")).toBeUndefined();
  });
});
