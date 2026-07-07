/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { softDelete } from "./policies";

const modules = import.meta.glob("./**/*.ts");
const softDeleteFn = softDelete as any;

async function seedBrokerClientPolicy(options: {
  uploadedBySide: "broker" | "client";
}) {
  const t = convexTest(schema, modules);
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
    const brokerUserId = await ctx.db.insert("users", {
      name: "Broker Admin",
      email: "broker@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: brokerOrgId,
      userId: brokerUserId,
      role: "admin",
    });
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
      uploadedBySide: options.uploadedBySide,
      uploadedByUserId: brokerUserId,
      uploadedByBrokerOrgId:
        options.uploadedBySide === "broker" ? brokerOrgId : undefined,
    });

    return { brokerUserId, clientOrgId, policyId };
  });

  return { t, ...ids };
}

describe("policies.softDelete", () => {
  test("allows a broker member to delete a broker-uploaded client policy", async () => {
    const { t, brokerUserId, clientOrgId, policyId } =
      await seedBrokerClientPolicy({ uploadedBySide: "broker" });

    await t.withIdentity({ subject: `${brokerUserId}|session` }).mutation(
      softDeleteFn,
      { id: policyId },
    );

    const { policy, audit } = await t.run(async (ctx) => {
      const policy = await ctx.db.get(policyId);
      const audit = await ctx.db
        .query("policyAuditLog")
        .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
        .first();
      return { policy, audit };
    });

    expect(policy?.deletedAt).toEqual(expect.any(Number));
    expect(audit).toMatchObject({
      policyId,
      userId: brokerUserId,
      orgId: clientOrgId,
      action: "deleted",
    });
  });

  test("blocks a broker member from deleting a client-uploaded policy", async () => {
    const { t, brokerUserId, policyId } =
      await seedBrokerClientPolicy({ uploadedBySide: "client" });

    await expect(
      t.withIdentity({ subject: `${brokerUserId}|session` }).mutation(
        softDeleteFn,
        { id: policyId },
      ),
    ).rejects.toThrow("Not authorized to delete this policy");

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.deletedAt).toBeUndefined();
  });
});
