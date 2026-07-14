import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { stripUngroundedSourceSensitiveValues } from "../convex/lib/extractionPostProcess";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("extraction source grounding", () => {
  it("drops hallucinated legacy General Agent identity fields that are absent from source spans", () => {
    const result = stripUngroundedSourceSensitiveValues(
      {
        carrier: "Northwoods Continental Insurance Company",
        security: "Northwoods Continental Insurance Company",
        broker: "Halverson Risk Advisors, LLC (Producer Code: HRA-NWC-2241)",
        brokerAgency: "Highland Risk Services",
        mga: "Highland Risk Services (a division of Highland Insurance Brokers, Ltd.)",
        policyNumber: "NWC-TEC-3110-26-01",
        insuredName: "Example Technology LLC",
      },
      [
        {
          id: "declarations",
          pageStart: 8,
          text: [
            "Policy Number NWC-TEC-3110-26-01",
            "Named Insured Example Technology LLC",
            "Producer Halverson Risk Advisors, LLC",
            "Northwoods Continental Insurance Company",
          ].join("\n"),
        },
      ],
    );

    expect(result.value).toMatchObject({
      carrier: "Northwoods Continental Insurance Company",
      security: "Northwoods Continental Insurance Company",
      broker: "Halverson Risk Advisors, LLC (Producer Code: HRA-NWC-2241)",
      policyNumber: "NWC-TEC-3110-26-01",
      insuredName: "Example Technology LLC",
    });
    expect(result.value.brokerAgency).toBeUndefined();
    expect(result.value.mga).toBeUndefined();
    expect(result.removed.map((item) => item.field)).toEqual(["mga", "brokerAgency"]);
  });

  it("keeps only source-backed fields from structured party objects", () => {
    const result = stripUngroundedSourceSensitiveValues(
      {
        insurer: {
          legalName: "Northwoods Continental Insurance Company",
          naicNumber: "12345",
          amBestRating: "A XV",
          stateOfDomicile: "Atlantis",
          sourceSpanIds: ["span-party"],
        },
        producer: {
          agencyName: "Halverson Risk Advisors, LLC",
          licenseNumber: "PR-123",
          contactName: "Invented Person",
          email: "producer@example.com",
          address: { street1: "1 Imaginary Way" },
          sourceSpanIds: ["span-party"],
        },
        generalAgent: {
          agencyName: "Diesel Insurance Solutions Inc.",
          licenseNumber: "21058436",
          address: { street1: "1600 Airport Freeway", city: "Bedford", state: "TX" },
          sourceSpanIds: ["span-party"],
        },
      },
      [
        {
          id: "span-party",
          text: [
            "Insurer Northwoods Continental Insurance Company NAIC 12345 AM Best A XV",
            "Producer Halverson Risk Advisors, LLC License PR-123",
            "General Agent Diesel Insurance Solutions Inc. License No. 21058436 1600 Airport Freeway Bedford TX",
          ].join("\n"),
        },
      ],
    );

    expect(result.value.insurer).toEqual({
      legalName: "Northwoods Continental Insurance Company",
      naicNumber: "12345",
      amBestRating: "A XV",
      sourceSpanIds: ["span-party"],
    });
    expect(result.value.producer).toEqual({
      agencyName: "Halverson Risk Advisors, LLC",
      licenseNumber: "PR-123",
      sourceSpanIds: ["span-party"],
    });
    expect(result.value.generalAgent).toEqual({
      agencyName: "Diesel Insurance Solutions Inc.",
      licenseNumber: "21058436",
      address: { street1: "1600 Airport Freeway", city: "Bedford", state: "TX" },
      sourceSpanIds: ["span-party"],
    });
    expect(result.removed.map((item) => item.field)).toEqual([
      "insurer.stateOfDomicile",
      "producer.contactName",
      "producer.email",
      "producer.address.street1",
    ]);
  });

  it("keeps source-backed structured party addresses including short region and country codes", () => {
    const result = stripUngroundedSourceSensitiveValues(
      {
        insurer: {
          legalName: "Carrier Inc.",
          address: {
            street1: "500 Market Street",
            city: "San Francisco",
            state: "CA",
            zip: "94105",
            country: "US",
          },
          sourceSpanIds: ["span-carrier"],
        },
      },
      [
        {
          id: "span-carrier",
          text: "Carrier Inc. 500 Market Street San Francisco CA 94105 US",
        },
      ],
    );

    expect(result.value.insurer).toEqual({
      legalName: "Carrier Inc.",
      address: {
        street1: "500 Market Street",
        city: "San Francisco",
        state: "CA",
        zip: "94105",
        country: "US",
      },
      sourceSpanIds: ["span-carrier"],
    });
    expect(result.removed).toEqual([]);
  });

  it("drops a compatibility address when its required street is unsupported", () => {
    const result = stripUngroundedSourceSensitiveValues(
      {
        insurer: {
          legalName: "Carrier Inc.",
          address: {
            street1: "1 Invented Way",
            city: "Toronto",
            state: "ON",
          },
          sourceSpanIds: ["span-carrier"],
        },
      },
      [{ id: "span-carrier", text: "Carrier Inc. Toronto ON" }],
    );

    expect(result.value.insurer).toEqual({
      legalName: "Carrier Inc.",
      sourceSpanIds: ["span-carrier"],
    });
    expect(result.removed).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "insurer.address.street1" }),
    ]));
  });

  it("drops identity records without valid source spans", () => {
    const result = stripUngroundedSourceSensitiveValues(
      {
        insuredAddress: {
          street1: "1 Imaginary Way",
          city: "Toronto",
          state: "ON",
          zip: "M5V 1A1",
        },
        additionalNamedInsureds: [
          { name: "Invented Affiliate LLC", relationship: "affiliate" },
        ],
        lossPayees: [
          { name: "Invented Lender", role: "loss_payee", sourceSpanIds: ["missing-span"] },
        ],
      },
      [
        {
          id: "span-insured",
          text: "Named Insured Example Technology LLC",
        },
      ],
    );

    expect(result.value).toEqual({});
    expect(result.removed.map((item) => item.field)).toEqual([
      "insuredAddress",
      "additionalNamedInsureds[0]",
      "lossPayees[0]",
    ]);
  });

  it("keeps source-backed identity records with valid source span ids", () => {
    const result = stripUngroundedSourceSensitiveValues(
      {
        insuredAddress: {
          street1: "500 Market Street",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
          sourceSpanIds: ["span-insured"],
        },
        additionalNamedInsureds: [
          {
            name: "Example Technology Canada Inc.",
            relationship: "affiliate",
            sourceSpanIds: ["span-affiliate"],
          },
          {
            name: "Invented Affiliate LLC",
            relationship: "affiliate",
            sourceSpanIds: ["span-affiliate"],
          },
        ],
        lossPayees: [
          { name: "First Bank", role: "loss_payee", sourceSpanIds: ["span-lender"] },
        ],
      },
      [
        {
          id: "span-insured",
          text: "Named Insured Example Technology LLC 500 Market Street San Francisco CA 94105",
        },
        {
          id: "span-affiliate",
          text: "Additional Named Insured Example Technology Canada Inc.",
        },
        {
          id: "span-lender",
          text: "Loss Payee First Bank",
        },
      ],
    );

    expect(result.value).toEqual({
      insuredAddress: {
        street1: "500 Market Street",
        city: "San Francisco",
        state: "CA",
        zip: "94105",
        sourceSpanIds: ["span-insured"],
      },
      additionalNamedInsureds: [
        {
          name: "Example Technology Canada Inc.",
          relationship: "affiliate",
          sourceSpanIds: ["span-affiliate"],
        },
      ],
      lossPayees: [
        { name: "First Bank", role: "loss_payee", sourceSpanIds: ["span-lender"] },
      ],
    });
    expect(result.removed).toEqual([
      { field: "additionalNamedInsureds[1]", value: "source span does not support value" },
    ]);
  });

  it("allows structured party objects to persist source provenance", () => {
    for (const path of ["convex/schema.ts", "convex/policies.ts"]) {
      const source = read(path);
      const structuredEntities = source.slice(
        source.indexOf("// Structured entity objects"),
      );
      const insurerBlock = structuredEntities.slice(
        structuredEntities.indexOf("insurer: v.optional"),
        structuredEntities.indexOf("producer: v.optional"),
      );
      const producerBlock = structuredEntities.slice(
        structuredEntities.indexOf("producer: v.optional"),
        structuredEntities.indexOf("lossPayees: v.optional"),
      );

      for (const block of [insurerBlock, producerBlock]) {
        expect(block).toContain("documentNodeId");
        expect(block).toContain("sourceSpanIds");
        expect(block).toContain("sourceTextHash");
      }
    }
  });
});
