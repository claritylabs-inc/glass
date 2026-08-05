/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  get,
  setOperatorSlackIdentity,
  update,
  updateForOperator,
} from "./agentChannels";
import { resolveForAction } from "./lib/agentScope";

const modules = import.meta.glob("./**/*.ts");
const getFn = get as any;
const setOperatorSlackIdentityFn = setOperatorSlackIdentity as any;
const updateFn = update as any;
const updateForOperatorFn = updateForOperator as any;
const resolveForActionFn = resolveForAction as any;

describe("agent channel settings", () => {
  test("defaults legacy clients to email/iMessage on and Slack off", async () => {
    const t = convexTest(schema, modules);
    const { memberUserId, orgId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Legacy Client",
        type: "client",
      });
      const memberUserId = await ctx.db.insert("users", {
        email: "member@client.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: memberUserId,
        role: "member",
      });
      return { memberUserId, orgId };
    });
    await expect(
      t
        .withIdentity({ subject: `${memberUserId}|session` })
        .query(getFn, { clientOrgId: orgId }),
    ).resolves.toMatchObject({
      settings: {
        emailEnabled: true,
        imessageEnabled: true,
        slackEnabled: false,
        slackSafeAlertsEnabled: true,
        slackVendorAlertsEnabled: false,
        slackPolicyDeliveryEnabled: true,
      },
    });
  });

  test("allows client admins and rejects ordinary members", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memberUserId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const adminUserId = await ctx.db.insert("users", { email: "admin@client.com" });
      const memberUserId = await ctx.db.insert("users", { email: "member@client.com" });
      await ctx.db.insert("orgMemberships", { orgId, userId: adminUserId, role: "admin" });
      await ctx.db.insert("orgMemberships", { orgId, userId: memberUserId, role: "member" });
      return { adminUserId, memberUserId };
    });
    const settings = {
      emailEnabled: true,
      imessageEnabled: false,
      slackEnabled: false,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: false,
      slackPolicyDeliveryEnabled: true,
    };
    await expect(
      t.withIdentity({ subject: `${memberUserId}|session` }).mutation(updateFn, settings),
    ).rejects.toThrow("Only an organization admin can perform this action");
    await expect(
      t.withIdentity({ subject: `${adminUserId}|session` }).mutation(updateFn, settings),
    ).resolves.toBeTruthy();
  });

  test("audits operator-managed channel settings and Slack identity", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const operatorUserId = await ctx.db.insert("users", {
        email: "operator@glass.insure",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@glass.insure",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return { clientOrgId, operatorUserId };
    });
    const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
    await operator.mutation(updateForOperatorFn, {
      clientOrgId,
      emailEnabled: true,
      imessageEnabled: true,
      slackEnabled: false,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: false,
      slackPolicyDeliveryEnabled: true,
    });
    await operator.mutation(setOperatorSlackIdentityFn, {
      teamId: "T-GLASS",
      userId: "U-OPERATOR",
    });

    const records = await t.run(async (ctx) => ({
      profile: await ctx.db.query("operatorProfiles").first(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.profile).toMatchObject({
      slackTeamId: "T-GLASS",
      slackUserId: "U-OPERATOR",
    });
    expect(records.audits.map((audit) => audit.summary)).toEqual([
      "Updated client agent channel settings",
      "Connected operator Slack identity",
    ]);
  });

  test("enforces explicit email and iMessage availability without changing legacy defaults", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
      const userId = await ctx.db.insert("users", { email: "user@client.com" });
      await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
      return { orgId, userId };
    });
    await expect(
      t.query(resolveForActionFn, { orgId, userId, surface: "email" }),
    ).resolves.toMatchObject({ surface: "email" });

    await t.run(async (ctx) => {
      await ctx.db.insert("agentChannelSettings", {
        clientOrgId: orgId,
        emailEnabled: false,
        imessageEnabled: false,
        slackEnabled: false,
        slackSafeAlertsEnabled: true,
        slackVendorAlertsEnabled: false,
        slackPolicyDeliveryEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      t.query(resolveForActionFn, { orgId, userId, surface: "email" }),
    ).rejects.toThrow("Email agent access is disabled");
    await expect(
      t.query(resolveForActionFn, { orgId, userId, surface: "imessage" }),
    ).rejects.toThrow("iMessage agent access is disabled");
  });

  test("grants customer members and recognized operators client-admin-equivalent Slack scope", async () => {
    const t = convexTest(schema, modules);
    const { orgId, serviceUserId, customerActorId, operatorActorId, externalActorId } =
      await t.run(async (ctx) => {
        const orgId = await ctx.db.insert("organizations", {
          name: "Client",
          type: "client",
        });
        const serviceUserId = await ctx.db.insert("users", {
          name: "Glass Slack",
          accountKind: "customer",
          serviceAccountKind: "slack",
        });
        const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
          clientOrgId: orgId,
          teamId: "T-CUSTOMER",
          teamName: "Client",
          grantedScopes: [],
          status: "active",
          serviceUserId,
          thirdPartyVisibilityAcknowledged: true,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("agentChannelSettings", {
          clientOrgId: orgId,
          emailEnabled: true,
          imessageEnabled: true,
          slackEnabled: true,
          slackSafeAlertsEnabled: true,
          slackVendorAlertsEnabled: false,
          slackPolicyDeliveryEnabled: true,
          createdAt: 1,
          updatedAt: 1,
        });
        const actor = async (
          teamId: string,
          slackUserId: string,
          classification: "customer_member" | "glass_operator" | "external",
        ) =>
          await ctx.db.insert("slackActors", {
            connectionId,
            clientOrgId: orgId,
            teamId,
            slackUserId,
            classification,
            createdAt: 1,
            updatedAt: 1,
          });
        return {
          orgId,
          serviceUserId,
          customerActorId: await actor(
            "T-CUSTOMER",
            "U-CUSTOMER",
            "customer_member",
          ),
          operatorActorId: await actor(
            "T-CLARITY",
            "U-OPERATOR",
            "glass_operator",
          ),
          externalActorId: await actor("T-VENDOR", "U-VENDOR", "external"),
        };
      });

    for (const slackActorId of [customerActorId, operatorActorId]) {
      await expect(
        t.query(resolveForActionFn, {
          orgId,
          userId: serviceUserId,
          surface: "slack",
          slackActorId,
        }),
      ).resolves.toMatchObject({
        mode: "client",
        writableOrgIds: [orgId],
        actorRef: { kind: "slack", actorId: slackActorId },
      });
    }
    await expect(
      t.query(resolveForActionFn, {
        orgId,
        userId: serviceUserId,
        surface: "slack",
        slackActorId: externalActorId,
      }),
    ).rejects.toThrow("access");
  });
});
