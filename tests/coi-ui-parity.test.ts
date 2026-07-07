import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("policy page COI generation UI", () => {
  it("keeps certificate-holder inputs aligned with the chat COI tool", () => {
    const ui = read("app/policies/[id]/policy-certificates-tab.tsx");
    const chatTools = read("convex/lib/chatTools.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");

    const sharedHolderFields = [
      "holderContactName",
      "holderEmail",
      "holderPhone",
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "postalCode",
    ];

    expect(ui).not.toContain("includeAdditionalInsured");
    expect(ui).not.toContain("Include additional insured");
    expect(ui).toContain('id="certificate-additional-insured"');
    expect(ui).toContain('id="certificate-waiver-of-subrogation"');
    expect(ui).toContain('id="certificate-primary-non-contributory"');
    expect(ui).toContain(
      "const additionalInsured = additionalInsuredName.trim() || undefined;",
    );
    expect(ui).toContain("additionalInsuredName: additionalInsured");
    expect(ui).toContain('additionalInsured ? "additional_insured" : undefined');
    expect(ui).toContain('includeWaiverOfSubrogation ? "waiver_of_subrogation" : undefined');
    expect(ui).toContain(
      'includePrimaryNonContributory ? "primary_non_contributory" : undefined',
    );
    expect(ui).toContain("requestText:");
    expect(ui).toContain("CertificateHoldState");
    expect(ui).toContain("emailDraft");
    expect(ui).toContain("mailto:");

    for (const field of sharedHolderFields) {
      expect(chatTools).toContain(field);
      expect(agentToolExecutors).toContain(`${field}: params.${field}`);
      expect(ui).toContain(`${field}: ${field}.trim() || undefined`);
    }
  });
});
