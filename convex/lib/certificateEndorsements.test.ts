import { describe, expect, it } from "vitest";

import {
  applyEndorsementsToCertificateData,
  buildEndorsementDescription,
  summarizeEndorsementEvidence,
} from "./certificateEndorsements";

describe("certificate endorsements", () => {
  it("extracts form numbers and written-contract qualifiers from evidence", () => {
    const citations = summarizeEndorsementEvidence(
      ["additional_insured", "waiver_of_subrogation"],
      [
        {
          label: "CG 20 10 04 13 Additional Insured",
          excerpt: "Applies where required by written contract.",
        },
        {
          label: "Waiver",
          excerpt: "CG 24 04 waiver of subrogation endorsement.",
        },
      ],
    );

    expect(citations[0]).toMatchObject({
      kind: "additional_insured",
      formNumbers: ["CG 20 10 04 13", "CG 24 04"],
      requiresWrittenContract: true,
    });
  });

  it("composes source-backed remarks without inventing forms", () => {
    expect(
      buildEndorsementDescription([
        {
          kind: "primary_non_contributory",
          formNumbers: [],
          requiresWrittenContract: false,
        },
      ]),
    ).toContain("blanket endorsement on the policy");
  });

  it("sets ACORD 25 flags and appends remarks", () => {
    const data = applyEndorsementsToCertificateData(
      {
        title: "Certificate",
        issuedDateLabel: "Date",
        insuredName: "Test Insured",
        insurers: [{ letter: "A", name: "Carrier" }],
        coverages: [
          {
            type: "COMMERCIAL GENERAL LIABILITY",
            limits: [],
          },
        ],
        description: "Existing remarks",
      },
      {
        endorsements: [
          {
            kind: "additional_insured",
            formNumbers: ["CG 20 10"],
          },
          {
            kind: "waiver_of_subrogation",
            formNumbers: ["CG 24 04"],
          },
        ],
      },
    );

    expect(data.coverages[0]).toMatchObject({
      addlInsr: true,
      subrWvd: true,
    });
    expect(data.description).toContain("Existing remarks");
    expect(data.description).toContain("CG 20 10");
  });

  it("uses line-of-business metadata when the display label does not say liability", () => {
    const data = applyEndorsementsToCertificateData(
      {
        title: "Certificate",
        issuedDateLabel: "Date",
        insuredName: "Test Insured",
        insurers: [{ letter: "A", name: "Carrier" }],
        coverages: [
          {
            type: "Errors & Omissions",
            lineOfBusiness: "EO",
            limits: [],
          },
        ],
      },
      {
        endorsements: [
          {
            kind: "additional_insured",
            formNumbers: ["CG 20 10"],
          },
          {
            kind: "waiver_of_subrogation",
            formNumbers: ["CG 24 04"],
          },
        ],
      },
    );

    expect(data.coverages[0]).toMatchObject({
      addlInsr: true,
      subrWvd: true,
    });
  });
});
