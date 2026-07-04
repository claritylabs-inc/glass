/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { resolveBrokerIdentityForClient } from "./brokerIdentity";

const modules = import.meta.glob("../**/*.ts");

describe("resolveBrokerIdentityForClient", () => {
  test("uses the primary broker-client assignment", async () => {
    const t = convexTest(schema, modules);

    const identity = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Acme Brokerage",
        type: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
        brokerOrgId,
      });
      const producerId = await ctx.db.insert("users", {
        name: "Pat Producer",
        email: "pat@broker.test",
        phone: "+15555550100",
      });
      await ctx.db.insert("brokerClientAssignments", {
        orgId: brokerOrgId,
        clientOrgId,
        producerId,
        role: "primary",
        createdAt: 1,
      });

      const clientOrg = await ctx.db.get(clientOrgId);
      return await resolveBrokerIdentityForClient(ctx, clientOrg!);
    });

    expect(identity).toMatchObject({
      brokerCompanyName: "Acme Brokerage",
      contactName: "Pat Producer",
      contactEmail: "pat@broker.test",
      contactPhone: "+15555550100",
      source: "assignment",
    });
  });

  test("uses assignment overrides before user profile fields", async () => {
    const t = convexTest(schema, modules);

    const identity = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Acme Brokerage",
        type: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
        brokerOrgId,
      });
      const producerId = await ctx.db.insert("users", {
        name: "Pat Producer",
        email: "pat@broker.test",
        phone: "+15555550100",
      });
      await ctx.db.insert("brokerClientAssignments", {
        orgId: brokerOrgId,
        clientOrgId,
        producerId,
        role: "primary",
        contactName: "Service Team",
        contactEmail: "service@broker.test",
        contactPhone: "+15555550199",
        createdAt: 1,
      });

      const clientOrg = await ctx.db.get(clientOrgId);
      return await resolveBrokerIdentityForClient(ctx, clientOrg!);
    });

    expect(identity).toMatchObject({
      contactName: "Service Team",
      contactEmail: "service@broker.test",
      contactPhone: "+15555550199",
      source: "assignment",
    });
  });

  test("does not fall back to broker org primary insurance contact without an assignment", async () => {
    const t = convexTest(schema, modules);

    const identity = await t.run(async (ctx) => {
      const producerId = await ctx.db.insert("users", {
        name: "Default Contact",
        email: "default@broker.test",
        phone: "+15555550200",
      });
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Acme Brokerage",
        type: "broker",
        primaryInsuranceContactId: producerId,
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
        brokerOrgId,
      });

      const clientOrg = await ctx.db.get(clientOrgId);
      return await resolveBrokerIdentityForClient(ctx, clientOrg!);
    });

    expect(identity).toMatchObject({
      brokerCompanyName: "Acme Brokerage",
      source: "none",
    });
    expect(identity.contactName).toBeUndefined();
    expect(identity.contactEmail).toBeUndefined();
    expect(identity.contactPhone).toBeUndefined();
  });

  test("does not use static broker fields for standalone clients", async () => {
    const t = convexTest(schema, modules);

    const { identity, clientOrgId } = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Standalone Client",
        type: "client",
      });

      const clientOrg = await ctx.db.get(clientOrgId);
      return {
        clientOrgId,
        identity: await resolveBrokerIdentityForClient(ctx, clientOrg!),
      };
    });

    expect(identity).toEqual({ clientOrgId, source: "none" });
  });
});
