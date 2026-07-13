/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { getBrokerIdentity, resolveClientBySender } from "./orgs";

const modules = import.meta.glob("./**/*.ts");
const resolveClientBySenderFn = resolveClientBySender as any;
const getBrokerIdentityFn = getBrokerIdentity as any;

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

  test("keeps client-team and company-domain access modes distinct", async () => {
    const t = convexTest(schema, modules);

    const { clientOrgId } = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
        agentHandle: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Managed Client",
        type: "client",
        brokerOrgId,
        allowedDomains: ["client.com"],
        emailVerification: "open",
      });
      const clientUserId = await ctx.db.insert("users", {
        email: "member@client.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: clientUserId,
        role: "member",
      });
      return { clientOrgId };
    });

    const memberMatch = await t.query(resolveClientBySenderFn, {
      handle: "broker",
      senderEmail: "member@client.com",
    });
    expect(memberMatch?.matchedBy).toBe("member");

    const openDomainMatch = await t.query(resolveClientBySenderFn, {
      handle: "broker",
      senderEmail: "outside@client.com",
    });
    expect(openDomainMatch?.clientOrg).toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.patch(clientOrgId, { emailVerification: "domain" });
    });
    const domainMatch = await t.query(resolveClientBySenderFn, {
      handle: "broker",
      senderEmail: "outside@client.com",
    });
    expect(domainMatch?.matchedBy).toBe("domain");
  });

  test("lets broker admins edit the assigned producer and keeps members read-only", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Managed Client",
        type: "client",
        brokerOrgId,
      });
      const adminUserId = await ctx.db.insert("users", {
        name: "Broker Admin",
        email: "admin@broker.com",
      });
      const memberUserId = await ctx.db.insert("users", {
        name: "Broker Member",
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
      return { clientOrgId, adminUserId, memberUserId };
    });

    const adminIdentity = await t
      .withIdentity({ subject: `${ids.adminUserId}|session` })
      .query(getBrokerIdentityFn, { orgId: ids.clientOrgId });
    expect(adminIdentity?.canEdit).toBe(true);
    expect(adminIdentity?.brokerMembers).toHaveLength(2);

    const memberIdentity = await t
      .withIdentity({ subject: `${ids.memberUserId}|session` })
      .query(getBrokerIdentityFn, { orgId: ids.clientOrgId });
    expect(memberIdentity?.canEdit).toBe(false);
    expect(memberIdentity?.brokerMembers).toHaveLength(0);
  });
});
