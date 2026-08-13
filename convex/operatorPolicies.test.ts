/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  archive,
  createOperatorUpload,
  listForBroker,
  restore,
  updatePolicyDetails,
} from "./policies";
import {
  getPolicyExtractionOperations,
  listExtractionTraces,
  requireOperatorPolicyWriteForUserInternal,
} from "./operator";

const modules = import.meta.glob("./**/*.ts");
const archiveFn = archive as any;
const createOperatorUploadFn = createOperatorUpload as any;
const listForBrokerFn = listForBroker as any;
const restoreFn = restore as any;
const updatePolicyDetailsFn = updatePolicyDetails as any;
const getPolicyExtractionOperationsFn = getPolicyExtractionOperations as any;
const listExtractionTracesFn = listExtractionTraces as any;
const requireOperatorPolicyWriteForUserInternalFn =
  requireOperatorPolicyWriteForUserInternal as any;

async function seedOperatorPolicyFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Policy Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const customerUserId = await ctx.db.insert("users", {
      name: "Client Admin",
      email: "admin@example.com",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Managed Client",
      type: "client",
      operatorStatus: "live",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: customerUserId,
      role: "admin",
    });
    const fileId = await ctx.storage.store(
      new Blob(["%PDF-1.4 operator fixture"], { type: "application/pdf" }),
    );
    return { operatorUserId, customerUserId, clientOrgId, fileId };
  });
  return { t, ...ids };
}

describe("operator client policy management", () => {
  test("uploads, lists, edits, archives, restores, and audits a client policy", async () => {
    const fixture = await seedOperatorPolicyFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });

    const policyId = await operator.mutation(createOperatorUploadFn, {
      clientOrgId: fixture.clientOrgId,
      fileId: fixture.fileId,
      fileName: "managed-policy.pdf",
      documentType: "policy",
    }) as Id<"policies">;

    await expect(
      operator.query(listForBrokerFn, {
        clientOrgId: fixture.clientOrgId,
        documentType: "policy",
        archived: false,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: policyId,
        orgId: fixture.clientOrgId,
        uploadedBySide: "operator",
        uploadedByUserId: fixture.operatorUserId,
      }),
    ]);

    await operator.mutation(updatePolicyDetailsFn, {
      id: policyId,
      update: {
        section: "overview",
        policyNumber: "OP-100",
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        premium: "$10,000",
        operationsDescription: "Operator-managed client policy",
      },
    });
    await operator.mutation(archiveFn, { id: policyId });
    await operator.mutation(restoreFn, { id: policyId });

    const result = await fixture.t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      policyAudits: await ctx.db
        .query("policyAuditLog")
        .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
        .collect(),
      operatorAudits: await ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_targetOrgId_createdAt", (q) =>
          q.eq("targetOrgId", fixture.clientOrgId),
        )
        .collect(),
    }));

    expect(result.policy).toMatchObject({
      policyNumber: "OP-100",
      uploadedBySide: "operator",
      policyDetailOverrides: {
        operationsDescription: "Operator-managed client policy",
      },
    });
    expect(result.policy?.deletedAt).toBeUndefined();
    expect(result.policyAudits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(["manual_policy_update", "archived", "restored"]),
    );
    expect(result.operatorAudits).toHaveLength(4);
    expect(result.operatorAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "setup_write",
          metadata: expect.objectContaining({ domain: "policies", policyId }),
        }),
      ]),
    );
  });

  test("does not let a client member call the operator upload mutation", async () => {
    const fixture = await seedOperatorPolicyFixture();
    const clientAdmin = fixture.t.withIdentity({
      subject: `${fixture.customerUserId}|session`,
    });

    await expect(
      clientAdmin.mutation(createOperatorUploadFn, {
        clientOrgId: fixture.clientOrgId,
        fileId: fixture.fileId,
        fileName: "managed-policy.pdf",
        documentType: "policy",
      }),
    ).rejects.toThrow();
  });

  test("keeps direct operator policy writes read-only during live impersonation", async () => {
    const fixture = await seedOperatorPolicyFixture();
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId: fixture.operatorUserId,
        targetOrgId: fixture.clientOrgId,
        targetRole: "admin",
        status: "active",
        createdAt: dayjs().valueOf(),
      });
    });
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });

    await expect(
      operator.mutation(createOperatorUploadFn, {
        clientOrgId: fixture.clientOrgId,
        fileId: fixture.fileId,
        fileName: "managed-policy.pdf",
        documentType: "policy",
      }),
    ).rejects.toThrow(/read-only/i);

    const policyId = await fixture.t.run(async (ctx) =>
      ctx.db.insert("policies", {
        orgId: fixture.clientOrgId,
        carrier: "Existing Carrier",
        policyNumber: "EXISTING-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Managed Client",
      }),
    );
    await expect(
      operator.query(requireOperatorPolicyWriteForUserInternalFn, {
        userId: fixture.operatorUserId,
        policyId,
      }),
    ).rejects.toThrow(/read-only/i);
  });

  test("scopes extraction runs and artifact diagnostics to one policy", async () => {
    const fixture = await seedOperatorPolicyFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const now = dayjs().valueOf();
    const { policyId, otherPolicyId } = await fixture.t.run(async (ctx) => {
      const policyId = await ctx.db.insert("policies", {
        orgId: fixture.clientOrgId,
        carrier: "Primary Carrier",
        policyNumber: "PRIMARY-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Managed Client",
        pipelineStatus: "complete",
        extractionDataStage: "final",
      });
      const otherPolicyId = await ctx.db.insert("policies", {
        orgId: fixture.clientOrgId,
        carrier: "Other Carrier",
        policyNumber: "OTHER-1",
        linesOfBusiness: ["AUTOP"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Managed Client",
      });
      await ctx.db.insert("policyExtractionRuns", {
        policyId,
        pipelineStatus: "complete",
        pipelineCheckpoint: { phaseIndex: 4, state: { traceId: "trace-primary" } },
        pipelineLog: [],
        createdAt: now - 2_000,
        updatedAt: now,
      });
      await ctx.db.insert("sourceSpans", {
        orgId: fixture.clientOrgId,
        policyId,
        spanId: "primary-span",
        documentId: "primary-doc",
        sourceKind: "policy_pdf",
        text: "Primary policy source",
        textHash: "primary-source-hash",
        createdAt: now,
      });
      for (const [traceId, targetPolicyId, startedAt] of [
        ["trace-primary", policyId, now],
        ["trace-other", otherPolicyId, now - 1_000],
      ] as const) {
        await ctx.db.insert("policyExtractionTraceSessions", {
          traceId,
          policyId: targetPolicyId,
          orgId: fixture.clientOrgId,
          sourceKind: "policy",
          trigger: "upload",
          status: "complete",
          startedAt,
          completedAt: startedAt + 500,
          totalDurationMs: 500,
          expiresAt: now + 86_400_000,
          updatedAt: startedAt + 500,
        });
      }
      return { policyId, otherPolicyId };
    });

    await expect(
      operator.query(listExtractionTracesFn, {
        policyId,
        limit: 50,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        policyId,
        traceId: "trace-primary",
      }),
    ]);

    await expect(
      operator.query(getPolicyExtractionOperationsFn, { policyId }),
    ).resolves.toMatchObject({
      policyId,
      run: {
        pipelineStatus: "complete",
        pipelineCheckpoint: {
          phaseIndex: 4,
          state: { traceId: "trace-primary" },
        },
      },
      counts: {
        sourceSpans: { count: 1, capped: false },
      },
      latestTrace: {
        traceId: "trace-primary",
        status: "complete",
      },
    });

    expect(otherPolicyId).not.toBe(policyId);
  });
});
