/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { updateExtractionInternal } from "./policies";

const modules = import.meta.glob("./**/*.ts");
const updateExtractionInternalFn = updateExtractionInternal as any;

describe("policies.updateExtractionInternal", () => {
  test("stores SDK-formatted compatibility addresses for extracted policy parties", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        insurer: {
          legalName: "Carrier",
          address: {
            street1: "10751 Deerwood Park Blvd",
            street2: "Suite 200",
            city: "Jacksonville",
            state: "FL",
            zip: "32256",
            country: "US",
            formatted: "10751 Deerwood Park Blvd, Suite 200, Jacksonville, FL 32256",
          },
        },
        producer: {
          agencyName: "Producer",
          address: {
            street1: "100 Main Street",
            city: "Toronto",
            state: "ON",
            zip: "M5V 1A1",
            country: "CA",
            formatted: "100 Main Street, Toronto, ON M5V 1A1",
          },
        },
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.insurer?.address?.formatted).toBe(
      "10751 Deerwood Park Blvd, Suite 200, Jacksonville, FL 32256",
    );
    expect(policy?.producer?.address?.formatted).toBe(
      "100 Main Street, Toronto, ON M5V 1A1",
    );
  });

  test("stores source provenance on extracted insured addresses", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        insuredAddress: {
          street1: "175 Pearl Street",
          street2: "Suite 410",
          city: "Brooklyn",
          state: "NY",
          zip: "11201",
          country: "US",
          documentNodeId: "policy:source_node:declarations",
          sourceSpanIds: ["policy:span:6:104"],
          sourceTextHash: "address-hash",
        },
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.insuredAddress).toEqual({
      street1: "175 Pearl Street",
      street2: "Suite 410",
      city: "Brooklyn",
      state: "NY",
      zip: "11201",
      country: "US",
      documentNodeId: "policy:source_node:declarations",
      sourceSpanIds: ["policy:span:6:104"],
      sourceTextHash: "address-hash",
    });
  });

  test("drops provenance-only address shells without rejecting the extraction update", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        insuredAddress: {
          documentNodeId: "policy:source_node:insured",
          sourceSpanIds: ["policy:span:insured"],
        },
        insurer: {
          legalName: "Carrier",
          address: {
            formatted: "Address unavailable",
            documentNodeId: "policy:source_node:insurer",
            sourceSpanIds: ["policy:span:insurer"],
          },
          sourceSpanIds: ["policy:span:insurer"],
        },
        additionalNamedInsureds: [
          {
            name: "Known Subsidiary",
            address: {
              city: "Toronto",
              sourceSpanIds: ["policy:span:subsidiary"],
            },
          },
        ],
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.insuredAddress).toBeUndefined();
    expect(policy?.insurer).toEqual({
      legalName: "Carrier",
      sourceSpanIds: ["policy:span:insurer"],
    });
    expect(policy?.additionalNamedInsureds).toEqual([
      { name: "Known Subsidiary" },
    ]);
  });

  test("does not let final extraction erase known identity fields with unknown values", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        security: "Known Security",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        broker: "Known Broker",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        fileName: "known-policy.pdf",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [{ name: "Known Coverage", limit: "$1,000,000" }],
        extractionDataStage: "preview",
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        extractionDataStage: "final",
        carrier: "Unknown",
        security: undefined,
        policyNumber: "Unknown",
        insuredName: "Unknown",
        broker: "",
        effectiveDate: undefined,
        expirationDate: "Unknown",
        fileName: "Unknown.pdf",
        coverages: [],
        premium: "$100",
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy).toMatchObject({
      carrier: "Known Carrier",
      security: "Known Security",
      policyNumber: "POL-123",
      insuredName: "Known Insured",
      broker: "Known Broker",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      fileName: "known-policy.pdf",
      coverages: [{ name: "Known Coverage", limit: "$1,000,000" }],
      premium: "$100",
      extractionDataStage: "final",
    });
  });
});
