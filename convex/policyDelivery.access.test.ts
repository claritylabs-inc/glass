/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { updateClientOverride } from "./policyDelivery";

const modules = import.meta.glob("./**/*.ts");
const updateClientOverrideFn = updateClientOverride as any;

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
    ).rejects.toThrow("Broker admin access required");

    await expect(
      t
        .withIdentity({ subject: `${ids.adminUserId}|session` })
        .mutation(updateClientOverrideFn, args),
    ).resolves.toBeTruthy();
  });
});
