/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backfill,
  report,
} from "./actions/backfillAcordTaxonomy";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const backfillFn = backfill as any;
const reportFn = report as any;

afterEach(() => {
  vi.useRealTimers();
});

describe("ACORD taxonomy dry-run orchestration", () => {
  it("processes and reports large dry runs through scheduled pages", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Backfill Client",
        type: "client",
      });
      for (let index = 0; index < 5; index += 1) {
        await ctx.db.insert("policies", {
          orgId,
          carrier: `Carrier ${index}`,
          policyNumber: `BACKFILL-${index}`,
          linesOfBusiness: ["UN"],
          documentType: "policy",
          policyYear: 2026,
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          extractionDataStage: "final",
          isRenewal: false,
          coverages: [],
          insuredName: "Backfill Client",
        });
      }
    });

    const started = await t.action(backfillFn, {
      dryRun: true,
      limit: 2,
    });

    expect(started).toMatchObject({
      status: "running",
      scannedCount: 2,
      continuationScheduled: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const completed = await t.action(reportFn, {
      runId: started.runId,
    });
    expect(completed).toMatchObject({
      runId: started.runId,
      status: "completed",
      pageCount: 3,
      scannedCount: 5,
      continuationScheduled: false,
    });
  });

  it("pages per-policy source evidence for dry-run and write backfills", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Travel Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Travel Carrier",
        policyNumber: "TRAVEL-PAGED",
        linesOfBusiness: ["UN"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        extractionDataStage: "final",
        isRenewal: false,
        coverages: [],
        insuredName: "Travel Client",
        operationalProfile: {
          documentType: "policy",
          linesOfBusiness: ["UN"],
          coverages: [],
        },
      });
      for (let index = 0; index < 12; index += 1) {
        const spanId = `padding-span-${index}`;
        await ctx.db.insert("sourceSpans", {
          orgId,
          policyId,
          spanId,
          documentId: String(policyId),
          sourceKind: "policy_pdf",
          pageStart: 2,
          text: `Unrelated wording ${index}`,
          textHash: `padding-hash-${index}`,
          createdAt: index,
        });
        await ctx.db.insert("sourceNodes", {
          orgId,
          policyId,
          nodeId: `padding-node-${index}`,
          documentId: String(policyId),
          kind: "section",
          title: `Section ${index}`,
          description: `Unrelated wording ${index}`,
          sourceSpanIds: [spanId],
          pageStart: 2,
          order: index,
          path: `Policy / Section ${index}`,
          embedding: Array.from({ length: 32 }, () => index),
          createdAt: index,
        });
      }
      await ctx.db.insert("sourceSpans", {
        orgId,
        policyId,
        spanId: "travel-plan-span",
        documentId: String(policyId),
        sourceKind: "policy_pdf",
        pageStart: 1,
        text: "Trip Cancellation & Interruption Plan - Coverage Summary",
        textHash: "travel-plan-hash",
        createdAt: 100,
      });
      await ctx.db.insert("sourceNodes", {
        orgId,
        policyId,
        nodeId: "travel-plan-node",
        documentId: String(policyId),
        kind: "section",
        title: "Trip Cancellation & Interruption Plan",
        description: "Trip Cancellation & Interruption Plan",
        textExcerpt:
          "Trip Cancellation & Interruption Plan - Coverage Summary",
        sourceSpanIds: ["travel-plan-span"],
        pageStart: 1,
        order: 100,
        path: "Policy / Trip Cancellation & Interruption Plan",
        embedding: Array.from({ length: 32 }, () => 1),
        createdAt: 100,
      });
      return policyId;
    });

    const dryRun = await t.action(backfillFn, {
      dryRun: true,
      limit: 1,
    });
    expect(dryRun).toMatchObject({
      status: "completed",
      scannedCount: 1,
      changedCount: 1,
      lineChangedCount: 1,
      productIdentitiesAdded: 1,
    });
    expect(
      await t.run(async (ctx) => (await ctx.db.get(policyId))?.linesOfBusiness),
    ).toEqual(["UN"]);

    const write = await t.action(backfillFn, {
      dryRun: false,
      limit: 1,
    });
    expect(write).toMatchObject({
      scannedCount: 1,
      changedCount: 1,
      lineChangedCount: 1,
      productIdentitiesAdded: 1,
    });
    const policy = await t.run(async (ctx) => await ctx.db.get(policyId));
    expect(policy?.linesOfBusiness).toEqual(["TRVL"]);
    expect(policy?.productIdentity).toMatchObject({
      name: {
        value: "Trip Cancellation & Interruption Plan",
        sourceNodeIds: ["travel-plan-node"],
        sourceSpanIds: ["travel-plan-span"],
      },
    });
  });
});
