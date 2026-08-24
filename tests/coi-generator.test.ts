import { describe, expect, it } from "vitest";
import {
  classifyPropertyCoverageSection,
  formatCertificatePropertyInformation,
  generateCoiPdf,
  policyToCoiData,
} from "../convex/lib/coiGenerator";

describe("policyToCoiData", () => {
  it("collapses unsupported personal policy types to the generic certificate fallback", () => {
    const data = policyToCoiData({
      linesOfBusiness: ["UN"],
      policyNumber: "WES0000518111",
      effectiveDate: "05/05/2026",
      expirationDate: "05/16/2026",
      carrier: "CUMIS General Insurance Company",
      producer: { agencyName: "Allianz Global Assistance" },
      limits: {},
      insuredName: "Terrence Wang",
    });

    expect(data.title).toBe("CERTIFICATE OF LIABILITY INSURANCE");
    expect(data.coverages).toHaveLength(1);
    expect(data.coverages[0]?.type).toBe("SEE POLICY");
  });

  it("keeps broker user information out of the producer box", () => {
    const data = policyToCoiData({
      linesOfBusiness: ["UN"],
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
      linesOfBusiness: ["EO", "OLIB", "EPLI"],
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
    expect(data.insurers[0]?.name).toBe("Markel American");
    expect(data.insuranceCompanyAddress).toContain("4521 Highwoods Parkway");
    expect(data.insuranceCompanyPhone).toBe("(800) 431-1270");
    expect(data.producerAgency).toBe("Fallback Producer");
    expect(data.insuredName).toBe("National Life Holding Company");
    expect(data.coverages.map((coverage) => coverage.type)).toEqual([
      "Professional Liability",
      "Cyber Liability",
      "Employment Practices Liability",
    ]);
    expect(data.coverages[0]?.policyNumber).toBe("MKLM7PLCA00098");
    expect(data.coverages[0]?.effectiveDate).toBe("5/1/2024");
  });

  it("uses policy-scoped party addresses without promoting external parties from client profile data", () => {
    const data = policyToCoiData(
      {
        linesOfBusiness: ["CGL"],
        policyNumber: "GL-200",
        insuredName: "Legacy Client",
        carrier: "Legacy Carrier",
        producer: {
          agencyName: "Legacy Producer",
          address: "Legacy producer address",
        },
        operationalProfile: {
          namedInsured: { value: "Ozumo Concepts International LLC" },
          operationsDescription: {
            value: "Restaurant operations and food service.",
          },
          parties: [
            {
              role: "named_insured",
              name: "Ozumo Concepts International LLC",
              address: {
                street1: "161 Steuart St",
                city: "San Francisco",
                state: "CA",
                zip: "94105",
                country: "United States",
              },
            },
            {
              role: "producer",
              name: "Policy Producer LLC",
              licenseNumber: "PR-123",
              address: { street1: "20 Broker Way", city: "Oakland", state: "CA", zip: "94607" },
            },
            {
              role: "carrier",
              name: "Policy Carrier Insurance Co.",
              naicNumber: "16823",
              address: { street1: "99 Carrier Plaza", city: "Chicago", state: "IL", zip: "60601" },
            },
            {
              role: "mga",
              name: "Policy MGA LLC",
              address: { street1: "1 MGA Way" },
            },
          ],
        },
      },
      {
        clientProfileFacts: {
          mailingAddress: {
            value: { street1: "Client fallback should not win" },
          },
          operationsDescription: {
            value: "Client profile operations fallback should not win.",
          },
        },
      },
    );

    expect(data.insuredAddress).toMatchObject({ street1: "161 Steuart St" });
    expect(data.producerAgency).toBe("Policy Producer LLC");
    expect(data.producerLicense).toBe("PR-123");
    expect(data.producerAddress).toMatchObject({ street1: "20 Broker Way" });
    expect(data.insurers[0]?.name).toBe("Policy Carrier Insurance Co.");
    expect(data.insurers[0]?.naic).toBe("16823");
    expect(data.insuranceCompanyAddress).toContain("99 Carrier Plaza");
    expect(data.description).toBe("Restaurant operations and food service.");
    expect(JSON.stringify(data)).not.toContain("Client fallback should not win");
    expect(JSON.stringify(data)).not.toContain("Policy MGA LLC");
  });

  it("uses exact structured operations precedence and does not synthesize from supplementary facts", () => {
    const policyValue = "Restaurant operations and food service at scheduled locations.";
    const policyData = policyToCoiData(
      {
        operationalProfile: {
          operationsDescription: { value: policyValue },
        },
        declarations: {
          fields: [{ field: "operationsDescription", value: "Legacy declaration wording" }],
        },
        supplementaryFacts: [{ key: "operations", value: "Synthetic-looking supplementary wording" }],
      },
      {
        clientProfileFacts: {
          operationsDescription: { value: "Client profile wording" },
        },
      },
    );
    const profileData = policyToCoiData(
      { supplementaryFacts: [{ key: "operations", value: "Do not synthesize this" }] },
      {
        clientProfileFacts: {
          operationsDescription: { value: "Exact client profile wording" },
        },
      },
    );
    const absentData = policyToCoiData({
      supplementaryFacts: [{ key: "operations", value: "Do not synthesize this" }],
    });

    expect(policyData.description).toBe(policyValue);
    expect(profileData.description).toBe("Exact client profile wording");
    expect(absentData.description).toBeUndefined();
  });

  it("maps structured commercial property declarations and location details", () => {
    const data = policyToCoiData({
      linesOfBusiness: ["PROPC"],
      policyNumber: "PROP-200",
      carrier: "Property Carrier",
      insuredName: "Property Insured",
      declarations: {
        line: "commercial_property",
        causesOfLossForm: "special",
        coinsurancePercent: 80,
        valuationMethod: "replacement_cost",
        blanketLimit: "$4,500,000",
        businessIncomeLimit: "$750,000",
        extraExpenseLimit: "$250,000",
      },
      locations: [{
        number: 1,
        address: {
          street1: "100 Market Street",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
        },
        description: "Main office and warehouse",
        buildingValue: "$3,000,000",
        contentsValue: "$1,000,000",
        businessIncomeValue: "$500,000",
        constructionType: "Masonry noncombustible",
        yearBuilt: 2018,
        squareFootage: 24000,
        protectionClass: "3",
        sprinklered: true,
        alarmType: "Central station",
        occupancy: "Office and warehouse",
      }],
    });

    expect(data.propertyInformation).toEqual({
      causesOfLossForm: "special",
      coinsurancePercent: 80,
      valuationMethod: "replacement_cost",
      blanketLimit: "$4,500,000",
      businessIncomeLimit: "$750,000",
      extraExpenseLimit: "$250,000",
      locations: [expect.objectContaining({
        number: 1,
        buildingValue: "$3,000,000",
        contentsValue: "$1,000,000",
        businessIncomeValue: "$500,000",
        constructionType: "Masonry noncombustible",
        yearBuilt: 2018,
        squareFootage: 24000,
        protectionClass: "3",
        sprinklered: true,
        alarmType: "Central station",
        occupancy: "Office and warehouse",
      })],
    });
    expect(data.propertyLocation).toBe("100 Market Street, San Francisco, CA 94105");
    const propertyText = formatCertificatePropertyInformation({ ...data, formCode: "acord27" });
    expect(propertyText).toContain(
      "Scheduled building value: $3,000,000 | Scheduled contents value: $1,000,000 | Scheduled business income value: $500,000",
    );
    expect(propertyText).not.toContain("$4,000,000");
  });

  it("maps source-backed covered assets without using the policy summary as property description", () => {
    const data = policyToCoiData({
      linesOfBusiness: ["INMRC", "AUTOB"],
      summary: "Generic policy summary that is not covered property declarations.",
      coverageSchedules: [
        {
          name: "Covered Auto Schedule - Motor Truck Cargo",
          kind: "vehicle",
          description: "Unscheduled autos are excluded.",
          items: [{
            label: "Scheduled vehicle 1",
            values: [
              { label: "VIN", value: "N/A" },
              { label: "PD Limit", value: "$15,000" },
              { label: "Status", value: "Active" },
            ],
            sourceSpanIds: ["vehicle-1"],
          }],
          sourceSpanIds: ["auto-schedule"],
        },
        {
          name: "Schedule of Locations",
          kind: "location",
          items: [{
            label: "Scheduled item 1",
            values: [
              { label: "Address", value: "100 Covered Property Way, Oakland, CA 94607" },
              { label: "Building Value", value: "$750,000" },
            ],
            sourceSpanIds: ["location-1"],
          }],
          sourceSpanIds: ["location-schedule"],
        },
      ],
    });

    expect(data.propertyDescription).toBeUndefined();
    expect(data.coveredAssetSchedules).toEqual([
      expect.objectContaining({
        name: "Covered Auto Schedule - Motor Truck Cargo",
        kind: "vehicle",
        items: [expect.objectContaining({ label: "Scheduled vehicle 1" })],
      }),
      expect.objectContaining({
        name: "Schedule of Locations",
        kind: "location",
        items: [expect.objectContaining({ label: "Scheduled item 1" })],
      }),
    ]);
  });

  it("classifies exact property certificate coverage sections", () => {
    const coverage = (lineOfBusiness: string, type: string) => ({
      lineOfBusiness,
      type,
      limits: [],
    });

    expect(classifyPropertyCoverageSection(coverage("PROPC", "Property - Commercial"))).toBe("property");
    expect(classifyPropertyCoverageSection(coverage("INMRC", "Inland Marine - Commercial"))).toBe("inland_marine");
    expect(classifyPropertyCoverageSection(coverage("MTRTK", "Motor Truck Cargo"))).toBe("inland_marine");
    expect(classifyPropertyCoverageSection(coverage("CRIM", "Employee Dishonesty"))).toBe("crime");
    expect(classifyPropertyCoverageSection(coverage("CRIME", "Crime"))).toBe("crime");
    expect(classifyPropertyCoverageSection(coverage("BANDM", "Boiler & Machinery"))).toBe("equipment_breakdown");
    expect(classifyPropertyCoverageSection(coverage("AUTOB", "Business Auto Physical Damage"))).toBe("other");
  });

  it("uses ACORD line-of-business labels for source-backed coverage rows", () => {
    const data = policyToCoiData({
      linesOfBusiness: ["EO", "OLIB"],
      policyNumber: "SPS-TPC-2026-00481-04",
      effectiveDate: "05/01/2026",
      expirationDate: "05/01/2027",
      carrier: "Sentinel Pacific Specialty Insurance Company",
      insuredName: "Clarity Labs Inc.",
      coverageForm: "claims_made",
      operationalProfile: {
        linesOfBusiness: ["EO", "OLIB"],
        coverages: [
          {
            name: "Technology Professional Liability",
            lineOfBusiness: "EO",
            limits: [
              { label: "Each Claim", value: "$2,000,000" },
              { label: "Policy Aggregate", value: "$2,000,000" },
            ],
          },
          {
            name: "Network Security and Privacy Liability",
            lineOfBusiness: "OLIB",
            limits: [
              { label: "Each Claim", value: "$1,000,000" },
              { label: "Policy Aggregate", value: "$1,000,000" },
            ],
          },
          {
            name: "Regulatory Proceedings",
            lineOfBusiness: "OLIB",
            limits: [{ label: "Aggregate Sub-Limit", value: "$250,000" }],
          },
        ],
      },
    });

    expect(data.coverages.map((coverage) => coverage.type)).toEqual([
      "Errors and Omissions",
      "Other Liability",
    ]);
    expect(data.coverages.map((coverage) => coverage.lineOfBusiness)).toEqual([
      "EO",
      "OLIB",
    ]);
    expect(data.coverages.map((coverage) => coverage.type).join(" ")).not.toMatch(
      /Technology Professional Liability|Network Security|Regulatory Proceedings/,
    );
    expect(data.coverages.flatMap((coverage) => coverage.limits.map((limit) => limit.label))).toEqual(
      expect.arrayContaining([
        "Technology Professional Liability - Each Claim",
        "Technology Professional Liability - Policy Aggregate",
        "Network Security And Privacy Liability - Each Claim",
        "Regulatory Proceedings - Aggregate Sub Limit",
      ]),
    );
  });

  it("keeps extracted deductible-only coverage rows for COI coverage tables", () => {
    const data = policyToCoiData({
      linesOfBusiness: ["UN"],
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

describe("COI PDF generation", () => {
  async function pdfText(pdf: Buffer) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items
        .map((item) => "str" in item ? item.str : "")
        .join(" "));
    }
    await document.destroy();
    return { pages, text: pages.join("\n") };
  }

  it("renders the generated PDF successfully", async () => {
    const data = policyToCoiData({
      linesOfBusiness: ["CGL"],
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

  it("renders source-backed producer licenses and insurer NAIC codes on every certificate form", async () => {
    const data = policyToCoiData({
      linesOfBusiness: ["PROPC"],
      policyNumber: "IDENTITY-1",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      insuredName: "Certificate Identity Insured",
      operationalProfile: {
        parties: [
          {
            role: "producer",
            name: "Source Producer LLC",
            licenseNumber: "PR-123",
            address: { street1: "20 Producer Way" },
          },
          {
            role: "insurer",
            name: "Source Insurer Company",
            naicNumber: "16823",
            address: { street1: "99 Insurer Plaza" },
          },
        ],
      },
    });
    const formCodes = [
      "acord25",
      "acord24",
      "acord27",
      "acord28",
      "acord29",
      "acord30",
      "acord31",
    ] as const;

    for (const formCode of formCodes) {
      const extracted = await pdfText(await generateCoiPdf({
        ...data,
        formCode,
        certificateHolder: "Certificate Holder",
      }));
      expect(extracted.pages[0], formCode).toContain("License #: PR-123");
      expect(extracted.pages[0], formCode).toContain("16823");
    }
  });

  it("renders structured property information on non-liability certificates", async () => {
    const data = policyToCoiData({
      linesOfBusiness: ["PROPC"],
      policyNumber: "PROP-1",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      carrier: "Property Carrier",
      insuredName: "Property Insured",
      limits: { combinedSingleLimit: "$5,000,000" },
      declarations: {
        line: "commercial_property",
        causesOfLossForm: "special",
        coinsurancePercent: 80,
        valuationMethod: "replacement_cost",
      },
      locations: [{
        number: 1,
        address: {
          street1: "100 Market Street",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
        },
        buildingValue: "$3,000,000",
        contentsValue: "$1,000,000",
        constructionType: "Masonry noncombustible",
        yearBuilt: 2018,
        squareFootage: 24000,
        protectionClass: "3",
        sprinklered: true,
        alarmType: "Central station",
        occupancy: "Office and warehouse",
      }],
    });

    const pdf = await generateCoiPdf({
      ...data,
      formCode: "acord27",
      propertyDescription: "Tenant improvements and business personal property",
    });
    const extracted = await pdfText(pdf);

    expect(pdf.toString("utf-8", 0, 4)).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(extracted.text).toContain("100 Market Street");
    expect(extracted.text).toMatch(/SCHEDULED\s+BUILDING VALUE/);
    expect(extracted.text).toMatch(/SCHEDULED\s+CONTENTS VALUE/);
    expect(extracted.text).toContain("$3,000,000");
    expect(extracted.text).toContain("$1,000,000");
    expect(extracted.text).toContain("Construction: Masonry noncombustible");
    expect(extracted.text).toContain("Built: 2018");
    expect(extracted.text).toContain("Area: 24,000 sq ft");
    expect(extracted.text).toContain("Sprinkler: Yes");
    expect(extracted.text).toContain("Alarm: Central station");
    expect(extracted.text).toContain("Occupancy: Office and warehouse");
  });

  it("renders the detailed ACORD 24 property matrix from exact source-backed terms", async () => {
    const data = {
      ...policyToCoiData({
        linesOfBusiness: ["PROPC", "INMRC", "CRIME", "BANDM", "AUTOB"],
        policyNumber: "PKG-24-001",
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        carrier: "Detailed Property Carrier",
        insuredName: "Detailed Property Insured",
        declarations: {
          causesOfLossForm: "special",
          coinsurancePercent: 80,
          valuationMethod: "replacement_cost",
          blanketLimit: "$4,500,000",
        },
        locations: [{
          number: 1,
          address: "500 Source Backed Way, Oakland, CA 94607",
          description: "Warehouse and office",
          occupancy: "Wholesale distribution",
          constructionType: "Masonry noncombustible",
          yearBuilt: 2020,
          squareFootage: 32000,
          buildingValue: "$9,876,543",
          contentsValue: "$1,234,567",
          businessIncomeValue: "$345,678",
          protectionClass: "2",
          sprinklered: true,
          alarmType: "Central station",
        }],
      }),
      formCode: "acord24" as const,
      certificateNumber: "CERT-24-001",
      revisionNumber: "3",
      certificateHolder: "Source Backed Certificate Holder\n100 Holder Street\nOakland, CA 94607",
      coverages: [
        {
          type: "Property - Commercial",
          lineOfBusiness: "PROPC",
          insurerLetter: "A",
          policyNumber: "PKG-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [
            { label: "Building Limit", value: "$2,000,000" },
            { label: "Business Personal Property Limit", value: "$750,000" },
            { label: "Business Income Limit", value: "$500,000" },
            { label: "Extra Expense Limit", value: "$250,000" },
            { label: "Building Deductible", value: "$25,000" },
            { label: "Contents Deductible", value: "$10,000" },
          ],
        },
        {
          type: "Earthquake",
          lineOfBusiness: "EQ",
          insurerLetter: "A",
          policyNumber: "PKG-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [{ label: "Earthquake Limit", value: "$1,000,000" }],
          deductible: "5%",
        },
        {
          type: "Wind",
          lineOfBusiness: "WIND",
          insurerLetter: "A",
          policyNumber: "PKG-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [{ label: "Wind Limit", value: "$1,500,000" }],
          deductible: "$50,000",
        },
        {
          type: "Flood",
          lineOfBusiness: "FLOOD",
          insurerLetter: "A",
          policyNumber: "FLOOD-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [{ label: "Flood Limit", value: "$500,000" }],
          deductible: "$25,000",
        },
        {
          type: "Inland Marine - Commercial",
          lineOfBusiness: "INMRC",
          insurerLetter: "A",
          policyNumber: "IM-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [{ label: "Scheduled Equipment", value: "$300,000" }],
          deductible: "$5,000",
        },
        {
          type: "Crime",
          lineOfBusiness: "CRIME",
          insurerLetter: "A",
          policyNumber: "CR-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [{ label: "Employee Theft", value: "$100,000" }],
          deductible: "$2,500",
        },
        {
          type: "Boiler & Machinery",
          lineOfBusiness: "BANDM",
          insurerLetter: "A",
          policyNumber: "EB-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [{ label: "Equipment Breakdown", value: "$1,000,000" }],
          deductible: "$10,000",
        },
        {
          type: "Business Auto Physical Damage",
          lineOfBusiness: "AUTOB",
          insurerLetter: "A",
          policyNumber: "AUTO-24-001",
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          limits: [{ label: "Physical Damage", value: "$250,000" }],
          deductible: "$1,000",
        },
      ],
    };

    const extracted = await pdfText(await generateCoiPdf(data));

    expect(extracted.pages[0]).toContain("CERTIFICATE OF PROPERTY INSURANCE");
    expect(extracted.pages[0]).toContain("LOCATION OF PREMISES / DESCRIPTION OF PROPERTY");
    expect(extracted.pages[0]).toContain("COVERED PROPERTY");
    expect(extracted.pages[0]).toMatch(/BLANKET BLDG & PERSONAL\s+PROPERTY/);
    expect(extracted.pages[0]).toContain("INLAND MARINE");
    expect(extracted.pages[0]).toContain("CRIME");
    expect(extracted.pages[0]).toContain("EQUIPMENT BREAKDOWN");
    expect(extracted.pages[0]).toContain("OTHER POLICY");
    expect(extracted.pages[0]).toContain("Building deductible: $25,000");
    expect(extracted.pages[0]).toContain("Contents deductible: $10,000");
    expect(extracted.pages[0]).toContain("Earthquake deductible: 5%");
    expect(extracted.pages[0]).toContain("Causes of loss: Special");
    expect(extracted.pages[0]).not.toContain("[ ]");
    expect(extracted.pages[0]).toContain("$2,000,000");
    expect(extracted.pages[0]).not.toContain("$9,876,543");
    expect(extracted.text).toContain("$9,876,543");
    expect(extracted.text).not.toContain("$11,111,110");
    expect(extracted.text).not.toContain("N/A");
    expect(extracted.text).not.toContain("See policy declarations");
  });

  it("uses covered-auto declarations in the ACORD 24 subject-matter field and asset schedule", async () => {
    const data = policyToCoiData({
      linesOfBusiness: ["INMRC", "AUTOB"],
      policyNumber: "AUTO-SCHEDULE-24",
      effectiveDate: "03/08/2026",
      expirationDate: "03/08/2027",
      carrier: "Scheduled Auto Carrier",
      insuredName: "Scheduled Auto Insured",
      summary: "Scheduled Auto Carrier policy AUTO-SCHEDULE-24 covering Inland Marine and Business Auto",
      coverages: [{
        name: "Motor Truck Cargo",
        lineOfBusiness: "INMRC",
        limit: "$250,000",
      }],
      coverageSchedules: [
        {
          name: "Covered Auto Schedule - Motor Truck Cargo",
          kind: "vehicle",
          description: "Unscheduled autos are excluded.",
          items: [
            {
              label: "Scheduled vehicle 1",
              values: [
                { label: "VIN", value: "N/A" },
                { label: "PD Limit", value: "$15,000" },
                { label: "Status", value: "Active" },
              ],
              sourceSpanIds: ["vehicle-1"],
            },
            {
              label: "Scheduled vehicle 2",
              values: [
                { label: "VIN", value: "N/A" },
                { label: "PD Limit", value: "$10,000" },
                { label: "Status", value: "Active" },
              ],
              sourceSpanIds: ["vehicle-2"],
            },
          ],
          sourceSpanIds: ["motor-truck-schedule"],
        },
        {
          name: "Covered Auto Schedule - Commercial Auto Physical Damage",
          kind: "vehicle",
          items: [
            {
              label: "Scheduled vehicle 1",
              values: [
                { label: "VIN", value: "1FTFW1E50NFA12345" },
                { label: "Year", value: "2022" },
                { label: "Make", value: "Ford" },
                { label: "Model", value: "F-150" },
              ],
              sourceSpanIds: ["vehicle-3"],
            },
            {
              label: "Scheduled vehicle 2",
              values: [{ label: "VIN", value: "2C3CDZAG8NH123456" }],
              sourceSpanIds: ["vehicle-4"],
            },
          ],
          sourceSpanIds: ["physical-damage-schedule"],
        },
      ],
    });

    const extracted = await pdfText(await generateCoiPdf({ ...data, formCode: "acord24" }));

    expect(extracted.pages[0]).toContain("COVERED AUTOS / SCHEDULED VEHICLES");
    expect(extracted.pages[0]).toContain("Scheduled vehicle count: 2");
    expect(extracted.pages[0]).toContain("Motor Truck Cargo - Scheduled vehicle 1");
    expect(extracted.pages[0]).toContain("PD Limit: $15,000");
    expect(extracted.pages[0]).not.toContain("Scheduled Auto Carrier policy AUTO-SCHEDULE-24");
    expect(extracted.text).toContain("COVERED AUTOS / PROPERTY SCHEDULE");
    expect(extracted.text).toContain("1FTFW1E50NFA12345");
    expect(extracted.text).toContain("2C3CDZAG8NH123456");
    expect(extracted.text).not.toContain("VIN: N/A");
  });

  it("preserves every covered vehicle through the final continuation page", async () => {
    const data = policyToCoiData({
      linesOfBusiness: ["AUTOB"],
      policyNumber: "FLEET-SCHEDULE-30",
      carrier: "Fleet Schedule Carrier",
      insuredName: "Fleet Schedule Insured",
      coverageSchedules: [{
        name: "Covered Auto Schedule - Commercial Auto Physical Damage",
        kind: "vehicle",
        items: Array.from({ length: 24 }, (_, index) => ({
          label: `Scheduled vehicle ${index + 1}`,
          values: [
            { label: "VIN", value: `VIN-${String(index + 1).padStart(3, "0")}` },
            { label: "Year", value: String(2020 + index % 6) },
            { label: "Make", value: "Fleet Make" },
            { label: "Model", value: `Fleet Model ${index + 1}` },
          ],
          sourceSpanIds: [`fleet-${index + 1}`],
        })),
        sourceSpanIds: ["fleet-schedule"],
      }],
    });

    const extracted = await pdfText(await generateCoiPdf({ ...data, formCode: "acord30" }));

    expect(extracted.pages.length).toBeGreaterThan(2);
    expect(extracted.text).toContain("COVERED AUTOS / PROPERTY SCHEDULE - CONTINUED");
    expect(extracted.text).toContain("VIN-001");
    expect(extracted.text).toContain("VIN-024");
    expect(extracted.text).toContain("Scheduled vehicle 24");
  });

  it("paginates detailed coverage rows without dropping the final row", async () => {
    const base = policyToCoiData({
      linesOfBusiness: ["PROPC"],
      policyNumber: "ROW-PAGINATION",
      carrier: "Pagination Carrier",
      insuredName: "Pagination Insured",
    });
    const coverages = Array.from({ length: 28 }, (_, index) => ({
      type: `Scheduled Coverage ${index + 1}`,
      lineOfBusiness: index % 2 === 0 ? "INMRC" : "PROPC",
      insurerLetter: "A",
      policyNumber: `ROW-${index + 1}`,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      limits: [{ label: `Exact Source Limit ${index + 1}`, value: `$${(index + 1) * 10000}` }],
      deductible: `$${(index + 1) * 100}`,
    }));

    const extracted = await pdfText(await generateCoiPdf({
      ...base,
      formCode: "acord28",
      coverages,
    }));

    expect(extracted.pages.length).toBeGreaterThan(1);
    expect(extracted.pages[0]).toContain("Scheduled Coverage 1");
    expect(extracted.text).toContain("Scheduled Coverage 28");
    expect(extracted.text).toContain("Exact Source Limit 28");
    expect(extracted.text).toContain("$280000");
  });

});
