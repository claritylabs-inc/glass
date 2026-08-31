/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  getSoloClientLaunchContextInternal,
  launchSoloClient,
} from "./operator";

const modules = import.meta.glob("./**/*.ts");
const getLaunchContext = getSoloClientLaunchContextInternal as any;
const launchClient = launchSoloClient as any;

async function seedClientTeam() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@spot.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const firstAdminUserId = await ctx.db.insert("users", {
      name: "First Admin",
      email: "first-admin@example.com",
      accountKind: "customer",
    });
    const secondAdminUserId = await ctx.db.insert("users", {
      name: "Second Admin",
      email: "second-admin@example.com",
      accountKind: "customer",
    });
    const memberUserId = await ctx.db.insert("users", {
      name: "Team Member",
      email: "member@example.com",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client Team",
      type: "client",
      operatorStatus: "onboarding",
      primaryInsuranceContactId: memberUserId,
    });
    await Promise.all([
      ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: firstAdminUserId,
        role: "admin",
      }),
      ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: secondAdminUserId,
        role: "admin",
      }),
      ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: memberUserId,
        role: "member",
      }),
    ]);
    return {
      operatorUserId,
      secondAdminUserId,
      memberUserId,
      clientOrgId,
    };
  });
  return { t, ...fixture };
}

describe("operator client activation", () => {
  test("resolves only the selected existing admin as the activation recipient", async () => {
    const fixture = await seedClientTeam();

    const selected = await fixture.t.query(getLaunchContext, {
      clientOrgId: fixture.clientOrgId,
      adminUserId: fixture.secondAdminUserId,
    });
    expect(selected).toMatchObject({
      adminUserId: fixture.secondAdminUserId,
      adminEmail: "second-admin@example.com",
      adminName: "Second Admin",
    });

    await expect(
      fixture.t.query(getLaunchContext, {
        clientOrgId: fixture.clientOrgId,
        adminUserId: fixture.memberUserId,
      }),
    ).resolves.toBeNull();
  });

  test("records accepted activation deliveries as a launch and then a resend", async () => {
    const fixture = await seedClientTeam();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const args = {
      clientOrgId: fixture.clientOrgId,
      adminUserId: fixture.secondAdminUserId,
    };
    vi.stubEnv("SPOT_ENV", "local");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await expect(operator.action(launchClient, args)).resolves.toMatchObject({
        adminUserId: fixture.secondAdminUserId,
        recipientEmail: "second-admin@example.com",
      });
      await operator.action(launchClient, args);
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }

    const result = await fixture.t.run(async (ctx) => ({
      client: await ctx.db.get(fixture.clientOrgId),
      audits: await ctx.db.query("operatorAuditEvents").order("asc").take(10),
    }));
    expect(result.client).toMatchObject({
      operatorStatus: "live",
      onboardingComplete: true,
    });
    expect(result.audits).toHaveLength(2);
    expect(result.audits[0]).toMatchObject({
      targetUserId: fixture.secondAdminUserId,
      summary:
        "Launched Client Team; email provider accepted client login email",
      metadata: {
        recipientEmail: "second-admin@example.com",
        resendEmailId: "captured",
      },
    });
    expect(result.audits[1]).toMatchObject({
      targetUserId: fixture.secondAdminUserId,
      summary:
        "Resent activation email for Client Team; email provider accepted client login email",
      metadata: {
        recipientEmail: "second-admin@example.com",
        resendEmailId: "captured",
      },
    });
  });
});
