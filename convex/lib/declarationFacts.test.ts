import { describe, expect, test } from "vitest";
import { findDeclarationDiscrepancies, type DeclarationFactInput } from "./declarationFacts";

function fact(overrides: Partial<DeclarationFactInput> & { policyId: string }): DeclarationFactInput & { observedAt: number } {
  const displayValue = overrides.displayValue ?? "Value";
  return {
    orgId: "org1",
    policyId: overrides.policyId,
    fieldPath: overrides.fieldPath ?? "insuredName",
    fieldGroup: overrides.fieldGroup ?? "insured_identity",
    displayValue,
    normalizedValue: overrides.normalizedValue ?? displayValue.toLowerCase(),
    valueKind: overrides.valueKind ?? "string",
    observedAt: 1,
  };
}

describe("findDeclarationDiscrepancies", () => {
  test("does not flag conflicting values from a single policy", () => {
    const discrepancies = findDeclarationDiscrepancies([
      fact({ policyId: "policy1", displayValue: "ReLease Coverage Company Inc.", normalizedValue: "release coverage company inc" }),
      fact({ policyId: "policy1", displayValue: "Unknown", normalizedValue: "unknown" }),
    ]);

    expect(discrepancies).toHaveLength(0);
  });

  test("does not expose low-level coverage scoping conflicts", () => {
    const discrepancies = findDeclarationDiscrepancies([
      fact({
        policyId: "policy1",
        fieldPath: "coverages.0.limit",
        fieldGroup: "coverage_limit:coverage a aggregate limit",
        displayValue: "Coverage A Aggregate Limit: null",
        normalizedValue: "null",
      }),
      fact({
        policyId: "policy2",
        fieldPath: "coverages.0.limit",
        fieldGroup: "coverage_limit:coverage a aggregate limit",
        displayValue: "Coverage A Aggregate Limit: Referential",
        normalizedValue: "referential",
      }),
    ]);

    expect(discrepancies).toHaveLength(0);
  });

  test("flags user-facing conflicts across active policies", () => {
    const discrepancies = findDeclarationDiscrepancies([
      fact({ policyId: "policy1", displayValue: "Saint Lawrence Specialty Insurance", normalizedValue: "saint lawrence specialty insurance", fieldGroup: "carrier", fieldPath: "carrier" }),
      fact({ policyId: "policy2", displayValue: "Saint Lawrence Specialty Insurance Company", normalizedValue: "saint lawrence specialty insurance company", fieldGroup: "carrier", fieldPath: "carrier" }),
    ]);

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].fieldGroup).toBe("carrier");
    expect(discrepancies[0].affectedPolicyIds.sort()).toEqual(["policy1", "policy2"]);
  });
});
