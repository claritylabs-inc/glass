/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { updateExtractionInternal } from "./policies";

const modules = import.meta.glob("./**/*.ts");
const updateExtractionInternalFn = updateExtractionInternal as any;

describe("policies.updateExtractionInternal", () => {
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
