import { describe, expect, it } from "vitest";
import {
  coverageRequirementSemanticKey,
  hasCheckableCoverageTerms,
} from "./complianceTypes";

type RequirementInput = Parameters<typeof coverageRequirementSemanticKey>[0];

const balancedEo = {
  kind: "coverage",
  scope: "own_org",
  lineOfBusiness: "EO",
  limits: [
    { kind: "per_claim", amount: 2_000_000, label: "$2M each claim" },
    { kind: "aggregate", amount: 5_000_000, label: "$5M aggregate" },
  ],
  maxDeductible: { amount: 100_000, label: "$100,000 maximum" },
  coverageForm: "claims_made",
  retroactiveDateOnOrBefore: "2026-03-15",
};

describe("coverageRequirementSemanticKey", () => {
  it("treats prose, labels, punctuation, and array order as non-material", () => {
    expect(coverageRequirementSemanticKey(balancedEo)).toBe(
      coverageRequirementSemanticKey({
        ...balancedEo,
        limits: [
          { kind: "aggregate", amount: 5_000_000, label: "different prose" },
          { kind: "per_claim", amount: 2_000_000 },
        ],
      }),
    );
  });

  const materialChanges: Array<[RequirementInput, string]> = [
    [{ limits: [{ kind: "per_claim", amount: 7_500_000 }] }, "limit amount"],
    [{ limits: [{ kind: "per_occurrence", amount: 2_000_000 }] }, "limit kind"],
    [{ maxDeductible: { amount: 25_000 } }, "deductible"],
    [{ coverageForm: "occurrence" }, "coverage form"],
    [{ retroactiveDateOnOrBefore: "2025-03-15" }, "retroactive date"],
    [{ provisions: ["additional_insured"] }, "provision"],
    [{ requiredForms: ["TC EO 01 (08/26)"] }, "required form"],
  ];

  it.each(materialChanges)("keeps a stricter requirement distinct when %s changes", (patch) => {
    expect(coverageRequirementSemanticKey({ ...balancedEo, ...patch })).not.toBe(
      coverageRequirementSemanticKey(balancedEo),
    );
  });
});

describe("hasCheckableCoverageTerms", () => {
  it.each([
    { coverageForm: "claims_made" as const },
    { retroactiveDateOnOrBefore: "2026-03-15" },
    { requiredForms: ["TC EO 01 (08/26)"] },
  ])("accepts a coverage requirement whose only typed term is %o", (terms) => {
    expect(hasCheckableCoverageTerms(terms)).toBe(true);
  });

  it("rejects prose without a typed coverage term", () => {
    expect(hasCheckableCoverageTerms({})).toBe(false);
  });
});
