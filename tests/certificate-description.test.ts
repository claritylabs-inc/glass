import { describe, expect, it } from "vitest";
import type { CoiData } from "../convex/lib/coiGenerator";
import {
  buildCertificateDescriptionContext,
  buildCertificateDescriptionFallback,
  buildCertificateDescriptionPrompt,
  certificateDescriptionSystemPrompt,
  hasCertificateDescriptionContext,
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
    expect(context.declarationFacts.join(" ")).toContain("operationsDescription");

    const prompt = buildCertificateDescriptionPrompt({ context });
    expect(prompt).toContain("Project Phoenix");
    expect(prompt).toContain("CG 20 10");

    const fallback = buildCertificateDescriptionFallback(context);
    expect(fallback).toContain("Locations:");
    expect(fallback).toContain("Covered autos/vehicles:");
    expect(fallback).toContain("Additional insured:");
  });

  it("guards the model output against branding and form-name leakage", () => {
    expect(certificateDescriptionSystemPrompt()).toContain("Do not mention");
    expect(normalizeCertificateDescription("ACORD 25 Generated using Glass\nCovered location: 123 Market St")).toBe(
      "Covered location: 123 Market St",
    );
  });
});
