import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { generateCoiPdf, policyToCoiData } from "../convex/lib/coiGenerator";

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

    expect(data.title).toBe("CERTIFICATE OF LIABILITY INSURANCE");
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

  it("keeps extracted deductible-only coverage rows for COI coverage tables", () => {
    const data = policyToCoiData({
      policyTypes: ["lease_guarantee"],
      policyNumber: "REL-123",
      effectiveDate: "07/01/2025",
      expirationDate: "06/30/2026",
      carrier: "ReLease Coverage Company",
      insuredName: "HH Red Stone",
      coverages: [
        {
          name: "RELEASE MID-LEASE COVERAGE",
          deductible: "$1,500",
          sectionRef: "3. PRODUCTS AND COVERAGES",
          originalContent:
            "RELEASE MID-LEASE COVERAGE Coverage Period: Jul 1, 2025 - Jun 30, 2026 Deductible: $1,500.00 Notice Period: 20 days",
        },
      ],
    });

    expect(data.coverages).toHaveLength(1);
    expect(data.coverages[0]?.type).toBe("RELEASE MID-LEASE COVERAGE");
    expect(data.coverages[0]?.deductible).toBe("$1,500");
    expect(data.coverages[0]?.sectionRef).toBe("3. PRODUCTS AND COVERAGES");
    expect(data.coverages[0]?.description).toContain("Notice Period: 20 days");
    expect(data.coverages[0]?.limits).toContainEqual({ label: "Deductible", value: "$1,500" });
  });
});

describe("COI PDF template copy", () => {
  it("uses the required notice and omits generated-by attribution", () => {
    const source = readFileSync(join(ROOT, "convex/lib/coiGenerator.ts"), "utf-8");
    const labels = readFileSync(join(ROOT, "convex/lib/acordForms/types.ts"), "utf-8");

    expect(source).toContain(
      "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER.",
    );
    expect(source).toContain("CERTIFICATE OF LIABILITY INSURANCE");
    expect(labels).toContain('acord25: "Certificate of Liability Insurance"');
    expect(labels).toContain('acord25: "certificate-of-liability"');
    expect(source).not.toContain("Generated using");
    expect(source).not.toContain("from Clarity Labs");
    expect(source).not.toContain("GLASS_GLOBE_PATH");
    expect(labels).not.toContain("ACORD 25 Certificate");
    expect(source).not.toContain("C_GLASS_BLUE");
    expect(source).not.toContain("ACORD 25 (2016/03)  |  Generated");
    expect(source).not.toContain("claritylabs.dev");
  });
});

describe("COI PDF generation", () => {
  it("uses the canonical holder block from certificate generation inputs", () => {
    const certificates = readFileSync(join(ROOT, "convex/certificates.ts"), "utf-8");
    const generateCoi = readFileSync(join(ROOT, "convex/actions/generateCoi.ts"), "utf-8");

    expect(certificates).toContain("certificateHolderDisplayBlock");
    expect(certificates).toContain("holderContactName");
    expect(certificates).toContain("holderEmail");
    expect(certificates).toContain("holderPhone");
    expect(generateCoi).toContain("holderContactName");
    expect(generateCoi).toContain("recordIssuedVersionInternal");
    expect(generateCoi).toContain("generateObjectForOrg");
    expect(generateCoi).toContain("buildCertificateDescriptionContext");
    expect(generateCoi).toContain('"summary"');
  });

  it("renders the generated PDF successfully", async () => {
    const data = policyToCoiData({
      policyTypes: ["general_liability"],
      policyNumber: "TEST-1",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      carrier: "Test Carrier",
      insuredName: "Test Insured",
      limits: { combinedSingleLimit: "$1,000,000" },
    });

    const pdf = await generateCoiPdf(data);

    expect(pdf.toString("utf-8", 0, 4)).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
