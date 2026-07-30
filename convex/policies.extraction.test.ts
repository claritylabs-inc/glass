/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  pipelineRejectExternalJob,
  pipelineSetStatus,
  updateExtractionInternal,
} from "./policies";

const modules = import.meta.glob("./**/*.ts");
const pipelineRejectExternalJobFn = pipelineRejectExternalJob as any;
const pipelineSetStatusFn = pipelineSetStatus as any;
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

  test("stores source provenance on extracted scheduled policy parties", async () => {
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
        additionalNamedInsureds: [
          {
            name: "Town of Milton",
            documentNodeId: "policy:source_node:additional-insured",
            sourceSpanIds: ["policy:span:additional-insured"],
            sourceTextHash: "additional-insured-hash",
            pageStart: 2,
            pageEnd: 2,
          },
        ],
        lossPayees: [
          {
            name: "First Bank",
            role: "loss_payee",
            documentNodeId: "policy:source_node:loss-payee",
            sourceSpanIds: ["policy:span:loss-payee"],
            sourceTextHash: "loss-payee-hash",
            pageStart: 4,
            pageEnd: 4,
          },
        ],
        mortgageHolders: [
          {
            name: "Second Bank",
            role: "mortgage_holder",
            documentNodeId: "policy:source_node:mortgage-holder",
            sourceSpanIds: ["policy:span:mortgage-holder"],
            sourceTextHash: "mortgage-holder-hash",
            pageStart: 5,
            pageEnd: 5,
          },
        ],
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.additionalNamedInsureds?.[0]).toMatchObject({
      name: "Town of Milton",
      documentNodeId: "policy:source_node:additional-insured",
      sourceSpanIds: ["policy:span:additional-insured"],
      sourceTextHash: "additional-insured-hash",
      pageStart: 2,
      pageEnd: 2,
    });
    expect(policy?.lossPayees?.[0]).toMatchObject({
      name: "First Bank",
      role: "loss_payee",
      documentNodeId: "policy:source_node:loss-payee",
      sourceSpanIds: ["policy:span:loss-payee"],
      sourceTextHash: "loss-payee-hash",
      pageStart: 4,
      pageEnd: 4,
    });
    expect(policy?.mortgageHolders?.[0]).toMatchObject({
      name: "Second Bank",
      role: "mortgage_holder",
      documentNodeId: "policy:source_node:mortgage-holder",
      sourceSpanIds: ["policy:span:mortgage-holder"],
      sourceTextHash: "mortgage-holder-hash",
      pageStart: 5,
      pageEnd: 5,
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

  test("leaves an existing bound policy active when re-extraction is rejected", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        policyNumber: "POL-REEXTRACT",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "complete",
        extractionDataStage: "final",
      });
      const factId = await ctx.db.insert("policyDeclarationFacts", {
        orgId,
        policyId,
        fieldPath: "coverages.0.limit",
        fieldGroup: "coverage_limit:general_liability",
        displayValue: "General Liability: $1,000,000",
        normalizedValue: "general liability 1000000",
        valueKind: "money",
        observedAt: 1,
        active: true,
        recordHash: "re-extraction-fact",
      });
      return { factId, policyId };
    });

    await t.mutation(pipelineRejectExternalJobFn, {
      jobId: ids.policyId,
      error: "Replacement document is not a bound policy.",
      archivePolicy: false,
    });

    const result = await t.run(async (ctx) => ({
      policy: await ctx.db.get(ids.policyId),
      fact: await ctx.db.get(ids.factId),
      run: await ctx.db
        .query("policyExtractionRuns")
        .withIndex("by_policyId", (q) => q.eq("policyId", ids.policyId))
        .first(),
    }));
    expect(result.policy).toMatchObject({
      carrier: "Known Carrier",
      policyNumber: "POL-REEXTRACT",
      pipelineStatus: "complete",
    });
    expect(result.run).toMatchObject({
      pipelineStatus: "error",
      pipelineError: "Replacement document is not a bound policy.",
    });
    expect(result.policy?.pipelineError).toBeUndefined();
    expect(result.policy?.deletedAt).toBeUndefined();
    expect(result.fact?.active).toBe(true);
  });

  test("keeps final policy workflows active when in-process re-extraction fails", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        policyNumber: "POL-IN-PROCESS",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "running",
        extractionDataStage: "final",
      });
      await ctx.db.insert("policyExtractionRuns", {
        policyId,
        pipelineStatus: "running",
        pipelineCheckpoint: {
          nextPhase: "extract",
          state: {
            policyVersionKind: "re_extraction",
            replacementPromotionStarted: false,
          },
          createdAt: 1,
        },
        createdAt: 1,
        updatedAt: 1,
      });
      return policyId;
    });

    await t.mutation(pipelineSetStatusFn, {
      jobId: policyId,
      status: "error",
      error: "Replacement document is not a bound policy.",
    });

    const result = await t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      run: await ctx.db
        .query("policyExtractionRuns")
        .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
        .first(),
    }));
    expect(result.policy?.pipelineStatus).toBe("complete");
    expect(result.policy?.pipelineError).toBeUndefined();
    expect(result.run).toMatchObject({
      pipelineStatus: "error",
      pipelineError: "Replacement document is not a bound policy.",
    });
  });

  test.each([
    {
      nextPhase: "extract",
      replacementPromotionStarted: true,
    },
    {
      nextPhase: "embed_and_store",
      replacementPromotionStarted: false,
    },
  ])(
    "fails closed when re-extraction errors after replacement promotion ($nextPhase)",
    async ({ nextPhase, replacementPromotionStarted }) => {
      const t = convexTest(schema, modules);
      const policyId = await t.run(async (ctx) => {
        const orgId = await ctx.db.insert("organizations", {
          name: "Client",
          type: "client",
        });
        const policyId = await ctx.db.insert("policies", {
          orgId,
          carrier: "Replacement Carrier",
          policyNumber: "POL-PROMOTED",
          insuredName: "Known Insured",
          linesOfBusiness: ["CGL"],
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          documentType: "policy",
          policyYear: 2026,
          isRenewal: false,
          coverages: [],
          pipelineStatus: "running",
          extractionDataStage: "final",
        });
        await ctx.db.insert("policyExtractionRuns", {
          policyId,
          pipelineStatus: "running",
          pipelineCheckpoint: {
            nextPhase,
            state: {
              policyVersionKind: "re_extraction",
              replacementPromotionStarted,
            },
            createdAt: 1,
          },
          createdAt: 1,
          updatedAt: 1,
        });
        return policyId;
      });

      await t.mutation(pipelineSetStatusFn, {
        jobId: policyId,
        status: "error",
        error: "Replacement evidence persistence failed.",
      });

      const result = await t.run(async (ctx) => ({
        policy: await ctx.db.get(policyId),
        run: await ctx.db
          .query("policyExtractionRuns")
          .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
          .first(),
      }));
      expect(result.policy).toMatchObject({
        pipelineStatus: "error",
        pipelineError: "Replacement evidence persistence failed.",
      });
      expect(result.run).toMatchObject({
        pipelineStatus: "error",
        pipelineError: "Replacement evidence persistence failed.",
      });
    },
  );
});
