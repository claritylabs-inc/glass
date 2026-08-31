/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { checkUserPhoneAvailabilities, createSoloClient } from "./operator";

const modules = import.meta.glob("./**/*.ts");
const createSoloClientFn = createSoloClient as any;
const checkUserPhoneAvailabilitiesFn = checkUserPhoneAvailabilities as any;

async function operatorFixture() {
  const t = convexTest(schema, modules);
  const operatorUserId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "operator@glass.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@glass.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
  return {
    t,
    operator: t.withIdentity({ subject: `${operatorUserId}|session` }),
  };
}

describe("operator client creation", () => {
  test("rejects malformed attached-user emails before provisioning accounts", async () => {
    const { t, operator } = await operatorFixture();

    await expect(
      operator.action(createSoloClientFn, {
        name: "Invalid Client Team",
        users: [
          { email: "admin@example.com", role: "admin" },
          { email: "not-an-email", role: "member" },
        ],
      }),
    ).rejects.toThrow("Every client user must have a valid customer email");

    const authAccounts = await t.run((ctx) =>
      ctx.db.query("authAccounts").collect(),
    );
    expect(authAccounts).toEqual([]);
  });

  test("creates every submitted team member without sending invitations", async () => {
    const { t, operator } = await operatorFixture();
    const existingMemberId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "member@example.com",
        name: "Existing Member",
        phone: "+14155552671",
        accountKind: "customer",
      });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "resend-otp",
        providerAccountId: "member@example.com",
      });
      return userId;
    });

    await expect(
      operator.query(checkUserPhoneAvailabilitiesFn, {
        users: [
          { email: "member@example.com", phone: "+14155552671" },
          { email: "someone-else@example.com", phone: "+14155552671" },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ phone: "+14155552671", available: true }),
      expect.objectContaining({ phone: "+14155552671", available: false }),
    ]);

    const result = await operator.action(createSoloClientFn, {
      name: "Client Team",
      users: [
        {
          email: "ADMIN@EXAMPLE.COM",
          name: "Client Admin",
          role: "admin",
        },
        {
          email: "member@example.com",
          role: "member",
        },
        {
          email: "backup-admin@example.com",
          name: "Backup Admin",
          role: "admin",
        },
      ],
    });

    const state = await t.run(async (ctx) => {
      const client = await ctx.db.get(result.clientOrgId);
      const memberships = await ctx.db
        .query("orgMemberships")
        .withIndex("organization", (q) => q.eq("orgId", result.clientOrgId))
        .collect();
      const users = await Promise.all(
        memberships.map(async (membership) => ({
          membership,
          user: await ctx.db.get(membership.userId),
          accounts: await ctx.db
            .query("authAccounts")
            .withIndex("userIdAndProvider", (q) =>
              q.eq("userId", membership.userId),
            )
            .collect(),
        })),
      );
      const invitations = await ctx.db
        .query("orgInvitations")
        .withIndex("organization", (q) => q.eq("orgId", result.clientOrgId))
        .collect();
      const audits = await ctx.db
        .query("operatorAuditEvents")
        .withIndex("target_created", (q) =>
          q.eq("targetOrgId", result.clientOrgId),
        )
        .collect();
      return { client, users, invitations, audits };
    });

    const users = state.users.sort((a, b) =>
      (a.user?.email ?? "").localeCompare(b.user?.email ?? ""),
    );
    const primaryAdmin = users.find(
      ({ user }) => user?.email === "admin@example.com",
    );

    expect(state.client).toMatchObject({
      name: "Client Team",
      type: "client",
      operatorStatus: "onboarding",
      allowedEmails: [
        "admin@example.com",
        "member@example.com",
        "backup-admin@example.com",
      ],
      primaryInsuranceContactId: primaryAdmin?.user?._id,
      primaryContactEmail: "admin@example.com",
      primaryContactName: "Client Admin",
    });
    expect(users).toEqual([
      expect.objectContaining({
        membership: expect.objectContaining({ role: "admin" }),
        user: expect.objectContaining({ email: "admin@example.com" }),
      }),
      expect.objectContaining({
        membership: expect.objectContaining({ role: "admin" }),
        user: expect.objectContaining({ email: "backup-admin@example.com" }),
      }),
      expect.objectContaining({
        membership: expect.objectContaining({ role: "member" }),
        user: expect.objectContaining({
          _id: existingMemberId,
          email: "member@example.com",
          name: "Existing Member",
          phone: "+14155552671",
        }),
      }),
    ]);
    expect(users.flatMap(({ accounts }) => accounts)).toHaveLength(3);
    expect(
      users.flatMap(({ accounts }) => accounts).every(
        (account) => !account.emailVerified && !account.phoneVerified,
      ),
    ).toBe(true);
    expect(state.invitations).toEqual([]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        type: "client_created",
        targetUserId: primaryAdmin?.user?._id,
        metadata: expect.objectContaining({ userCount: 3, adminCount: 2 }),
      }),
    ]);
  });

  test("creates a client without provisioning any users", async () => {
    const { t, operator } = await operatorFixture();

    const result = await operator.action(createSoloClientFn, {
      name: "Client Without Users",
      users: [],
    });

    const state = await t.run(async (ctx) => {
      const client = await ctx.db.get(result.clientOrgId);
      const memberships = await ctx.db
        .query("orgMemberships")
        .withIndex("organization", (q) => q.eq("orgId", result.clientOrgId))
        .collect();
      const users = await ctx.db.query("users").take(10);
      const audits = await ctx.db
        .query("operatorAuditEvents")
        .withIndex("target_created", (q) =>
          q.eq("targetOrgId", result.clientOrgId),
        )
        .collect();
      return { client, memberships, users, audits };
    });

    expect(state.client).toMatchObject({
      name: "Client Without Users",
      type: "client",
      operatorStatus: "onboarding",
      allowedEmails: [],
      emailVerification: "strict",
    });
    expect(state.client).not.toHaveProperty("primaryInsuranceContactId");
    expect(state.client).not.toHaveProperty("primaryContactEmail");
    expect(state.memberships).toEqual([]);
    expect(state.users).toHaveLength(1);
    expect(state.audits).toEqual([
      expect.objectContaining({
        type: "client_created",
        metadata: expect.objectContaining({ userCount: 0, adminCount: 0 }),
      }),
    ]);
    expect(state.audits[0]?.targetUserId).toBeUndefined();
  });
});
