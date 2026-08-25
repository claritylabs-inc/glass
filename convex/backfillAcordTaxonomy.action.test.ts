/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backfill,
  report,
  resume,
} from "./actions/backfillAcordTaxonomy";
import {
  applyPolicyDecisionInternal,
  recordWriteFailureInternal,
  startWriteRunInternal,
} from "./acordTaxonomyBackfillBatches";
import { acordTaxonomyBackfillPolicyFingerprint } from "./lib/acordTaxonomyBackfill";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const backfillFn = backfill as any;
const reportFn = report as any;
const resumeFn = resume as any;
const applyPolicyDecisionInternalFn = applyPolicyDecisionInternal as any;
const recordWriteFailureInternalFn = recordWriteFailureInternal as any;
const startWriteRunInternalFn = startWriteRunInternal as any;

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
    await expect(t.action(resumeFn, {
      runId: started.runId,
    })).resolves.toMatchObject({
      dryRun: true,
      status: "running",
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
      status: "completed",
      scannedCount: 1,
      changedCount: 1,
      lineChangedCount: 1,
      productIdentitiesAdded: 1,
    });
    await expect(t.action(reportFn, {
      runId: write.runId,
    })).resolves.toMatchObject({
      runId: write.runId,
      dryRun: false,
      status: "completed",
      pageCount: 1,
      scannedCount: 1,
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

  it("skips a final-stage policy while its extraction pipeline is running", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Running Extraction Client",
        type: "client",
      });
      await ctx.db.insert("policies", {
        orgId,
        carrier: "Travel Carrier",
        policyNumber: "TRAVEL-RUNNING",
        linesOfBusiness: ["UN"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        pipelineStatus: "running",
        extractionDataStage: "final",
        isRenewal: false,
        coverages: [],
        insuredName: "Running Extraction Client",
      });
    });

    await expect(t.action(backfillFn, {
      dryRun: true,
      limit: 1,
    })).resolves.toMatchObject({
      status: "completed",
      scannedCount: 1,
      changedCount: 0,
      skippedReasons: {
        extraction_in_progress: 1,
      },
    });
  });

  it("persists write progress and resumes a stranded multi-page run", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Write Backfill Client",
        type: "client",
      });
      for (let index = 0; index < 5; index += 1) {
        await ctx.db.insert("policies", {
          orgId,
          carrier: `Carrier ${index}`,
          policyNumber: `WRITE-BACKFILL-${index}`,
          linesOfBusiness: ["UN"],
          documentType: "policy",
          policyYear: 2026,
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          extractionDataStage: "final",
          isRenewal: false,
          coverages: [],
          insuredName: "Write Backfill Client",
        });
      }
    });

    const runId = "stranded-write-run";
    await t.mutation(startWriteRunInternalFn, {
      runId,
      limit: 2,
      createdAt: 1,
    });
    await expect(t.action(resumeFn, { runId })).resolves.toMatchObject({
      status: "running",
      continuationScheduled: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const completed = await t.action(reportFn, { runId });
    expect(completed).toMatchObject({
      runId,
      dryRun: false,
      status: "completed",
      pageCount: 3,
      scannedCount: 5,
      continuationScheduled: false,
      retryCount: 0,
    });
    const stored = await t.run(async (ctx) => ({
      run: await ctx.db
        .query("acordTaxonomyWriteRuns")
        .withIndex("run", (query) => query.eq("runId", runId))
        .unique(),
      pages: await ctx.db
        .query("acordTaxonomyWritePages")
        .withIndex("run", (query) => query.eq("runId", runId))
        .collect(),
    }));
    expect(stored.run).toMatchObject({
      status: "completed",
      retryCount: 0,
    });
    expect(stored.pages).toHaveLength(3);
  });

  it("retries a failed write page from its persisted cursor", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Retry Client",
        type: "client",
      });
      await ctx.db.insert("policies", {
        orgId,
        carrier: "Retry Carrier",
        policyNumber: "WRITE-RETRY",
        linesOfBusiness: ["UN"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        extractionDataStage: "final",
        isRenewal: false,
        coverages: [],
        insuredName: "Retry Client",
      });
    });

    const runId = "retry-write-run";
    await t.mutation(startWriteRunInternalFn, {
      runId,
      limit: 1,
      createdAt: 1,
    });
    await expect(t.mutation(recordWriteFailureInternalFn, {
      runId,
      cursor: null,
      expectedRetryCount: 0,
      error: "temporary evidence query failure",
      updatedAt: 2,
    })).resolves.toMatchObject({
      status: "running",
      continuationScheduled: true,
      retryCount: 1,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(t.action(reportFn, { runId })).resolves.toMatchObject({
      runId,
      status: "completed",
      pageCount: 1,
      scannedCount: 1,
      retryCount: 0,
    });
  });

  it("reports a committed policy before its write page is checkpointed", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Partial Page Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Travel Carrier",
        policyNumber: "PARTIAL-PAGE-TRAVEL",
        linesOfBusiness: ["UN"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        extractionDataStage: "final",
        isRenewal: false,
        coverages: [],
        insuredName: "Partial Page Client",
      });
    });
    const policy = await t.run(async (ctx) => await ctx.db.get(policyId));
    const expectedFingerprint = acordTaxonomyBackfillPolicyFingerprint(
      policy as unknown as Record<string, unknown>,
    );
    const runId = "partial-page-write-run";
    await t.mutation(startWriteRunInternalFn, {
      runId,
      limit: 2,
      createdAt: 1,
    });
    const args = {
      policyId,
      dryRun: false,
      expectedFingerprint,
      decision: {
        patch: {
          linesOfBusiness: ["TRVL"],
        },
        lineChanged: true,
        coverageCodesAdded: 0,
        productIdentityAdded: false,
        beforeLines: ["UN"],
        afterLines: ["TRVL"],
      },
      writeContext: {
        runId,
        cursor: null,
        cursorKey: "initial",
        createdAt: 2,
      },
    };

    await expect(
      t.mutation(applyPolicyDecisionInternalFn, args),
    ).resolves.toMatchObject({
      scannedCount: 1,
      changedCount: 1,
      lineChangedCount: 1,
    });
    await expect(
      t.mutation(applyPolicyDecisionInternalFn, args),
    ).resolves.toMatchObject({
      scannedCount: 1,
      changedCount: 1,
      lineChangedCount: 1,
    });

    const stored = await t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      results: await ctx.db
        .query("acordTaxonomyWritePolicyResults")
        .withIndex("run", (query) => query.eq("runId", runId))
        .collect(),
    }));
    expect(stored.policy?.linesOfBusiness).toEqual(["TRVL"]);
    expect(stored.results).toHaveLength(1);
    await expect(t.action(reportFn, { runId })).resolves.toMatchObject({
      runId,
      status: "running",
      pageCount: 0,
      scannedCount: 1,
      changedCount: 1,
      lineChangedCount: 1,
    });
  });
});
