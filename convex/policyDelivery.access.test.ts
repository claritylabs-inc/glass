/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  getClientOwnedSettings,
  listRules,
  updateClientOwnedSettings,
  updateClientOverride,
  upsertRule,
  verifyDeliveryOwnerBackfill,
} from "./policyDelivery";

const modules = import.meta.glob("./**/*.ts");
const updateClientOverrideFn = updateClientOverride as any;
const getClientOwnedSettingsFn = getClientOwnedSettings as any;
const listRulesFn = listRules as any;
const updateClientOwnedSettingsFn = updateClientOwnedSettings as any;
const upsertRuleFn = upsertRule as any;
const verifyDeliveryOwnerBackfillFn = verifyDeliveryOwnerBackfill as any;

describe("policy delivery access", () => {
  test("allows broker admins and rejects broker members for client overrides", async () => {
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
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@broker.com",
      });
      const memberUserId = await ctx.db.insert("users", {
        email: "member@broker.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: adminUserId,
        role: "admin",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: memberUserId,
        role: "member",
      });
      return { adminUserId, memberUserId, clientOrgId };
    });
    const args = {
      clientOrgId: ids.clientOrgId,
      enabled: true,
      channels: ["email" as const],
      defaultAction: "broker_review" as const,
      deliverBeforeClientAcceptance: false,
    };

    await expect(
      t
        .withIdentity({ subject: `${ids.memberUserId}|session` })
        .mutation(updateClientOverrideFn, args),
    ).rejects.toThrow("Only a broker admin can perform this action.");

    await expect(
      t
        .withIdentity({ subject: `${ids.adminUserId}|session` })
        .mutation(updateClientOverrideFn, args),
    ).resolves.toBeTruthy();
  });

  test("lets a client admin own Slack delivery settings and service review rules", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, clientOrgId } = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@client.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: adminUserId,
        role: "admin",
      });
      return { adminUserId, clientOrgId };
    });
    const session = t.withIdentity({ subject: `${adminUserId}|session` });

    await session.mutation(updateClientOwnedSettingsFn, {
      enabled: true,
      channels: ["slack"],
      defaultAction: "service_review",
      deliverBeforeClientAcceptance: false,
    });
    await session.mutation(upsertRuleFn, {
      name: "Slack renewals",
      enabled: true,
      priority: 10,
      filters: { linesOfBusiness: ["Cyber"] },
      action: "service_review",
      channels: ["slack"],
    });

    await expect(
      session.query(getClientOwnedSettingsFn, { clientOrgId }),
    ).resolves.toMatchObject({
      deliveryOwnerOrgId: clientOrgId,
      clientOrgId,
      channels: ["slack"],
      defaultAction: "service_review",
    });
    await expect(session.query(listRulesFn, {})).resolves.toMatchObject([
      {
        deliveryOwnerOrgId: clientOrgId,
        clientOrgId,
        channels: ["slack"],
        action: "service_review",
      },
    ]);
  });

  test("dual-reads a legacy broker/client override before owner backfill", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, clientOrgId } = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Legacy Broker",
        type: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Legacy Client",
        type: "client",
        brokerOrgId,
      });
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@client.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: adminUserId,
        role: "admin",
      });
      await ctx.db.insert("policyDeliverySettings", {
        brokerOrgId,
        clientOrgId,
        enabled: true,
        channels: ["email"],
        defaultAction: "broker_review",
        deliverBeforeClientAcceptance: false,
        createdAt: 1,
        updatedAt: 1,
      });
      return { adminUserId, clientOrgId };
    });

    await expect(
      t
        .withIdentity({ subject: `${adminUserId}|session` })
        .query(getClientOwnedSettingsFn, { clientOrgId }),
    ).resolves.toMatchObject({
      clientOrgId,
      channels: ["email"],
      defaultAction: "broker_review",
    });
  });

  test("blocks the narrow gate until every legacy row has an owner", async () => {
    const t = convexTest(schema, modules);
    const { settingsId, clientOrgId } = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Legacy Client",
        type: "client",
      });
      const settingsId = await ctx.db.insert("policyDeliverySettings", {
        clientOrgId,
        enabled: true,
        channels: ["email"],
        defaultAction: "broker_review",
        deliverBeforeClientAcceptance: false,
        createdAt: 1,
        updatedAt: 1,
      });
      return { settingsId, clientOrgId };
    });

    await expect(
      t.query(verifyDeliveryOwnerBackfillFn, {}),
    ).resolves.toMatchObject({ complete: false, missing: { settings: 1 } });
    await t.run((ctx) =>
      ctx.db.patch(settingsId, { deliveryOwnerOrgId: clientOrgId }),
    );
    await expect(
      t.query(verifyDeliveryOwnerBackfillFn, {}),
    ).resolves.toMatchObject({ complete: true });
  });
});
