/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { backfillBatchInternal } from "./backfillDeclarationFacts";

const modules = import.meta.glob("./**/*.ts");
const backfillBatchInternalFn = backfillBatchInternal as any;

describe("declaration fact backfill", () => {
  test("rebuilds stored final policies without extraction and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const base = {
        orgId,
        carrier: "Carrier",
        documentType: "policy" as const,
        linesOfBusiness: ["CGL"],
        policyYear: 2026,
        effectiveDate: "2026-01-01",
        expirationDate: "2027-01-01",
        isRenewal: false,
        coverages: [],
        pipelineStatus: "complete" as const,
      };
      await ctx.db.insert("policies", {
        ...base,
        policyNumber: "FINAL-1",
        insuredName: "Acme Incorporated",
        insuredAddress: { street1: "1 Main St", city: "Toronto", state: "ON" },
        extractionDataStage: "final",
        operationalProfile: {
          operationsDescription: {
            value: "Software implementation services.",
            sourceNodeIds: ["node-operations"],
            sourceSpanIds: ["span-operations"],
          },
        },
      });
      await ctx.db.insert("policies", {
        ...base,
        policyNumber: "PREVIEW-1",
        insuredName: "Preview Name",
        extractionDataStage: "preview",
      });
      await ctx.db.insert("policies", {
        ...base,
        policyYear: 2025,
        effectiveDate: "2025-01-01",
        expirationDate: "2026-01-01",
        policyNumber: "LEGACY-FINAL-1",
        insuredName: "Legacy Acme Incorporated",
        // Historical complete rows predate extractionDataStage.
      });
      return { orgId };
    });

    await expect(t.mutation(backfillBatchInternalFn, { dryRun: true, batchSize: 10 })).resolves.toMatchObject({
      dryRun: true,
      visited: 3,
      eligible: 2,
      isDone: true,
    });
    expect(await t.run(async (ctx) => ctx.db.query("policyDeclarationFacts").collect())).toHaveLength(0);

    const first = await t.mutation(backfillBatchInternalFn, { dryRun: false, batchSize: 10 });
    expect(first).toMatchObject({ eligible: 2, unchanged: 0, isDone: true });
    expect(first.inserted).toBeGreaterThan(0);
    await expect(t.run(async (ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
      profileFacts: {
        namedInsured: { value: "Acme Incorporated" },
        mailingAddress: { value: { street1: "1 Main St" } },
        operationsDescription: { value: "Software implementation services." },
      },
    });

    const factCount = (await t.run(async (ctx) => ctx.db.query("policyDeclarationFacts").collect())).length;
    await expect(t.mutation(backfillBatchInternalFn, { dryRun: false, batchSize: 10 })).resolves.toMatchObject({
      eligible: 2,
      inserted: 0,
      deactivated: 0,
      unchanged: 2,
    });
    expect(await t.run(async (ctx) => ctx.db.query("policyDeclarationFacts").collect())).toHaveLength(factCount);
  });
});
