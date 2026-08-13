import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import {
  buildCertificateRequirementPlan,
  certificateRequirementSignature,
  type CertificateRequirementPlanRow,
} from "./certificateRequirementPlan";

const policyId = (value: string) => value as Id<"policies">;
const requirementId = (value: string) => value as Id<"insuranceRequirements">;

function requirement(
  id: string,
  matchedPolicyIds: string[],
  options?: Partial<CertificateRequirementPlanRow>,
): CertificateRequirementPlanRow {
  return {
    requirementId: requirementId(id),
    status: "met",
    matchedPolicyIds: matchedPolicyIds.map(policyId),
    reasons: [],
    snapshot: {
      requirementId: requirementId(id),
      title: `Requirement ${id}`,
      requirementText: "Coverage is required.",
      provisions: [],
      updatedAt: 100,
    },
    ...options,
  };
}

describe("certificate requirement planning", () => {
  it("fans source requirements out across the smallest set of matching final policies", () => {
    const plan = buildCertificateRequirementPlan({
      policies: [
        { policyId: policyId("policy-primary"), final: true },
        { policyId: policyId("policy-auto"), final: true },
      ],
      requirements: [
        requirement("general-liability", ["policy-primary"], {
          snapshot: {
            ...requirement("general-liability", ["policy-primary"]).snapshot,
            lineOfBusiness: "CGL",
          },
        }),
        requirement("auto-liability", ["policy-auto"]),
      ],
    });

    expect(plan.targets.map((target) => target.policyId)).toEqual([
      "policy-primary",
      "policy-auto",
    ]);
    expect(plan.targets[0]?.requirementIds).toEqual(["general-liability"]);
    expect(plan.targets[0]?.includedLineOfBusinessCodes).toEqual(["CGL"]);
    expect(plan.targets[1]?.requirementIds).toEqual(["auto-liability"]);
    expect(plan.gaps).toEqual([]);
  });

  it("reports unmet requirements without claiming that a certificate satisfies them", () => {
    const plan = buildCertificateRequirementPlan({
      policies: [{ policyId: policyId("policy-primary"), final: true }],
      requirements: [
        requirement("umbrella", [], {
          status: "not_met",
          reasons: ["No umbrella policy was found."],
          summary: "The policy schedule contains no umbrella coverage.",
        }),
      ],
    });

    expect(plan.targets).toHaveLength(0);
    expect(plan.gaps).toEqual([
      expect.objectContaining({
        requirementId: "umbrella",
        status: "not_met",
        summary: "The policy schedule contains no umbrella coverage.",
      }),
    ]);
  });

  it("uses only one matching policy for each requirement", () => {
    const plan = buildCertificateRequirementPlan({
      policies: [
        { policyId: policyId("policy-first"), final: true },
        { policyId: policyId("policy-second"), final: true },
      ],
      requirements: [
        requirement("property", ["policy-first", "policy-second"]),
      ],
    });

    expect(plan.targets.map((target) => target.policyId)).toEqual(["policy-first"]);
  });

  it("keeps a simple selected policy with every coverage when no source is used", () => {
    const plan = buildCertificateRequirementPlan({
      primaryPolicyId: policyId("policy-primary"),
      policies: [{ policyId: policyId("policy-primary"), final: true }],
      requirements: [],
    });

    expect(plan.targets).toEqual([
      expect.objectContaining({
        policyId: "policy-primary",
        requirementIds: [],
        includedLineOfBusinessCodes: [],
      }),
    ]);
  });

  it("uses requirement revisions in the reuse signature", () => {
    const first = requirement("gl", ["policy-primary"]).snapshot;
    const revised = { ...first, updatedAt: 101 };
    expect(certificateRequirementSignature([first])).not.toBe(
      certificateRequirementSignature([revised]),
    );
  });
});
