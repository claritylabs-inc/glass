import { describe, expect, it } from "vitest";
import type { CoiData } from "../convex/lib/coiGenerator";
import {
  buildCertificateDescriptionContext,
  buildCertificateDescriptionFallback,
  buildCertificateDescriptionPrompt,
  certificateDescriptionSystemPrompt,
  hasCertificateDescriptionContext,
  isPolicyOverviewDescription,
  isUsableCertificateDescription,
  normalizeCertificateDescription,
} from "../convex/lib/certificateDescription";

const baseCoiData: CoiData = {
  title: "CERTIFICATE OF LIABILITY INSURANCE",
  issuedDateLabel: "ISSUE DATE (YYYY/MM/DD)",
  insuredName: "Acme Services LLC",
  insurers: [{ letter: "A", name: "Example Mutual", naic: "12345" }],
  coverages: [
    {
      type: "COMMERCIAL GENERAL LIABILITY",
      insurerLetter: "A",
      policyNumber: "GL-100",
      effectiveDate: "2026-01-01",
      expirationDate: "2027-01-01",
      addlInsr: true,
      subrWvd: true,
      limits: [{ label: "EACH OCCURRENCE", value: "$1,000,000" }],
    },
  ],
};

describe("certificate description generation context", () => {
  it("feeds declaration, location, auto, and additional-insured facts to the model prompt", () => {
    const context = buildCertificateDescriptionContext(
      {
        policyNumber: "GL-100",
        policyTypes: ["general_liability", "business_auto"],
        carrier: "Example Mutual",
        effectiveDate: "2026-01-01",
        expirationDate: "2027-01-01",
        insuredEntityType: "LLC",
        summary: "Technology consulting and field installation services.",
        locations: [
          {
            number: 1,
            address: {
              street1: "123 Market St",
              city: "San Francisco",
              state: "CA",
              zip: "94105",
            },
            description: "Main office",
          },
        ],
        vehicles: [
          {
            number: 1,
            year: 2022,
            make: "Ford",
            model: "Transit",
            vin: "1FTBW9CKXP0000001",
            garageLocation: 1,
          },
        ],
        additionalNamedInsureds: [
          { name: "Northwinds Customer LLC", relationship: "scheduled additional insured" },
        ],
        declarations: {
          fields: [
            { field: "namedInsured", value: "Acme Services LLC" },
            { field: "operationsDescription", value: "Installation services at Project Phoenix." },
            { field: "coveredAutoSymbols", value: "Symbol 1 - Any Auto" },
          ],
        },
        operationalProfile: {
          additionalInsureds: [
            { name: "Acme Owner LLC", scope: "as required by written contract" },
          ],
          coveredAutos: [{ description: "Hired and non-owned autos" }],
        },
        supplementaryFacts: [
          { key: "operations", value: "Work is performed at customer locations." },
        ],
      },
      baseCoiData,
      {
        certificateHolder: "Northwinds Customer LLC\n900 Battery St\nSan Francisco, CA",
        requestKind: "additional_insured",
        additionalInsuredName: "Northwinds Customer LLC",
        endorsements: [
          {
            kind: "additional_insured",
            formNumbers: ["CG 20 10"],
            requiresWrittenContract: true,
          },
        ],
      },
    );

    expect(hasCertificateDescriptionContext(context)).toBe(true);
    expect(context.locations.join(" ")).toContain("123 Market St");
    expect(context.vehicles.join(" ")).toContain("Ford Transit");
    expect(context.vehicles.join(" ")).toContain("Symbol 1 - Any Auto");
    expect(context.additionalInsureds.join(" ")).toContain("Northwinds Customer LLC");
    expect(context.additionalInsureds.join(" ")).not.toContain("namedInsured");
    expect(context.declarationFacts.join(" ")).toContain("operationsDescription");
    expect(context.declarationFacts.join(" ")).not.toContain("namedInsured");

    const prompt = buildCertificateDescriptionPrompt({ context });
    expect(prompt).toContain("Project Phoenix");
    expect(prompt).toContain("CG 20 10");
    expect(prompt).not.toContain("GL-100");
    expect(prompt).not.toContain("Example Mutual");
    expect(prompt).not.toContain("2026-01-01");

    const fallback = buildCertificateDescriptionFallback(context);
    expect(fallback).toContain("Locations:");
    expect(fallback).toContain("Covered autos/vehicles:");
    expect(fallback).toContain("Additional insured:");
  });

  it("does not treat the named insured as an additional insured in fallback wording", () => {
    const context = buildCertificateDescriptionContext(
      {
        declarations: {
          fields: [
            { field: "namedInsured", value: "Clarity Labs Inc." },
            { field: "mailingAddress", value: "1070 Bridgeview Way, San Francisco, CA 94121" },
          ],
        },
      },
      {
        ...baseCoiData,
        insuredName: "Clarity Labs Inc.",
        description: undefined,
      },
      {},
    );

    expect(context.additionalInsureds.join(" ")).not.toContain("namedInsured");
    expect(buildCertificateDescriptionFallback(context)).not.toContain("Additional insured: namedInsured");
  });

  it("carries source-backed operations wording into prompt and fallback text", () => {
    const descriptionOfOperations =
      "Clarity Labs Inc. (Delaware C-Corporation), providing technology services including software development, AI/ML, and SaaS/PaaS offerings.";
    const context = buildCertificateDescriptionContext(
      {
        summary: "Generic professional liability policy summary.",
        declarations: {
          fields: [
            { field: "namedInsured", value: "Clarity Labs Inc." },
          ],
        },
      },
      {
        ...baseCoiData,
        insuredName: "Clarity Labs Inc.",
      },
      { descriptionOfOperations },
    );

    expect(context.operations[0]).toBe(descriptionOfOperations);
    expect(buildCertificateDescriptionPrompt({ context })).toContain("SaaS/PaaS offerings");
    expect(buildCertificateDescriptionFallback(context)).toContain("Operations: Clarity Labs Inc.");
  });

  it("guards the model output against branding and form-name leakage", () => {
    expect(certificateDescriptionSystemPrompt()).toContain("Do not mention");
    expect(normalizeCertificateDescription("ACORD 25 Generated using Glass\nCovered location: 123 Market St")).toBe(
      "Covered location: 123 Market St",
    );
  });

  it("rejects policy-overview filler instead of treating it as operations wording", () => {
    const policyOverview =
      "Technology Professional Liability and Cyber coverage for Clarity Labs Inc. under Sentinel Pacific Specialty Insurance Company policy SPS-TPC-2026-00481-04, term 05/01/2026 to 05/01/2027. No additional insured status granted. Certificate holder: Polychain Capital Fund IV, 548 Market Street, Suite 64375, San Francisco, CA 94104";

    expect(isPolicyOverviewDescription(policyOverview)).toBe(true);
    expect(isUsableCertificateDescription(policyOverview)).toBe(false);

    const context = buildCertificateDescriptionContext(
      {
        policyNumber: "SPS-TPC-2026-00481-04",
        carrier: "Sentinel Pacific Specialty Insurance Company",
        effectiveDate: "05/01/2026",
        expirationDate: "05/01/2027",
        insuredName: "Clarity Labs Inc.",
      },
      {
        ...baseCoiData,
        insuredName: "Clarity Labs Inc.",
        description: policyOverview,
      },
      {
        certificateHolder: "Polychain Capital Fund IV, 548 Market Street, Suite 64375, San Francisco, CA 94104",
      },
    );

    expect(buildCertificateDescriptionFallback(context, policyOverview)).toBe("");
    expect(buildCertificateDescriptionPrompt({ context })).not.toContain("SPS-TPC-2026-00481-04");
    expect(buildCertificateDescriptionPrompt({ context })).not.toContain("Sentinel Pacific Specialty Insurance Company");
    expect(buildCertificateDescriptionPrompt({ context })).not.toContain("Polychain Capital Fund IV");
  });

  it("does not turn named insured identity fields into additional-insured wording", () => {
    const context = buildCertificateDescriptionContext(
      {
        declarations: {
          fields: [
            { field: "namedInsured", value: "Clarity Labs Inc." },
            { field: "masterPolicyHolderAndMailingAddressName", value: "Clarity Labs Inc." },
          ],
        },
      },
      {
        ...baseCoiData,
        insuredName: "Clarity Labs Inc.",
      },
      {},
    );

    expect(context.additionalInsureds).toEqual([]);
    expect(context.declarationFacts).toEqual([]);
    expect(buildCertificateDescriptionFallback(context)).toBe("");
  });

  it("uses explicit operations wording as certificate description fallback", () => {
    const context = buildCertificateDescriptionContext(
      {},
      {
        ...baseCoiData,
        insuredName: "Clarity Labs Inc.",
      },
      {
        descriptionOfOperations:
          "Clarity Labs Inc. provides technology services including software development, AI/ML, SaaS/PaaS offerings.",
      },
    );

    const fallback = buildCertificateDescriptionFallback(context);
    expect(context.operations.join(" ")).toContain("technology services");
    expect(fallback).toContain("technology services");
    expect(fallback).not.toContain("policy");
  });
});
