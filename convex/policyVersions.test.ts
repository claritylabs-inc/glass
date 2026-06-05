/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  createForPolicyEvent,
  getCurrentForPolicy,
  listForPolicy,
} from "./policyVersions";

const modules = import.meta.glob("./**/*.ts");
const createForPolicyEventFn = createForPolicyEvent as any;
const getCurrentForPolicyFn = getCurrentForPolicy as any;
const listForPolicyFn = listForPolicy as any;

async function seedPolicyFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });
    const fileId = await ctx.storage.store(
      new Blob(["policy pdf bytes"], { type: "application/pdf" }),
    );
    const policyId = await ctx.db.insert("policies", {
      orgId,
      userId,
      fileId,
      fileName: "policy.pdf",
      carrier: "Carrier A",
      policyNumber: "POL-1",
      policyTypes: ["general_liability"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [{ name: "General Liability", limit: "$1,000,000" }],
      insuredName: "Client LLC",
      summary: "Original policy summary",
    });
    const policyFileId = await ctx.db.insert("policyFiles", {
      policyId,
      fileId,
      fileName: "policy.pdf",
      fileType: "declaration",
      orgId,
      createdAt: 1_000,
    });
    return { orgId, userId, policyId, fileId, policyFileId };
  });

  return { t, ...ids };
}

describe("policyVersions", () => {
  test("creates version 1 from the current policy snapshot and marks it current", async () => {
    const { t, policyId, userId, fileId, policyFileId } = await seedPolicyFixture();

    const versionId = await t.mutation(createForPolicyEventFn, {
      policyId,
      eventType: "initial_extraction",
      createdByUserId: userId,
      nowMs: 2_000,
    });

    const { policy, version } = await t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      version: await ctx.db.get(versionId) as any,
    }));

    expect(policy?.currentPolicyVersionId).toBe(versionId);
    expect(version).toMatchObject({
      policyId,
      versionNumber: 1,
      eventType: "initial_extraction",
      sourcePolicyFileIds: [policyFileId],
      sourceFileIds: [fileId],
      primaryFileId: fileId,
      isCurrent: true,
      createdAt: 2_000,
    });
    expect(version?.snapshot).toMatchObject({
      carrier: "Carrier A",
      policyNumber: "POL-1",
      insuredName: "Client LLC",
      coverages: [{ name: "General Liability", limit: "$1,000,000" }],
    });
  });

  test("creates re-extraction versions and resolves the latest current version", async () => {
    const { t, policyId, userId } = await seedPolicyFixture();
    const firstVersionId = await t.mutation(createForPolicyEventFn, {
      policyId,
      eventType: "initial_extraction",
      createdByUserId: userId,
      nowMs: 2_000,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(policyId, {
        carrier: "Carrier B",
        summary: "Updated extraction summary",
      });
    });

    const secondVersionId = await t.mutation(createForPolicyEventFn, {
      policyId,
      eventType: "re_extraction",
      createdByUserId: userId,
      nowMs: 3_000,
    });

    const { firstVersion, secondVersion, policy } = await t.run(async (ctx) => ({
      firstVersion: await ctx.db.get(firstVersionId) as any,
      secondVersion: await ctx.db.get(secondVersionId) as any,
      policy: await ctx.db.get(policyId),
    }));

    expect(firstVersion?.isCurrent).toBe(false);
    expect(secondVersion).toMatchObject({
      versionNumber: 2,
      eventType: "re_extraction",
      isCurrent: true,
    });
    expect(secondVersion?.snapshot).toMatchObject({
      carrier: "Carrier B",
      summary: "Updated extraction summary",
    });
    expect(policy?.currentPolicyVersionId).toBe(secondVersionId);

    const current = await t
      .withIdentity({ subject: `${userId}|session` })
      .query(getCurrentForPolicyFn, { policyId });
    expect(current?._id).toBe(secondVersionId);

    const versions = await t
      .withIdentity({ subject: `${userId}|session` })
      .query(listForPolicyFn, { policyId });
    expect(versions.map((version: { versionNumber: number }) => version.versionNumber)).toEqual([2, 1]);
  });
});
