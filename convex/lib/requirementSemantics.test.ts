import { describe, expect, test } from "vitest";
import {
  canPolicyMatchRequirement,
  classifyRequirementSemantics,
  nonPolicyRequirementReviewNote,
  requirementEvaluationTargetLabel,
  shouldEvaluateConnectedVendorRequirement,
  shouldEvaluateOwnOrgRequirement,
} from "./requirementSemantics";

describe("requirement semantics", () => {
  test("checks own-org customer E&O limits against own policy evidence", () => {
    const requirement = {
      appliesTo: "own_org" as const,
      title: "Technology E&O minimum",
      category: "professional",
      requirementText:
        "Partner must maintain E&O insurance with limits of at least CAD $1,000,000 each claim and CAD $1,000,000 annual aggregate.",
    };

    const semantics = classifyRequirementSemantics(requirement);

    expect(semantics.evaluationTarget).toBe("own_policy");
    expect(requirementEvaluationTargetLabel(semantics.evaluationTarget)).toBe(
      "Own policy",
    );
    expect(shouldEvaluateOwnOrgRequirement(requirement)).toBe(true);
    expect(canPolicyMatchRequirement(requirement)).toBe(true);
  });

  test("checks vendor requirements against connected vendor policy evidence", () => {
    const requirement = {
      appliesTo: "vendors" as const,
      title: "Vendor cyber minimum",
      category: "cyber",
      requirementText:
        "Contractors must carry cyber liability insurance with a $2,000,000 aggregate limit.",
    };

    const semantics = classifyRequirementSemantics(requirement);

    expect(semantics.evaluationTarget).toBe("connected_vendor_policy");
    expect(shouldEvaluateConnectedVendorRequirement(requirement)).toBe(true);
    expect(canPolicyMatchRequirement(requirement)).toBe(true);
  });

  test("does not mark subcontractor flowdown obligations met from current org policies", () => {
    const requirement = {
      appliesTo: "own_org" as const,
      title: "Subcontractor E&O requirement",
      category: "professional",
      requirementText:
        "Approved subcontractors or downstream partners must maintain E&O insurance at least as protective as the partner's requirements unless otherwise approved in writing.",
    };

    const semantics = classifyRequirementSemantics(requirement);

    expect(semantics.evaluationTarget).toBe("subcontractor_policy");
    expect(shouldEvaluateOwnOrgRequirement(requirement)).toBe(true);
    expect(canPolicyMatchRequirement(requirement)).toBe(false);
    expect(nonPolicyRequirementReviewNote(requirement)).toContain(
      "A direct policy held by the organization being checked does not satisfy it by itself",
    );
  });

  test("keeps procedural certificate and notice rows out of policy matching", () => {
    const requirement = {
      appliesTo: "own_org" as const,
      title: "Certificate and notice controls",
      category: "other",
      requirementText:
        "Provide a certificate of insurance and notify the customer of cancellation or non-renewal within 30 days.",
    };

    const semantics = classifyRequirementSemantics(requirement);

    expect(semantics.evaluationTarget).toBe("manual_control");
    expect(shouldEvaluateOwnOrgRequirement(requirement)).toBe(true);
    expect(canPolicyMatchRequirement(requirement)).toBe(false);
  });

  test("shared policy requirements participate in own-org and vendor checks", () => {
    const requirement = {
      appliesTo: "both" as const,
      title: "Professional liability minimum",
      category: "professional",
      requirementText:
        "Professional liability must have a $1,000,000 each claim limit.",
    };

    const semantics = classifyRequirementSemantics(requirement);

    expect(semantics.evaluationTarget).toBe("own_policy");
    expect(shouldEvaluateOwnOrgRequirement(requirement)).toBe(true);
    expect(shouldEvaluateConnectedVendorRequirement(requirement)).toBe(true);
    expect(canPolicyMatchRequirement(requirement)).toBe(true);
  });
});
