import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
  formatComplianceRequirement,
  formatComplianceRequirementsContext,
} from "./complianceAgent";

describe("compliance requirement agent context", () => {
  it("includes authoritative assessment and requirement-source deal metadata", () => {
    const requirement = {
      _id: "req1" as Id<"insuranceRequirements">,
      scope: "own_org",
      title: "Errors and omissions",
      requirementText: "$2M each claim and $5M aggregate required.",
      lineOfBusiness: "EO",
      limits: [
        { kind: "per_claim", amount: 2_000_000 },
        { kind: "aggregate", amount: 5_000_000 },
      ],
      maxDeductible: { amount: 100_000 },
      coverageForm: "claims_made",
      retroactiveDateOnOrBefore: "2026-03-15",
      provisions: [],
      requiredForms: [],
      sourceType: "client_contract",
      sourceDocumentId: "source1" as Id<"requirementSourceDocuments">,
      sourceDocumentName: "Transformer Capital insurance requirements",
      sourceExcerpt: "Professional liability must be claims-made.",
      complianceCheck: {
        status: "unverified",
        reasons: [
          "limit_unverifiable:per_claim",
          "retroactive_date_unverifiable",
        ],
        matchedPolicyIds: ["policy1" as Id<"policies">],
        matchedPolicy: {
          carrier: "Test Carrier",
          policyNumber: "EO-1",
          coverageName: "Errors and Omissions",
          coverageLimit: "$5,000,000",
        },
      },
      requirementSource: {
        title: "Transformer Capital insurance requirements",
        sourceType: "client_contract",
        dealName: "Transformer Capital investment in Cove",
        dealType: "Investment",
        holder: { displayName: "Transformer Capital" },
      },
    } as unknown as Pick<
      Doc<"insuranceRequirements">,
      "_id" | "scope" | "title" | "requirementText"
    >;
    const output = formatComplianceRequirement(requirement);

    expect(output).toContain("currentComplianceStatus: unverified");
    expect(output).toContain("limit_unverifiable:per_claim");
    expect(output).toContain("certificateHolder: Transformer Capital");
    expect(output).toContain("dealName: Transformer Capital investment in Cove");
    expect(output).toContain("coverageForm: claims_made");
    expect(output).toContain("retroactiveDateOnOrBefore: 2026-03-15");
    expect(formatComplianceRequirementsContext([requirement])).toContain(
      "Glass would block generation until at least one is met or expiring_soon",
    );
  });
});
