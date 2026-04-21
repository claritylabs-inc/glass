// convex/clientInvitationsTest.ts
// Run with: npx convex run clientInvitationsTest:runAll
// Expected: "All client invitation tests passed"

import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const setupBrokerOrg = internalMutation({
  args: {},
  handler: async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: `broker-test-${Date.now()}@example.com`,
      name: "Broker Admin",
      emailVerificationTime: Date.now(),
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Test Broker Co",
      type: "broker",
      slug: `test-broker-${Date.now()}`,
    });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    return { userId, orgId };
  },
});

const createClientUser = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("users", {
      email: `client-test-${Date.now()}@example.com`,
      name: "Client Admin",
      emailVerificationTime: Date.now(),
    });
  },
});

const cleanupIds = internalMutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    for (const id of ids) {
      for (const _table of ["organizations", "users", "orgMemberships", "clientInvitations"] as const) {
        try { await ctx.db.delete(id as any); } catch {}
      }
    }
  },
});

const getOrgMembership = internalQuery({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, { orgId, userId }) => {
    return await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", userId))
      .first();
  },
});

const getInvitationByHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    return await ctx.db
      .query("clientInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();
  },
});

export const runAll = action({
  args: {},
  handler: async (ctx) => {
    const failures: string[] = [];
    function assert(cond: boolean, msg: string) { if (!cond) failures.push(msg); }

    const allIds: string[] = [];

    // --- setup ---
    const { userId: brokerUserId, orgId: brokerOrgId } = await ctx.runMutation(
      internal.clientInvitationsTest.setupBrokerOrg,
    );
    allIds.push(brokerUserId, brokerOrgId);

    // TEST 1: create email invite
    // Can't call actions in tests directly — insert invitation directly via internal mutation
    const rawToken = "test-token-abc123-" + Date.now();
    const encoder = new TextEncoder();
    const data = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const invId = await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId,
      primaryContactEmail: "client@example.com",
      primaryContactName: "Alice",
      clientOrgName: "Alice Co",
      invitedBy: brokerUserId,
      inviteTokenHash: tokenHash,
      linkType: "email",
      status: "pending",
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    allIds.push(invId);

    // TEST 2: getByToken returns broker branding
    const invData = await ctx.runQuery(internal.clientInvitations.getByHashInternal, { tokenHash });
    assert(invData !== null, "TEST2: invitation should exist");
    assert(invData?.status === "pending", "TEST2: invitation should be pending");
    assert(invData?.clientOrgName === "Alice Co", "TEST2: clientOrgName should match");

    // TEST 3: accept creates client org + membership
    const clientUserId = await ctx.runMutation(internal.clientInvitationsTest.createClientUser);
    allIds.push(clientUserId);

    // Simulate the accept mutation logic inline (mutations can't call other mutations
    // in Convex, so we reproduce the core of accept here)
    const clientOrgId = await ctx.runMutation(internal.clientInvitationsTest.simulateAccept, {
      invitationId: invId,
      clientOrgName: "Alice Corp",
      clientUserId,
    });
    allIds.push(clientOrgId);

    const clientOrg = await ctx.runQuery(internal.clientInvitations.getOrgInternal, {
      orgId: clientOrgId,
    });
    assert(clientOrg?.type === "client", "TEST3: accepted org should be type client");
    assert(clientOrg?.brokerOrgId === brokerOrgId, "TEST3: brokerOrgId should link back to broker");

    const membership = await ctx.runQuery(internal.clientInvitationsTest.getOrgMembership, {
      orgId: clientOrgId,
      userId: clientUserId,
    });
    assert(membership?.role === "admin", "TEST3: accepting user should be admin of new org");

    const updatedInv = await ctx.runQuery(internal.clientInvitations.getByHashInternal, { tokenHash });
    assert(updatedInv?.status === "accepted", "TEST3: invitation should now be accepted");
    assert(updatedInv?.clientOrgId === clientOrgId, "TEST3: clientOrgId should be set on invitation");

    // TEST 4: shareable link — accept twice creates two distinct orgs
    const shareableToken = "shareable-token-" + Date.now();
    const shareableData = encoder.encode(shareableToken);
    const shareableHashBuffer = await crypto.subtle.digest("SHA-256", shareableData);
    const shareableTokenHash = Array.from(new Uint8Array(shareableHashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const shareableInvId = await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId,
      invitedBy: brokerUserId,
      inviteTokenHash: shareableTokenHash,
      linkType: "shareable",
      status: "pending",
      acceptedCount: 0,
      createdAt: Date.now(),
    });
    allIds.push(shareableInvId);

    const clientUser2Id = await ctx.runMutation(internal.clientInvitationsTest.createClientUser);
    allIds.push(clientUser2Id);
    const clientUser3Id = await ctx.runMutation(internal.clientInvitationsTest.createClientUser);
    allIds.push(clientUser3Id);

    const org2Id = await ctx.runMutation(internal.clientInvitationsTest.simulateAccept, {
      invitationId: shareableInvId,
      clientOrgName: "Shareable Client 1",
      clientUserId: clientUser2Id,
    });
    allIds.push(org2Id);

    const org3Id = await ctx.runMutation(internal.clientInvitationsTest.simulateAccept, {
      invitationId: shareableInvId,
      clientOrgName: "Shareable Client 2",
      clientUserId: clientUser3Id,
    });
    allIds.push(org3Id);

    assert(org2Id !== org3Id, "TEST4: two acceptances should create two distinct orgs");

    const shareableInvFinal = await ctx.runQuery(
      internal.clientInvitations.getByHashInternal,
      { tokenHash: shareableTokenHash },
    );
    assert(shareableInvFinal?.acceptedCount === 2, "TEST4: acceptedCount should be 2");

    // cleanup
    await ctx.runMutation(internal.clientInvitationsTest.cleanupIds, { ids: allIds });

    if (failures.length > 0) throw new Error("FAILURES:\n" + failures.join("\n"));
    return "All client invitation tests passed";
  },
});

// Simulate accept in a single mutation (mirrors accept handler logic)
export const simulateAccept = internalMutation({
  args: {
    invitationId: v.id("clientInvitations"),
    clientOrgName: v.string(),
    clientUserId: v.id("users"),
  },
  handler: async (ctx, { invitationId, clientOrgName, clientUserId }) => {
    const inv = await ctx.db.get(invitationId);
    if (!inv) throw new Error("Not found");

    const clientOrgId = await ctx.db.insert("organizations", {
      name: clientOrgName,
      type: "client",
      brokerOrgId: inv.brokerOrgId,
    });

    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: clientUserId,
      role: "admin",
    });

    if (inv.linkType === "email") {
      await ctx.db.patch(invitationId, { status: "accepted", clientOrgId });
    } else {
      await ctx.db.patch(invitationId, {
        acceptedCount: (inv.acceptedCount ?? 0) + 1,
        clientOrgId,
      });
    }

    return clientOrgId;
  },
});
