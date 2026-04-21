// convex/clientInvitations.ts
//
// Client invitation flows — creates new client orgs on acceptance.
// Distinct from orgInvitations (which invites users into an *existing* org).

import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal as _internal } from "./_generated/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;
import { getOrgAccess, assertBrokerOrg } from "./lib/access";
import { recordBrokerActivity } from "./lib/brokerActivity";
import { notify } from "./lib/notify";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Hash a raw token string to SHA-256 hex.
 * Runs inside a Convex action (Node.js runtime) via internal mutation transport.
 */
async function sha256Hex(token: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a 32-byte random hex token string. */
function randomToken(): string {
  const { randomBytes } = require("crypto");
  return (randomBytes(32) as Buffer).toString("hex");
}

// ── Public mutations / queries ─────────────────────────────────────────────────

/**
 * Create an email client invitation.
 * Broker admins/members create these for a specific contact.
 */
export const createEmail = action({
  args: {
    orgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.string(),
    primaryContactName: v.optional(v.string()),
    prefillPassport: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const access = await ctx.runQuery(internal.clientInvitations.resolveAccessInternal, {
      userId,
      orgId: args.orgId,
    });
    if (!access) throw new Error("Unauthorized");
    if (access.orgType !== "broker") throw new Error("Only broker orgs can invite clients");
    if (access.accessType !== "member") throw new Error("Must be a broker org member");

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14 days

    await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId: args.orgId,
      clientOrgName: args.clientOrgName,
      primaryContactEmail: args.primaryContactEmail,
      primaryContactName: args.primaryContactName,
      prefillPassport: args.prefillPassport,
      invitedBy: userId,
      inviteTokenHash: tokenHash,
      linkType: "email",
      status: "pending",
      expiresAt,
      createdAt: Date.now(),
    });

    return { token: rawToken };
  },
});

/**
 * Create a shareable client invitation link.
 */
export const createShareable = action({
  args: {
    orgId: v.id("organizations"),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const access = await ctx.runQuery(internal.clientInvitations.resolveAccessInternal, {
      userId,
      orgId: args.orgId,
    });
    if (!access) throw new Error("Unauthorized");
    if (access.orgType !== "broker") throw new Error("Only broker orgs can create shareable links");
    if (access.accessType !== "member") throw new Error("Must be a broker org member");

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);

    await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId: args.orgId,
      invitedBy: userId,
      inviteTokenHash: tokenHash,
      linkType: "shareable",
      status: "pending",
      acceptedCount: 0,
      maxUses: args.maxUses,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });

    return { token: rawToken };
  },
});

/** Revoke a pending invitation. Broker admin only. */
export const revoke = mutation({
  args: {
    orgId: v.id("organizations"),
    invitationId: v.id("clientInvitations"),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertBrokerOrg(access);
    if (access.role !== "admin") throw new Error("Admin role required to revoke invitations");

    const inv = await ctx.db.get(args.invitationId);
    if (!inv || inv.brokerOrgId !== args.orgId) throw new Error("Invitation not found");
    if (inv.status !== "pending") throw new Error("Only pending invitations can be revoked");

    await ctx.db.patch(args.invitationId, { status: "revoked" });
  },
});

/** List all client invitations for a broker org. */
export const list = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertBrokerOrg(access);

    return await ctx.db
      .query("clientInvitations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", args.orgId))
      .order("desc")
      .collect();
  },
});

/**
 * Public (unauthenticated) — look up invite metadata for the acceptance page.
 * Returns broker branding + prefill data. Does NOT return the tokenHash.
 */
export const getByToken = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const inv = await ctx.runQuery(internal.clientInvitations.getByHashInternal, { tokenHash });
    if (!inv) throw new Error("Invitation not found");

    if (inv.status === "revoked") throw new Error("This invitation has been revoked");
    if (inv.status === "expired") throw new Error("This invitation has expired");
    if (inv.expiresAt && inv.expiresAt < Date.now()) {
      await ctx.runMutation(internal.clientInvitations.markExpired, { invitationId: inv._id });
      throw new Error("This invitation has expired");
    }
    if (inv.linkType === "email" && inv.status === "accepted") {
      throw new Error("This invitation has already been accepted");
    }
    if (inv.maxUses !== undefined && (inv.acceptedCount ?? 0) >= inv.maxUses) {
      throw new Error("This invitation link has reached its maximum uses");
    }

    const brokerOrg = await ctx.runQuery(internal.clientInvitations.getOrgInternal, {
      orgId: inv.brokerOrgId,
    });

    return {
      invitationId: inv._id,
      linkType: inv.linkType,
      brokerName: brokerOrg?.name ?? "Your Broker",
      brokerSlug: brokerOrg?.slug,
      brandingColor: brokerOrg?.brandingColor,
      agentDisplayName: brokerOrg?.agentDisplayName,
      clientOrgName: inv.clientOrgName,
      primaryContactEmail: inv.primaryContactEmail,
      primaryContactName: inv.primaryContactName,
      prefillPassport: inv.prefillPassport,
    };
  },
});

/**
 * Accept a client invitation.
 * Creates a new client org + makes the calling user an admin of it.
 * Caller must already be authenticated (signed up or logged in just before calling this).
 */
export const accept = mutation({
  args: {
    token: v.string(),
    clientOrgName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // We can't call the action sha256Hex inside a mutation — token lookup uses
    // a pre-hashed index. Accept receives the raw token, hashes it inline using
    // Web Crypto (available in Convex mutation runtime via TextEncoder).
    // Convex mutations run in V8; use subtle crypto.
    const encoder = new TextEncoder();
    const data = encoder.encode(args.token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const inv = await ctx.db
      .query("clientInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();

    if (!inv) throw new Error("Invitation not found");
    if (inv.status === "revoked") throw new Error("This invitation has been revoked");
    if (inv.status === "expired") throw new Error("This invitation has expired");
    if (inv.expiresAt && inv.expiresAt < Date.now()) {
      await ctx.db.patch(inv._id, { status: "expired" });
      throw new Error("This invitation has expired");
    }
    if (inv.linkType === "email" && inv.status === "accepted") {
      throw new Error("This invitation has already been accepted");
    }
    if (inv.maxUses !== undefined && (inv.acceptedCount ?? 0) >= inv.maxUses) {
      throw new Error("This invitation link has reached its maximum uses");
    }

    // Create the client org
    const clientOrgId = await ctx.db.insert("organizations", {
      name: args.clientOrgName,
      type: "client",
      brokerOrgId: inv.brokerOrgId,
    });

    // Make the accepting user admin of the new client org
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId,
      role: "admin",
    });

    // Update invitation
    if (inv.linkType === "email") {
      await ctx.db.patch(inv._id, { status: "accepted", clientOrgId });
    } else {
      await ctx.db.patch(inv._id, {
        acceptedCount: (inv.acceptedCount ?? 0) + 1,
        clientOrgId, // last accepted org for reference
      });
    }

    // Record broker activity
    const acceptingUser = await ctx.db.get(userId);
    await recordBrokerActivity(ctx, {
      brokerOrgId: inv.brokerOrgId,
      clientOrgId,
      type: "invitation_accepted",
      actorUserId: userId,
      actorSide: "client",
      summary: `${acceptingUser?.name ?? acceptingUser?.email ?? "A client"} accepted the invitation to join.`,
      payload: { invitationId: inv._id },
    });

    // Notify broker of invitation acceptance
    await notify(ctx, {
      orgId: inv.brokerOrgId,
      type: "client_invitation_accepted",
      title: "Client accepted your invitation",
      body: `${args.clientOrgName} accepted your invitation and joined Glass.`,
      relatedOrgId: clientOrgId,
      actionType: "view_client",
      actionPayload: { clientOrgId },
    });

    // Pre-fill passport with invite data
    const inviteeEmail = inv.primaryContactEmail ?? acceptingUser?.email;
    const inviteeName = inv.primaryContactName ?? acceptingUser?.name;
    const companyName = inv.clientOrgName;

    const passportPatch: Record<string, unknown> = {};
    if (inviteeEmail) passportPatch.primaryContactEmail = inviteeEmail;
    if (inviteeName) passportPatch.primaryContactName = inviteeName;
    if (companyName) passportPatch.legalName = companyName;

    if (Object.keys(passportPatch).length > 0) {
      await ctx.runMutation(internal.clientPassport.upsertCoreInternal, {
        clientOrgId,
        patch: passportPatch,
        actorUserId: userId,
      });

      // Write provenance rows for invite-sourced fields
      const now = Date.now();
      if (inviteeEmail) {
        await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
          clientOrgId,
          fieldPath: "primaryContactEmail",
          source: "invite",
          confidence: "confirmed",
          sourceLabel: "Broker invite",
          setAt: now,
        });
      }
      if (inviteeName) {
        await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
          clientOrgId,
          fieldPath: "primaryContactName",
          source: "invite",
          confidence: "confirmed",
          sourceLabel: "Broker invite",
          setAt: now,
        });
      }
      if (companyName) {
        await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
          clientOrgId,
          fieldPath: "legalName",
          source: "invite",
          confidence: "confirmed",
          sourceLabel: "Broker invite",
          setAt: now,
        });
      }
    }

    return { clientOrgId };
  },
});

// ── Internal helpers used by actions ─────────────────────────────────────────

export const insertInvitation = internalMutation({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    prefillPassport: v.optional(v.any()),
    invitedBy: v.id("users"),
    inviteTokenHash: v.string(),
    linkType: v.union(v.literal("email"), v.literal("shareable")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("revoked")),
    acceptedCount: v.optional(v.number()),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clientInvitations", args);
  },
});

export const getByHashInternal = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    return await ctx.db
      .query("clientInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();
  },
});

export const getOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    return await ctx.db.get(orgId);
  },
});

export const markExpired = internalMutation({
  args: { invitationId: v.id("clientInvitations") },
  handler: async (ctx, { invitationId }) => {
    await ctx.db.patch(invitationId, { status: "expired" });
  },
});

export const resolveAccessInternal = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, { userId, orgId }) => {
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const orgType = (org.type as "broker" | "client") ?? "client";

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", userId))
      .first();

    if (membership) return { orgType, accessType: "member" as const, role: membership.role };

    if (orgType === "client" && org.brokerOrgId) {
      const bm = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", org.brokerOrgId!).eq("userId", userId),
        )
        .first();
      if (bm) return { orgType: "client" as const, accessType: "broker_of_client" as const, role: undefined };
    }

    return null;
  },
});
