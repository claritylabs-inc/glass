import { describe, expect, it } from "vitest";
import { modelTaskForCall } from "./models";
import { normalizeProcurementIntake } from "./procurementIntake";

describe("procurement intake extraction", () => {
  it("keeps insurance obligations separate from placement facts", () => {
    const normalized = normalizeProcurementIntake({
      insuranceObligations: [{
        kind: "coverage", scope: null, title: " CGL ", requirementText: " $1M each occurrence ",
        lineOfBusiness: "cgl", limits: [{ kind: "each_occurrence", amount: 1_000_000, label: null }],
        maxDeductible: null, coverageForm: "occurrence", retroactiveDateOnOrBefore: null,
        provisions: ["additional_insured", "additional_insured"], requiredForms: null,
        minAmBestRating: null, minAmBestFinancialSize: null, admittedRequired: null,
        conditionType: null, noticeDays: null, sourceExcerpt: "CGL $1M each occurrence",
      }],
      placementSpecifications: [{
        key: " Building Square Feet ", label: " Square feet ", value: " 18,000 ",
        sourceExcerpt: "18,000 square foot warehouse",
      }],
    });

    expect(normalized.requirements[0].proposedRequirement).toMatchObject({
      lineOfBusiness: "CGL", scope: "own_org", provisions: ["additional_insured"],
    });
    expect(normalized.specifications).toEqual([{
      key: "building_square_feet", label: "Square feet", value: "18,000",
      sourceExcerpt: "18,000 square foot warehouse",
    }]);
  });

  it("uses the dedicated requirement extraction route", () => {
    expect(modelTaskForCall("requirement_extraction")).toBe("requirement_extraction");
  });
});
