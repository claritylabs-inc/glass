/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    const customerUserId = await ctx.db.insert("users", {
      email: "customer@example.com",
      accountKind: "customer",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const otherClientOrgId = await ctx.db.insert("organizations", {
      name: "Other Client",
      type: "client",
    });
    const requestId = await ctx.db.insert("procurementRequests", {
      clientOrgId,
      title: "Property placement",
      requestSummary: "Place property coverage",
      requirements: "Admitted carrier preferred",
      status: "marketing",
      inboxToken: "memory-test-request",
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    const otherRequestId = await ctx.db.insert("procurementRequests", {
      clientOrgId: otherClientOrgId,
      title: "Other placement",
      requestSummary: "Other client",
      requirements: "Other requirements",
      status: "draft",
      inboxToken: "memory-test-other",
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    return {
      operatorUserId,
      customerUserId,
      clientOrgId,
      otherClientOrgId,
      requestId,
      otherRequestId,
    };
  });
  return { t, ...ids };
}

function identity(userId: string) {
  return { subject: `${userId}|session` };
}

describe("procurement memory", () => {
  test("supports operator CRUD and request provenance", async () => {
    const seeded = await fixture();
    const operator = seeded.t.withIdentity(identity(seeded.operatorUserId));
    const created = await operator.mutation(api.procurementMemory.create, {
      clientOrgId: seeded.clientOrgId,
      kind: "placement_preference",
      content: "  Cove prefers admitted markets when terms are comparable.  ",
      requestId: seeded.requestId,
    });
    expect(created).toMatchObject({
      content: "Cove prefers admitted markets when terms are comparable.",
      requestTitle: "Property placement",
      source: "manual",
    });

    await operator.mutation(api.procurementMemory.update, {
      id: created._id,
      kind: "market_observation",
      content: "Cove received stronger property terms from regional markets.",
      requestId: null,
    });
    await expect(
      operator.query(api.procurementMemory.list, {
        clientOrgId: seeded.clientOrgId,
      }),
    ).resolves.toMatchObject([
      {
        _id: created._id,
        kind: "market_observation",
      },
    ]);
    const updatedRows = await operator.query(api.procurementMemory.list, {
      clientOrgId: seeded.clientOrgId,
    });
    expect(updatedRows[0]?.requestId).toBeUndefined();

    await operator.mutation(api.procurementMemory.remove, { id: created._id });
    await expect(
      operator.query(api.procurementMemory.list, {
        clientOrgId: seeded.clientOrgId,
      }),
    ).resolves.toEqual([]);
  });

  test("rejects tenants, cross-client provenance, and impersonated writes", async () => {
    const seeded = await fixture();
    const operator = seeded.t.withIdentity(identity(seeded.operatorUserId));
    const customer = seeded.t.withIdentity(identity(seeded.customerUserId));

    await expect(
      customer.query(api.procurementMemory.list, {
        clientOrgId: seeded.clientOrgId,
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");
    await expect(
      operator.mutation(api.procurementMemory.create, {
        clientOrgId: seeded.clientOrgId,
        kind: "submission_requirement",
        content: "Cove submissions require current loss runs.",
        requestId: seeded.otherRequestId,
      }),
    ).rejects.toThrow("does not belong to this client");

    await seeded.t.run((ctx) =>
      ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId: seeded.operatorUserId,
        targetOrgId: seeded.clientOrgId,
        targetRole: "admin",
        status: "active",
        createdAt: dayjs().valueOf(),
      }),
    );
    await expect(
      operator.mutation(api.procurementMemory.create, {
        clientOrgId: seeded.clientOrgId,
        kind: "broker_appetite",
        content: "Cove's broker accepts regional property risks.",
      }),
    ).rejects.toThrow("IMPERSONATION_READ_ONLY");
  });
});
