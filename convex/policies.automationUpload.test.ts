/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  hasPendingExtractionInternal,
  insertAutomationUploadInternal,
} from "./policies";

const modules = import.meta.glob("./**/*.ts");
const insertAutomationUploadFn = insertAutomationUploadInternal as any;
const hasPendingExtractionFn = hasPendingExtractionInternal as any;
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", { email: "user@example.com" });
    const fileId = await ctx.storage.store(new Blob(["policy"]));
    return { orgId, userId, fileId };
  });
  return { t, ...ids };
}

function policyFields() {
  return {
    carrier: "Carrier",
    policyNumber: "POL-1",
    linesOfBusiness: ["GL"],
    documentType: "policy" as const,
    policyYear: 2026,
    effectiveDate: "01/01/2026",
    expirationDate: "01/01/2027",
    isRenewal: false,
    coverages: [],
    insuredName: "Acme",
  };
}

describe("automation policy uploads", () => {
  test("deduplicates only when every incoming hash belongs to the same policy", async () => {
    const { t, orgId, userId, fileId } = await seed();
    const existingPolicyId = await t.run((ctx) =>
      ctx.db.insert("policies", {
        ...policyFields(),
        orgId,
        uploadFileSha256s: [hashA, hashB],
      }),
    );

    const duplicate = await t.mutation(insertAutomationUploadFn, {
      orgId,
      userId,
      fileId,
      fileName: "duplicate.pdf",
      uploadFileSha256s: [hashA, hashB],
    });
    expect(duplicate).toEqual({ created: false, policyId: existingPolicyId });

    const partialMatch = await t.mutation(insertAutomationUploadFn, {
      orgId,
      userId,
      fileId,
      fileName: "new-package.pdf",
      uploadFileSha256s: [hashA, hashC],
    });
    expect(partialMatch.created).toBe(true);
    expect(partialMatch.policyId).not.toBe(existingPolicyId);
  });

  test("does not combine hashes found on separate existing policies", async () => {
    const { t, orgId, userId, fileId } = await seed();
    await t.run(async (ctx) => {
      await ctx.db.insert("policies", {
        ...policyFields(),
        orgId,
        policyNumber: "POL-A",
        uploadFileSha256s: [hashA],
      });
      await ctx.db.insert("policies", {
        ...policyFields(),
        orgId,
        policyNumber: "POL-B",
        uploadFileSha256s: [hashB],
      });
    });

    const result = await t.mutation(insertAutomationUploadFn, {
      orgId,
      userId,
      fileId,
      fileName: "combined.pdf",
      uploadFileSha256s: [hashA, hashB],
    });
    expect(result.created).toBe(true);
  });

  test("suppresses compliance assessment only while extraction is active", async () => {
    const { t, orgId } = await seed();
    const { policyId, runId } = await t.run(async (ctx) => {
      const policyId = await ctx.db.insert("policies", {
        ...policyFields(),
        orgId,
        extractionDataStage: "placeholder",
        pipelineStatus: "running",
      });
      const runId = await ctx.db.insert("policyExtractionRuns", {
        policyId,
        pipelineStatus: "running",
        createdAt: 1,
        updatedAt: 1,
      });
      return { policyId, runId };
    });
    expect(await t.query(hasPendingExtractionFn, { orgId })).toBe(true);

    await t.run(async (ctx) => {
      await ctx.db.patch(policyId, {
        extractionDataStage: "final",
        pipelineStatus: "complete",
      });
      await ctx.db.patch(runId, {
        pipelineStatus: "complete",
        updatedAt: 2,
      });
    });
    expect(await t.query(hasPendingExtractionFn, { orgId })).toBe(false);
  });
});
