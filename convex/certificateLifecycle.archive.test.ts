/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { policyCertificateDedupeKey } from "./lib/certificateIdentity";

const modules = import.meta.glob("./**/*.ts");
const archiveFn = api.certificateLifecycle.archive as any;
const unarchiveFn = api.certificateLifecycle.unarchive as any;
const findIssuedCandidatesFn =
  internal.certificateLifecycle.findIssuedCertificateHolderCandidatesInternal as any;
const getOrCreateParentFn =
  internal.certificateLifecycle.getOrCreateParentInternal as any;
const listVersionsFn = internal.certificateLifecycle.listVersionsInternal as any;
const nextVersionNumberFn =
  internal.certificateLifecycle.nextVersionNumberInternal as any;
const openJobStatuses = [
  "review_required",
  "blocked_missing_contact",
  "sending",
] as const;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function seedIssuedCertificate() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const orgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      email: "client@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      carrier: "Carrier",
      policyNumber: "POL-1",
      linesOfBusiness: ["CGL"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Client",
      uploadedByUserId: userId,
    });
    const holderId = await ctx.db.insert("certificateHolders", {
      orgId,
      displayName: "Acme Holder",
      normalizedName: "acme holder",
      email: "holder@example.com",
      normalizedEmail: "holder@example.com",
      source: "manual",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    const dedupeKey = policyCertificateDedupeKey({
      orgId: String(orgId),
      policyId: String(policyId),
      holderId: String(holderId),
    });
    const certificateId = await ctx.db.insert("policyCertificates", {
      orgId,
      policyId,
      holderId,
      status: "active",
      dedupeKey,
      source: "policy_page",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob(["certificate"], { type: "application/pdf" }),
    );
    const versionId = await ctx.db.insert("certificateVersions", {
      orgId,
      certificateId,
      holderId,
      policyId,
      versionNumber: 1,
      status: "issued",
      fileId,
      fileName: "coi.pdf",
      fileSize: 11,
      certificateHolderName: "Acme Holder",
      source: "policy_page",
      requestKind: "holder",
      issuedAt: now,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(certificateId, {
      currentVersionId: versionId,
      latestIssuedVersionId: versionId,
      lastIssuedAt: now,
      updatedAt: now,
    });

    for (const status of [...openJobStatuses, "sent"] as const) {
      await ctx.db.insert("certificateWorkflowJobs", {
        orgId,
        certificateId,
        certificateVersionId: versionId,
        holderId,
        policyId,
        kind: "manual_review",
        status,
        idempotencyKey: `job:${status}`,
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      orgId,
      userId,
      policyId,
      holderId,
      certificateId,
      versionId,
      dedupeKey,
    };
  });

  return { t, ...ids };
}

describe("certificateLifecycle archive", () => {
  test("archives the parent without clearing versions and cancels open workflow jobs", async () => {
    const { t, userId, certificateId, versionId } = await seedIssuedCertificate();

    const result = await t.withIdentity(sessionFor(userId)).mutation(archiveFn, {
      certificateId,
    });

    expect(result).toMatchObject({ status: "archived", cancelledJobs: 3 });
    const { certificate, jobs } = await t.run(async (ctx) => {
      const certificate = await ctx.db.get(certificateId);
      const jobs = await ctx.db
        .query("certificateWorkflowJobs")
        .withIndex("by_certificateId", (q) => q.eq("certificateId", certificateId))
        .collect();
      return { certificate, jobs };
    });
    expect(certificate).toMatchObject({
      status: "archived",
      archivedAt: expect.any(Number),
      archivedByUserId: userId,
      currentVersionId: versionId,
      latestIssuedVersionId: versionId,
    });

    const jobByKey = new Map(jobs.map((job) => [job.idempotencyKey, job]));
    for (const status of openJobStatuses) {
      expect(jobByKey.get(`job:${status}`)).toMatchObject({
        status: "cancelled",
        cancelReason: "Certificate archived",
        cancelledByUserId: userId,
        cancelledAt: expect.any(Number),
      });
    }
    expect(jobByKey.get("job:sent")).toMatchObject({ status: "sent" });
  });

  test("hides archived certificates from issued-candidate lookup and version search", async () => {
    const { t, orgId, userId, policyId, certificateId } = await seedIssuedCertificate();

    await expect(t.query(findIssuedCandidatesFn, { orgId, policyId }))
      .resolves.toHaveLength(1);
    await expect(t.query(listVersionsFn, { orgId, certificateId }))
      .resolves.toHaveLength(1);

    await t.withIdentity(sessionFor(userId)).mutation(archiveFn, { certificateId });

    await expect(t.query(findIssuedCandidatesFn, { orgId, policyId }))
      .resolves.toHaveLength(0);
    await expect(t.query(listVersionsFn, { orgId, certificateId }))
      .resolves.toHaveLength(0);
  });

  test("creates a fresh parent for an archived dedupe key and blocks restoring the old parent", async () => {
    const { t, orgId, userId, policyId, holderId, certificateId, dedupeKey } =
      await seedIssuedCertificate();

    await t.withIdentity(sessionFor(userId)).mutation(archiveFn, { certificateId });
    const newCertificateId = await t.mutation(getOrCreateParentFn, {
      orgId,
      policyId,
      holderId,
      source: "policy_page",
      createdByUserId: userId,
    });

    expect(newCertificateId).not.toBe(certificateId);
    const { oldCertificate, newCertificate } = await t.run(async (ctx) => ({
      oldCertificate: await ctx.db.get(certificateId),
      newCertificate: await ctx.db.get(newCertificateId),
    }));
    expect(oldCertificate).toMatchObject({ status: "archived", dedupeKey });
    expect(newCertificate).toMatchObject({ status: "active", dedupeKey });
    await expect(
      t.query(nextVersionNumberFn, { orgId, certificateId: newCertificateId }),
    )
      .resolves.toBe(1);
    await expect(
      t.withIdentity(sessionFor(userId)).mutation(unarchiveFn, { certificateId }),
    ).rejects.toThrow("A newer certificate already exists for this holder");
  });

  test("restores an archived certificate when no active sibling shares its dedupe key", async () => {
    const { t, userId, certificateId } = await seedIssuedCertificate();

    await t.withIdentity(sessionFor(userId)).mutation(archiveFn, { certificateId });
    await t.withIdentity(sessionFor(userId)).mutation(unarchiveFn, { certificateId });

    const certificate = await t.run(async (ctx) => ctx.db.get(certificateId));
    expect(certificate?.status).toBe("active");
    expect(certificate?.archivedAt).toBeUndefined();
    expect(certificate?.archivedByUserId).toBeUndefined();
    expect(certificate?.updatedByUserId).toBe(userId);
  });
});
