/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { getManualComplianceReviewContextInternal } from "./compliance";

const modules = import.meta.glob("./**/*.ts");
const getManualComplianceReviewContext =
  getManualComplianceReviewContextInternal as any;

async function seed() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
      operatorStatus: "live",
    });
    const adminUserId = await ctx.db.insert("users", {
      email: "admin@cove.test",
    });
    const memberUserId = await ctx.db.insert("users", {
      email: "member@cove.test",
    });
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@claritylabs.test",
      accountKind: "operator",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: adminUserId,
      role: "admin",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: memberUserId,
      role: "member",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@claritylabs.test",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("operatorImpersonationSessions", {
      operatorUserId,
      targetOrgId: orgId,
      targetRole: "admin",
      status: "active",
      createdAt: now,
    });
    const requirementId = await ctx.db.insert("insuranceRequirements", {
      orgId,
      kind: "coverage",
      scope: "own_org",
      title: "General liability",
      requirementText: "$1M per occurrence",
      lineOfBusiness: "CGL",
      status: "active",
      createdByUserId: adminUserId,
      updatedByUserId: adminUserId,
      createdAt: now,
      updatedAt: now,
    });
    return { orgId, adminUserId, memberUserId, operatorUserId, requirementId };
  });
  return { t, ...ids };
}

function args(ids: Awaited<ReturnType<typeof seed>>, userId: string) {
  return {
    orgId: ids.orgId,
    requirementId: ids.requirementId,
    userId,
  };
}

describe("manual compliance review permissions", () => {
  test("allows a direct organization admin", async () => {
    const fixture = await seed();

    await expect(
      fixture.t.query(
        getManualComplianceReviewContext,
        args(fixture, fixture.adminUserId),
      ),
    ).resolves.toMatchObject({
      org: { name: "Cove" },
      requirement: { title: "General liability" },
    });
  });

  test("returns clear feedback to a non-admin member", async () => {
    const fixture = await seed();
    const session = fixture.t.withIdentity({
      subject: `${fixture.memberUserId}|session`,
    });

    await expect(
      session.query(
        getManualComplianceReviewContext,
        args(fixture, fixture.memberUserId),
      ),
    ).rejects.toThrow(
      "Only an organization admin can run a deeper compliance check.",
    );
  });

  test("blocks a live-organization operator before deeper review work", async () => {
    const fixture = await seed();
    const session = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });

    await expect(
      session.query(
        getManualComplianceReviewContext,
        args(fixture, fixture.operatorUserId),
      ),
    ).rejects.toThrow(
      "Live-organization impersonation is read-only. Exit operator mode to make this change from an authorized organization account.",
    );
  });

  test("allows setup work while the impersonated organization is onboarding", async () => {
    const fixture = await seed();
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.orgId, { operatorStatus: "onboarding" });
    });
    const session = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });

    await expect(
      session.query(
        getManualComplianceReviewContext,
        args(fixture, fixture.operatorUserId),
      ),
    ).resolves.toMatchObject({
      org: { name: "Cove" },
      requirement: { title: "General liability" },
    });
  });
});
