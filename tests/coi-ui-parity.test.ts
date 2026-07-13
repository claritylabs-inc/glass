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
    const workspace = read("components/certificates/certificate-workspace.tsx");

    const sharedHolderFields = [
      "holderContactName",
      "holderEmail",
      "holderPhone",
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "postalCode",
      "country",
    ];

    expect(ui).not.toContain("includeAdditionalInsured");
    expect(ui).not.toContain("Include additional insured");
    expect(ui).not.toContain('id="certificate-additional-insured"');
    expect(ui).not.toContain('id="certificate-waiver-of-subrogation"');
    expect(ui).not.toContain('id="certificate-primary-non-contributory"');
    expect(ui).not.toContain("additionalInsuredName:");
    expect(ui).not.toContain("requestedEndorsements:");
    expect(ui).not.toContain('className="grid gap-3 sm:grid-cols-2"');
    expect(ui).not.toContain('type="tel"');
    expect(ui).toContain("<PhoneInput");
    expect(ui).toContain('defaultCountry="US"');
    expect(ui).toContain("isValidPhoneNumber(holderPhone)");
    expect(ui).toContain("<AddressAutofillInput");
    expect(ui).toContain('display="street1"');
    expect(ui).toContain('placeholder="Search for an address"');
    expect(ui).toContain("CertificateHoldState");
    expect(ui).toContain("emailDraft");
    expect(ui).toContain("mailto:");

    for (const field of sharedHolderFields) {
      expect(chatTools).toContain(field);
      expect(agentToolExecutors).toContain(`${field}: params.${field}`);
      expect(ui).toContain(`${field}: ${field}.trim() || undefined`);
    }
    expect(workspace).toContain("country: address?.country");
    expect(workspace).toContain("address.country");
    expect(ui).not.toContain('country: "US"');
  });
});
