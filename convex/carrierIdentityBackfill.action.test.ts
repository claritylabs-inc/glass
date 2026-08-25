/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audit,
  rebuildOne,
} from "./actions/backfillCarrierIdentity";
import { retryPending } from "./carrierIdentityBackfill";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const auditFn = audit as any;
const rebuildOneFn = rebuildOne as any;
const retryPendingFn = retryPending as any;

afterEach(() => {
  vi.useRealTimers();
});

describe("carrier identity backfill action", () => {
  it("rebuilds from source evidence beyond one bounded query page", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "HDI Global Specialty SE",
        policyNumber: "POL-PAGED",
        insuredName: "Client",
        linesOfBusiness: ["UN"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "complete",
        extractionDataStage: "final",
        operationalProfile: {
          documentType: "policy",
          linesOfBusiness: ["UN"],
          coverages: [],
          parties: [{
            role: "carrier",
            name: "HDI Global Specialty SE",
            address: {
              formatted: "Chicago, IL 60601",
            },
            sourceNodeIds: ["node-hdi"],
            sourceSpanIds: ["span-hdi"],
          }],
        },
      });
      for (let index = 0; index < 25; index += 1) {
        const spanId = `span-padding-${index}`;
        await ctx.db.insert("sourceSpans", {
          orgId,
          policyId,
          spanId,
          documentId: String(policyId),
          sourceKind: "policy_pdf",
          pageStart: index + 2,
          text: `Unrelated policy wording ${index}`,
          textHash: `hash-padding-${index}`,
          createdAt: index,
        });
        await ctx.db.insert("sourceNodes", {
          orgId,
          policyId,
          nodeId: `node-padding-${index}`,
          documentId: String(policyId),
          kind: "section",
          title: `Section ${index}`,
          description: `Unrelated policy wording ${index}`,
          sourceSpanIds: [spanId],
          order: index,
          path: `Policy / Section ${index}`,
          embedding: Array.from({ length: 32 }, () => index),
          createdAt: index,
        });
      }
      await ctx.db.insert("sourceSpans", {
        orgId,
        policyId,
        spanId: "span-hdi",
        documentId: String(policyId),
        sourceKind: "policy_pdf",
        pageStart: 1,
        text: "Carrier: HDI Global Specialty SE",
        textHash: "hash-hdi",
        createdAt: 100,
      });
      await ctx.db.insert("sourceNodes", {
        orgId,
        policyId,
        nodeId: "node-hdi",
        documentId: String(policyId),
        kind: "section",
        title: "Carrier",
        description: "Carrier: HDI Global Specialty SE",
        textExcerpt: "Carrier: HDI Global Specialty SE",
        sourceSpanIds: ["span-hdi"],
        order: 100,
        path: "Policy / Carrier",
        embedding: Array.from({ length: 32 }, () => 1),
        createdAt: 100,
      });
      return policyId;
    });

    const audited = await t.action(auditFn, { limit: 1 });
    expect(audited).toMatchObject({
      dryRun: true,
      scannedCount: 1,
      counts: {
        pending: 0,
        rebuilt: 1,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      },
      changes: [{
        policyId,
        outcome: "rebuilt",
        shouldEnrich: true,
        set: {
          carrier: "HDI Global Specialty SE",
          carrierIdentity: {
            displayName: "HDI Global Specialty SE",
            sourceName: "HDI Global Specialty SE",
            legalEntities: [{
              name: "HDI Global Specialty SE",
              sourceNodeIds: ["node-hdi"],
              sourceSpanIds: ["span-hdi"],
            }],
          },
        },
      }],
      exceptions: [],
      isDone: true,
    });
    const afterAudit = await t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      backfill: await ctx.db
        .query("carrierIdentityBackfillResults")
        .withIndex("policy", (query) =>
          query.eq("policyId", policyId)
        )
        .unique(),
    }));
    expect(afterAudit.policy?.carrierIdentity).toBeUndefined();
    expect(afterAudit.backfill).toBeNull();

    await t.action(rebuildOneFn, { policyId });

    const result = await t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      backfill: await ctx.db
        .query("carrierIdentityBackfillResults")
        .withIndex("policy", (query) =>
          query.eq("policyId", policyId)
        )
        .unique(),
    }));
    expect(result.backfill).toMatchObject({
      outcome: "rebuilt",
      shouldEnrich: true,
    });
    expect(result.policy?.carrierIdentity).toMatchObject({
      displayName: "HDI Global Specialty SE",
      sourceName: "HDI Global Specialty SE",
      legalEntities: [{
        name: "HDI Global Specialty SE",
        sourceNodeIds: ["node-hdi"],
        sourceSpanIds: ["span-hdi"],
      }],
    });
    expect(result.policy?.insurer).toMatchObject({
      legalName: "HDI Global Specialty SE",
      address: {
        formatted: "Chicago, IL 60601",
      },
    });
  });

  it("durably requeues stranded pending results", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Pending Carrier",
        policyNumber: "POL-PENDING",
        insuredName: "Client",
        linesOfBusiness: ["UN"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "running",
        extractionDataStage: "final",
      });
      await ctx.db.insert("carrierIdentityBackfillResults", {
        policyId,
        outcome: "pending",
        reason: "source_evidence_paging",
        shouldEnrich: false,
        updatedAt: 1,
      });
      return policyId;
    });

    await expect(t.mutation(retryPendingFn, {
      limit: 25,
    })).resolves.toMatchObject({
      scheduled: 1,
      isDone: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const result = await t.run(async (ctx) =>
      await ctx.db
        .query("carrierIdentityBackfillResults")
        .withIndex("policy", (query) =>
          query.eq("policyId", policyId)
        )
        .unique()
    );
    expect(result).toMatchObject({
      outcome: "skipped",
      reason: "extraction_in_progress",
    });
  });
});
