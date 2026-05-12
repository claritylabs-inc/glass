import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { policyToCoiData } from "../convex/lib/coiGenerator";

const ROOT = join(__dirname, "..");

describe("policyToCoiData", () => {
  it("uses explicit policy type for the certificate title and coverage row", () => {
    const data = policyToCoiData({
      policyTypes: ["travel"],
      policyNumber: "WES0000518111",
      effectiveDate: "05/05/2026",
      expirationDate: "05/16/2026",
      carrier: "CUMIS General Insurance Company",
      producer: { agencyName: "Allianz Global Assistance" },
      limits: { combinedSingleLimit: "$1,000,000" },
      insuredName: "Terrence Wang",
    });

    expect(data.title).toBe("CERTIFICATE OF TRAVEL INSURANCE");
    expect(data.coverages).toHaveLength(1);
    expect(data.coverages[0]?.type).toBe("Travel");
  });

  it("keeps broker user information out of the producer box", () => {
    const data = policyToCoiData({
      policyTypes: ["travel"],
      brokerAgency: "Allianz Global Assistance",
      brokerContactName: "Terrence Wang",
      underwriter: "Allianz Travel Underwriting",
      policyNumber: "WES0000518111",
      effectiveDate: "05/05/2026",
      expirationDate: "05/16/2026",
      carrier: "CUMIS General Insurance Company",
      insuredName: "Terrence Wang",
    });

    expect(data.producerAgency).toBe("Allianz Global Assistance");
    expect(data.producerContact).toBe("Allianz Travel Underwriting");
  });

  it("uses declaration fields and extracted coverage details when available", () => {
    const data = policyToCoiData({
      policyTypes: ["professional_liability", "cyber", "epli"],
      policyNumber: "MJIL 1000 06 10",
      carrier: "Markel American",
      insuredName: "National Life Holding Company",
      coverageForm: "claims_made",
      producer: { agencyName: "Fallback Producer" },
      declarations: {
        fields: [
          { field: "insurerName", value: "MARKEL AMERICAN INSURANCE COMPANY" },
          { field: "insurerAddress1", value: "4521 Highwoods Parkway" },
          { field: "insurerCityStateZip", value: "Glen Allen, VA 23060" },
          { field: "insurerPhone", value: "(800) 431-1270" },
          { field: "policyNumber", value: "MKLM7PLCA00098" },
          { field: "policyPeriodStart", value: "5/1/2024" },
          { field: "policyPeriodEnd", value: "5/1/2025" },
          { field: "masterPolicyHolderAndMailingAddressName", value: "NATIONAL LIFE HOLDING COMPANY;" },
          { field: "masterPolicyHolderAndMailingAddressStreet", value: "ONE NATIONAL DRIVE;" },
          { field: "masterPolicyHolderAndMailingAddressCityStateZip", value: "MONTPELIER, VT 05604" },
          { field: "producerName", value: "BROWN & BROWN PROGRAM INSURANCE SERVICES, INC." },
          { field: "producerDBA", value: "DBA CALSURANCE ASSOCIATES" },
          { field: "producerAddressStreetSuite", value: "681 S PARKER STREET, SUITE 300" },
          { field: "producerAddressCityStateZip", value: "ORANGE, CA 92868" },
        ],
      },
      coverages: [
        { name: "Agent Limit of Liability", limit: "1000000", limitType: "per_claim" },
        { name: "Cyber Management", limit: "$100,000", limitType: "aggregate" },
        { name: "Employment Practices Coverage", limit: "$250,000", limitType: "per_occurrence" },
      ],
    });

    expect(data.title).toBe("CERTIFICATE OF INSURANCE");
    expect(data.insurers[0]?.name).toBe("MARKEL AMERICAN INSURANCE COMPANY");
    expect(data.insuranceCompanyAddress).toContain("4521 Highwoods Parkway");
    expect(data.insuranceCompanyPhone).toBe("(800) 431-1270");
    expect(data.producerAgency).toContain("BROWN & BROWN PROGRAM INSURANCE SERVICES");
    expect(data.insuredName).toBe("NATIONAL LIFE HOLDING COMPANY");
    expect(data.coverages.map((coverage) => coverage.type)).toEqual([
      "Professional Liability",
      "Cyber Liability",
      "Employment Practices Liability",
    ]);
    expect(data.coverages[0]?.policyNumber).toBe("MKLM7PLCA00098");
    expect(data.coverages[0]?.effectiveDate).toBe("5/1/2024");
  });
});

describe("COI PDF footer copy", () => {
  it("uses Glass attribution without ACORD marks or the old website", () => {
    const source = readFileSync(join(ROOT, "convex/lib/coiGenerator.ts"), "utf-8");

    expect(source).toContain("Generated using");
    expect(source).toContain("Glass");
    expect(source).toContain("from Clarity Labs");
    expect(source).toContain("GLASS_GLOBE_PATH");
    expect(source).not.toContain("C_GLASS_BLUE");
    expect(source).not.toContain("ACORD 25 (2016/03)  |  Generated");
    expect(source).not.toContain("claritylabs.dev");
  });
});
