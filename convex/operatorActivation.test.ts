/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
  test("resolves only the selected existing admin during onboarding", async () => {
    const fixture = await seedClientTeam();

    const selected = await fixture.t.query(
      internal.operator.getSoloClientLaunchContextInternal,
      {
        clientOrgId: fixture.clientOrgId,
        adminUserId: fixture.secondAdminUserId,
      },
    );
    expect(selected).toMatchObject({
      adminUserId: fixture.secondAdminUserId,
      adminEmail: "second-admin@example.com",
      adminName: "Second Admin",
    });

    await expect(
      fixture.t.query(internal.operator.getSoloClientLaunchContextInternal, {
        clientOrgId: fixture.clientOrgId,
        adminUserId: fixture.memberUserId,
      }),
    ).resolves.toBeNull();
  });

  test("records an admin launch followed by a member resend", async () => {
    const fixture = await seedClientTeam();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const launchArgs = {
      clientOrgId: fixture.clientOrgId,
      adminUserId: fixture.secondAdminUserId,
    };
    const resendArgs = {
      clientOrgId: fixture.clientOrgId,
      adminUserId: fixture.memberUserId,
    };
    vi.stubEnv("SPOT_ENV", "local");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await expect(
        operator.action(api.operator.launchSoloClient, launchArgs),
      ).resolves.toMatchObject({
        adminUserId: fixture.secondAdminUserId,
        recipientEmail: "second-admin@example.com",
      });
      await expect(
        operator.action(api.operator.launchSoloClient, resendArgs),
      ).resolves.toMatchObject({
        adminUserId: fixture.memberUserId,
        recipientEmail: "member@example.com",
      });
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
      targetUserId: fixture.memberUserId,
      summary:
        "Resent activation email for Client Team; email provider accepted client login email",
      metadata: {
        recipientEmail: "member@example.com",
        resendEmailId: "captured",
      },
    });
  });
});
