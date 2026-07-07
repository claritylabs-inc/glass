/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { list as listAgentTargets } from "./agentTargets";
import { listActivityByPolicy } from "./certificates";
import {
  getCaseDetail,
  listByPolicy as listPolicyChangesByPolicy,
} from "./policyChanges";
import { getPolicyFileUrl } from "./policies";
import { listSpansByPolicyAndSpanIds } from "./sourceSpans";

const modules = import.meta.glob("./**/*.ts");
const listSpansByPolicyAndSpanIdsFn = listSpansByPolicyAndSpanIds as any;
const listAgentTargetsFn = listAgentTargets as any;
const listActivityByPolicyFn = listActivityByPolicy as any;
const listPolicyChangesByPolicyFn = listPolicyChangesByPolicy as any;
const getCaseDetailFn = getCaseDetail as any;
const getPolicyFileUrlFn = getPolicyFileUrl as any;

async function seedOperatorPolicyFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
      brokerOrgId,
    });
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
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
    const impersonationSessionId = await ctx.db.insert(
      "operatorImpersonationSessions",
      {
        operatorUserId,
        targetOrgId: brokerOrgId,
        targetRole: "admin",
        status: "active",
        createdAt: now,
      },
    );
    const policyId = await ctx.db.insert("policies", {
      orgId: clientOrgId,
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
    });
    await ctx.db.insert("sourceSpans", {
      orgId: clientOrgId,
      policyId,
      spanId: "span-a",
      documentId: "doc-a",
      sourceKind: "policy_pdf",
      text: "Policy source evidence",
      textHash: "hash-a",
      createdAt: now,
    });
    await ctx.db.insert("certificateRequestHolds", {
      orgId: clientOrgId,
      policyId,
      holderName: "Holder",
      status: "held",
      reasonCode: "policy_change_required",
      reasonMessage: "Endorsement required",
      requiredChanges: ["Add holder"],
      createdAt: now,
      updatedAt: now,
    });
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId: clientOrgId,
      policyId,
      requestText: "Add endorsement",
      sourceKind: "manual",
      status: "intake",
      createdAt: now,
      updatedAt: now,
    });

    return {
      operatorUserId,
      impersonationSessionId,
      brokerOrgId,
      clientOrgId,
      policyId,
      caseId,
    };
  });

  return { t, ...ids };
}

describe("operator teardown policy-detail queries", () => {
  test("return empty state instead of throwing after impersonation ends", async () => {
    const {
      t,
      operatorUserId,
      impersonationSessionId,
      brokerOrgId,
      clientOrgId,
      policyId,
      caseId,
    } = await seedOperatorPolicyFixture();
    const operatorSession = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });

    await expect(
      operatorSession.query(listSpansByPolicyAndSpanIdsFn, {
        policyId,
        spanIds: ["span-a"],
      }),
    ).resolves.toHaveLength(1);
    await expect(
      operatorSession.query(listActivityByPolicyFn, { policyId }),
    ).resolves.toMatchObject({
      holds: [expect.objectContaining({ holderName: "Holder" })],
    });
    await expect(
      operatorSession.query(listPolicyChangesByPolicyFn, { policyId }),
    ).resolves.toHaveLength(1);
    await expect(
      operatorSession.query(getCaseDetailFn, { caseId }),
    ).resolves.toMatchObject({
      case: expect.objectContaining({ requestText: "Add endorsement" }),
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(impersonationSessionId, {
        status: "ended",
        endedAt: dayjs().valueOf(),
      });
    });

    await expect(
      operatorSession.query(listSpansByPolicyAndSpanIdsFn, {
        policyId,
        spanIds: ["span-a"],
      }),
    ).resolves.toEqual([]);
    await expect(
      operatorSession.query(listActivityByPolicyFn, { policyId }),
    ).resolves.toEqual({ certificates: [], holds: [] });
    await expect(
      operatorSession.query(listPolicyChangesByPolicyFn, { policyId }),
    ).resolves.toEqual([]);
    await expect(
      operatorSession.query(getCaseDetailFn, { caseId }),
    ).resolves.toBeNull();
    await expect(
      operatorSession.query(getPolicyFileUrlFn, { policyId }),
    ).resolves.toBeNull();
    await expect(
      operatorSession.query(listAgentTargetsFn, { orgId: brokerOrgId }),
    ).resolves.toEqual({
      policies: [],
      requirements: [],
      mailboxes: [],
    });
    await expect(
      operatorSession.query(listAgentTargetsFn, { orgId: clientOrgId }),
    ).resolves.toEqual({
      policies: [],
      requirements: [],
      mailboxes: [],
    });
  });

  test("source span evidence lookup does not fan out to sibling children", async () => {
    const { t, operatorUserId, clientOrgId, policyId } =
      await seedOperatorPolicyFixture();
    const now = dayjs().valueOf();
    await t.run(async (ctx) => {
      await ctx.db.insert("sourceSpans", {
        orgId: clientOrgId,
        policyId,
        spanId: "page-1",
        documentId: "doc-a",
        sourceKind: "policy_pdf",
        sourceUnit: "page",
        text: "Page 1",
        textHash: "page-1",
        createdAt: now,
      });
      await ctx.db.insert("sourceSpans", {
        orgId: clientOrgId,
        policyId,
        spanId: "row-1",
        documentId: "doc-a",
        sourceKind: "policy_pdf",
        sourceUnit: "table_row",
        parentSpanId: "page-1",
        text: "Coverage row",
        textHash: "row-1",
        createdAt: now,
      });
      await ctx.db.insert("sourceSpans", {
        orgId: clientOrgId,
        policyId,
        spanId: "cell-a",
        documentId: "doc-a",
        sourceKind: "policy_pdf",
        sourceUnit: "table_cell",
        parentSpanId: "row-1",
        text: "Requested cell",
        textHash: "cell-a",
        createdAt: now,
      });
      await ctx.db.insert("sourceSpans", {
        orgId: clientOrgId,
        policyId,
        spanId: "cell-b",
        documentId: "doc-a",
        sourceKind: "policy_pdf",
        sourceUnit: "table_cell",
        parentSpanId: "row-1",
        text: "Sibling cell",
        textHash: "cell-b",
        createdAt: now,
      });
    });
    const operatorSession = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });

    const spans = await operatorSession.query(listSpansByPolicyAndSpanIdsFn, {
      policyId,
      spanIds: ["cell-a"],
    });
    const spanIds = spans.map((span: { spanId: string }) => span.spanId);

    expect(spanIds).toEqual(expect.arrayContaining(["cell-a", "row-1", "page-1"]));
    expect(spanIds).not.toContain("cell-b");
  });

  test("source span evidence lookup caps oversized client requests", async () => {
    const { t, operatorUserId, clientOrgId, policyId } =
      await seedOperatorPolicyFixture();
    const now = dayjs().valueOf();
    const requestedSpanIds = Array.from({ length: 300 }, (_, index) => `bulk-${index}`);
    await t.run(async (ctx) => {
      for (const spanId of requestedSpanIds) {
        await ctx.db.insert("sourceSpans", {
          orgId: clientOrgId,
          policyId,
          spanId,
          documentId: "doc-a",
          sourceKind: "policy_pdf",
          text: `Bulk source evidence ${spanId}`,
          textHash: spanId,
          createdAt: now,
        });
      }
    });
    const operatorSession = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });

    const spans = await operatorSession.query(listSpansByPolicyAndSpanIdsFn, {
      policyId,
      spanIds: requestedSpanIds,
    });

    expect(spans).toHaveLength(256);
    expect(spans.map((span: { spanId: string }) => span.spanId)).not.toContain("bulk-299");
  });
});
