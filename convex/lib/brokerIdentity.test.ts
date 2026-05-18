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
        contactNameOverride: "Service Team",
        contactEmailOverride: "service@broker.test",
        contactPhoneOverride: "+15555550199",
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

  test("falls back to broker org primary insurance contact", async () => {
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
      contactName: "Default Contact",
      contactEmail: "default@broker.test",
      contactPhone: "+15555550200",
      source: "broker_default",
    });
  });

  test("uses manual broker identity for standalone clients", async () => {
    const t = convexTest(schema, modules);

    const identity = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Standalone Client",
        type: "client",
        brokerCompanyName: "Outside Broker",
        brokerContactName: "Morgan Broker",
        brokerContactEmail: "morgan@outside.test",
        brokerContactPhone: "+15555550300",
      });

      const clientOrg = await ctx.db.get(clientOrgId);
      return await resolveBrokerIdentityForClient(ctx, clientOrg!);
    });

    expect(identity).toMatchObject({
      brokerCompanyName: "Outside Broker",
      contactName: "Morgan Broker",
      contactEmail: "morgan@outside.test",
      contactPhone: "+15555550300",
      source: "manual",
    });
  });
});
