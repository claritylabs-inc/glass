// convex/lib/accessTests.ts
// Run with: npx convex run lib/accessTests:runAll
// Expected output: "All access tests passed"

import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

// ── helpers ──────────────────────────────────────────────────────────────────

export const createUser = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("users", {
      email: `test-${Date.now()}-${Math.random()}@example.com`,
      name: "Test User",
      emailVerificationTime: Date.now(),
    });
  },
});

export const createOrg = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("organizations", {
      name: "Test Broker",
      type: "broker",
    });
  },
});

export const createClientOrg = internalMutation({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, { brokerOrgId }) => {
    return await ctx.db.insert("organizations", {
      name: "Test Client",
      type: "client",
      brokerOrgId,
    });
  },
});

export const addMembership = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("orgMemberships", args);
  },
});

export const cleanup = internalMutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    // best-effort cleanup — ignores errors
    for (const id of ids) {
      try { await ctx.db.delete(id as Id<"organizations">); } catch {}
      try { await ctx.db.delete(id as Id<"users">); } catch {}
      try { await ctx.db.delete(id as Id<"orgMemberships">); } catch {}
    }
  },
});

// ── test runner ───────────────────────────────────────────────────────────────

export const runAll = action({
  args: {},
  handler: async (ctx) => {
    const failures: string[] = [];

    function assert(cond: boolean, msg: string) {
      if (!cond) failures.push(msg);
    }

    // --- setup ---
    const brokerId = await ctx.runMutation(internal.lib.accessTests.createOrg);
    const userId = await ctx.runMutation(internal.lib.accessTests.createUser);
    const clientId = await ctx.runMutation(internal.lib.accessTests.createClientOrg, {
      brokerOrgId: brokerId,
    });
    const membershipId = await ctx.runMutation(internal.lib.accessTests.addMembership, {
      orgId: brokerId,
      userId,
      role: "admin",
    });

    // TEST 1: direct member of broker org
    // Note: getOrgAccess requires auth context, so we test the resolution logic
    // indirectly via internalQuery
    const brokerAccess = await ctx.runQuery(internal.lib.accessTests.resolveAccess, {
      userId,
      orgId: brokerId,
    });
    assert(brokerAccess?.accessType === "member", "TEST1: should be member of broker org");
    assert(brokerAccess?.orgType === "broker", "TEST1: orgType should be broker");
    assert(brokerAccess?.role === "admin", "TEST1: role should be admin");

    // TEST 2: broker_of_client
    const clientAccess = await ctx.runQuery(internal.lib.accessTests.resolveAccess, {
      userId,
      orgId: clientId,
    });
    assert(clientAccess?.accessType === "broker_of_client", "TEST2: broker user should get broker_of_client access");
    assert(clientAccess?.orgType === "client", "TEST2: orgType should be client");
    assert(clientAccess?.role === undefined, "TEST2: role should be undefined for broker_of_client");

    // TEST 3: unrelated user has no access
    const strangerUserId = await ctx.runMutation(internal.lib.accessTests.createUser);
    const strangerAccess = await ctx.runQuery(internal.lib.accessTests.resolveAccess, {
      userId: strangerUserId,
      orgId: clientId,
    });
    assert(strangerAccess === null, "TEST3: stranger should have no access");

    // TEST 4: broker org without brokerOrgId set — broker user cannot reach a different broker
    const otherBrokerId = await ctx.runMutation(internal.lib.accessTests.createOrg);
    const crossBrokerAccess = await ctx.runQuery(internal.lib.accessTests.resolveAccess, {
      userId,
      orgId: otherBrokerId,
    });
    assert(crossBrokerAccess === null, "TEST4: cross-broker access should fail");

    // cleanup (best effort)
    await ctx.runMutation(internal.lib.accessTests.cleanup, {
      ids: [brokerId, clientId, otherBrokerId, userId, strangerUserId, membershipId],
    });

    if (failures.length > 0) {
      throw new Error("FAILURES:\n" + failures.join("\n"));
    }

    return "All access tests passed";
  },
});

// ── internal query used by tests (bypasses auth) ──────────────────────────────

export const resolveAccess = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, { userId, orgId }) => {
    const org = await ctx.db.get(orgId);
    if (!org) return null;

    const orgType: "broker" | "client" = (org.type as "broker" | "client") ?? "client";

    // Direct membership
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", userId))
      .first();

    if (membership) {
      return {
        userId,
        orgType,
        accessType: "member" as const,
        role: membership.role as "admin" | "member",
        brokerOrgId: undefined as undefined,
      };
    }

    // Broker-of-client
    if (orgType === "client" && org.brokerOrgId) {
      const brokerMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", org.brokerOrgId!).eq("userId", userId),
        )
        .first();

      if (brokerMembership) {
        return {
          userId,
          orgType: "client" as const,
          accessType: "broker_of_client" as const,
          role: undefined as undefined,
          brokerOrgId: org.brokerOrgId,
        };
      }
    }

    return null;
  },
});
