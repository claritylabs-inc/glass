import { describe, expect, it } from "vitest";
import {
  normalizeHolderAddress,
  normalizeHolderEmail,
  normalizeHolderName,
  parseCertificateHolderCandidates,
} from "./certificateHolderPopulation";

describe("certificate holder population", () => {
  it("normalizes holder identity fields for per-org dedupe", () => {
    expect(normalizeHolderName(" Acme Holdings, Inc. ")).toBe("acme holdings, inc");
    expect(normalizeHolderEmail("RISK@ACME.EXAMPLE ")).toBe("risk@acme.example");
    expect(normalizeHolderAddress({ street1: "123 Main Street", city: "Austin", state: "TX", zip: "78701" }))
      .toBe("123 main st austin tx 78701");
  });

  it("extracts source-backed scheduled additional insured, loss payee, and mortgagee parties", () => {
    const candidates = parseCertificateHolderCandidates({
      operationalProfile: {
        additionalInsuredEligibility: {
          scheduledAdditionalInsureds: [{
            name: "Project Owner LLC",
            address: { street1: "10 Market Street", city: "San Francisco", state: "CA" },
            email: "coi@owner.example",
            endorsementTitle: "Scheduled Additional Insured endorsement",
            sourceNodeIds: ["node-ai"],
            sourceSpanIds: ["span-ai"],
          }],
        },
        parties: [{
          role: "certificate_holder",
          name: "Allowed Holder Inc",
          sourceNodeIds: ["node-holder"],
          sourceSpanIds: ["span-holder"],
        }],
      },
      policy: {
        lossPayees: [{
          name: "Equipment Lender",
          role: "loss_payee",
          sourceSpanIds: ["span-loss"],
        }],
        mortgageHolders: [{
          name: "First Bank",
          role: "mortgagee",
          sourceSpanIds: ["span-mortgage"],
        }],
      },
    });

    expect(candidates.map((candidate) => candidate.relationshipKind).sort()).toEqual([
      "additional_insured",
      "certificate_holder",
      "loss_payee",
      "mortgagee",
    ]);
    expect(candidates.find((candidate) => candidate.name === "Project Owner LLC")?.sourceNodeIds).toEqual(["node-ai"]);
    expect(candidates.find((candidate) => candidate.name === "Equipment Lender")?.sourceSpanIds).toEqual(["span-loss"]);
  });

  it("skips class-only blanket eligibility so extraction does not create certificates", () => {
    const candidates = parseCertificateHolderCandidates({
      operationalProfile: {
        additionalInsuredEligibility: {
          withoutEndorsement: [{ category: "Owners where required by written contract" }],
          scheduledAdditionalInsureds: [{ name: "Any person or organization required by contract" }],
        },
      },
    });

    expect(candidates).toEqual([]);
  });
});
