import { describe, expect, it } from "vitest";

import { buildEndorsementRequestEmail } from "./certificateBrokerEmail";

describe("buildEndorsementRequestEmail", () => {
  it("names the policy, holder, endorsements, and recipient", () => {
    const draft = buildEndorsementRequestEmail({
      holderLegalName: "Acme Property Management",
      insuredName: "Northwoods LLC",
      policyNumber: "GL-123456",
      carrierName: "Test Carrier",
      requiredChanges: [
        "additional_insured",
        "waiver_of_subrogation",
        "primary_non_contributory",
      ],
      reasonMessage: "Policy evidence did not support the request.",
      recipientEmail: "broker@example.com",
      recipientName: "Jordan",
    });

    expect(draft.subject).toBe(
      "Endorsement request - Policy GL-123456 - Acme Property Management",
    );
    expect(draft.recipientEmail).toBe("broker@example.com");
    expect(draft.body).toContain("Hi Jordan,");
    expect(draft.body).toContain("CG 20 10 / CG 20 37");
    expect(draft.body).toContain("CG 24 04");
    expect(draft.body).toContain("CG 20 01");
    expect(draft.body).toContain("Once the endorsement is issued");
  });

  it("works without a policy number", () => {
    const draft = buildEndorsementRequestEmail({
      holderLegalName: "Lender LLC",
      requiredChanges: ["mortgagee"],
    });

    expect(draft.subject).toBe("Endorsement request - Lender LLC");
    expect(draft.body).toContain("mortgagee/lender");
  });
});
