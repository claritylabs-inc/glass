/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { resolveClientBySender } from "./orgs";

const modules = import.meta.glob("./**/*.ts");
const resolveClientBySenderFn = resolveClientBySender as any;

describe("org email routing", () => {
  test("routes default agent handle to a standalone client org by member email", async () => {
    const t = convexTest(schema, modules);

    const { orgId, userId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Standalone Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Client Admin",
        email: "admin@example.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      return { orgId, userId };
    });

    const resolved = await t.query(resolveClientBySenderFn, {
      handle: "agent",
      senderEmail: "admin@example.com",
    });

    expect(resolved?.brokerOrg._id).toBe(orgId);
    expect(resolved?.clientOrg).toBeNull();
    expect(resolved?.matchedBy).toBe("member");
    expect(userId).toBeTruthy();
  });

  test("does not route default agent handle for an unrecognized sender", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Standalone Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Client Admin",
        email: "admin@example.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
    });

    const resolved = await t.query(resolveClientBySenderFn, {
      handle: "agent",
      senderEmail: "stranger@example.net",
    });

    expect(resolved).toBeNull();
  });

  test("keeps broker-owned handle routing to managed clients", async () => {
    const t = convexTest(schema, modules);

    const { brokerOrgId, clientOrgId } = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
        agentHandle: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Managed Client",
        type: "client",
        brokerOrgId,
        allowedEmails: ["contact@client.com"],
        emailVerification: "strict",
      });
      return { brokerOrgId, clientOrgId };
    });

    const resolved = await t.query(resolveClientBySenderFn, {
      handle: "broker",
      senderEmail: "contact@client.com",
    });

    expect(resolved?.brokerOrg._id).toBe(brokerOrgId);
    expect(resolved?.clientOrg?._id).toBe(clientOrgId);
    expect(resolved?.matchedBy).toBe("email");
  });
});
