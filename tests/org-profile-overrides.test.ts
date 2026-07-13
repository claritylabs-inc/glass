import { describe, expect, it } from "vitest";
import {
  effectiveOrganizationProfileFacts,
  resolveEffectiveOrganizationProfile,
} from "../convex/lib/orgProfileFacts";

describe("organization profile overrides", () => {
  const extracted = {
    name: "Cove",
    mailingAddress: { street1: "Legacy Address" },
    profileFacts: {
      namedInsured: { value: "Cove Mobility Inc.", source: { policyId: "policy" } },
      mailingAddress: { value: { street1: "10 Source Street", city: "Toronto" } },
      operationsDescription: { value: "Extracted operations" },
      additionalNamedInsureds: [{ value: "Cove Fleet Ltd." }],
    },
  };

  it("uses source-backed insured facts before legacy organization fields", () => {
    expect(resolveEffectiveOrganizationProfile(extracted)).toMatchObject({
      mailingAddress: { street1: "10 Source Street", city: "Toronto" },
      operationsDescription: "Extracted operations",
    });
  });

  it("uses editable organization overrides while keeping external parties absent", () => {
    const org = {
      ...extracted,
      profileOverrides: {
        mailingAddress: { street1: "20 Edited Street", country: "Canada" },
        entityType: "corporation",
        fein: "12-3456789",
        businessNumber: "123456789",
        operationsDescription: "Edited operations",
      },
    };
    const profile = resolveEffectiveOrganizationProfile(org);
    const facts = effectiveOrganizationProfileFacts(org);

    expect(profile.entityType).toBe("corporation");
    expect(profile.fein).toBe("12-3456789");
    expect(profile.businessNumber).toBe("123456789");
    expect(facts?.mailingAddress).toEqual({
      value: { street1: "20 Edited Street", country: "Canada", formatted: "20 Edited Street, Canada" },
    });
    expect(facts).not.toHaveProperty("producer");
    expect(facts).not.toHaveProperty("insurer");
    expect(facts).not.toHaveProperty("mga");
    expect(facts?.namedInsured).toEqual(extracted.profileFacts.namedInsured);
    expect(facts?.additionalNamedInsureds).toEqual(
      extracted.profileFacts.additionalNamedInsureds,
    );
  });
});
