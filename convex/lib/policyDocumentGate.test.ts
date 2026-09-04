import { describe, expect, it } from "vitest";
import { isSpecimenPolicyDocument } from "./policyDocumentGate";

describe("isSpecimenPolicyDocument", () => {

  it("accepts a specimen marker and disclaimer split across source spans", () => {
    expect(isSpecimenPolicyDocument([
      { text: "Saint Lawrence Specialty Insurance Company" },
      { text: "Policy form: Specimen Insurance Policy" },
      { text: "NOT AN ACTUAL POLICY OR EVIDENCE OF INSURANCE" },
    ])).toBe(true);
  });

  it("does not treat an ordinary policy or a passing mention as a specimen fixture", () => {
    expect(isSpecimenPolicyDocument([
      { text: "COMMERCIAL GENERAL LIABILITY POLICY" },
    ])).toBe(false);
    expect(isSpecimenPolicyDocument([
      { text: "Contact underwriting to request a specimen policy." },
    ])).toBe(false);
  });
});
