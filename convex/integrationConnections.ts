// convex/integrationConnections.ts
import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess } from "./lib/access";
import {
  assertCanReadIntegrationsList,
} from "./lib/access";
import { encrypt, decrypt } from "./lib/secrets";
import { notify } from "./lib/notify";

// ── Queries ────────────────────────────────────────────────────────────────

/** List all connections for a client org (member or broker_of_client). */
export const listForClient = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.clientOrgId);
    assertCanReadIntegrationsList(access);

    return await ctx.db
      .query("integrationConnections")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
      .collect();
  },
});

/** Internal — used by sync actions (no auth context). */
export const getInternal = internalQuery({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => ctx.db.get(args.connectionId),
});

export const listActiveInternal = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("integrationConnections")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect(),
});

export const getByLinkedAccountIdInternal = internalQuery({
  args: { mergeLinkedAccountId: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("integrationConnections")
      .withIndex("by_mergeLinkedAccountId", (q) =>
        q.eq("mergeLinkedAccountId", args.mergeLinkedAccountId),
      )
      .first(),
});

// ── Mutations ───────────────────────────────────────────────────────────────

// createLinkToken has been moved to convex/actions/integrationConnectionActions.ts
// as an action (to allow external Merge API calls). Use api.actions.integrationConnectionActions.createLinkToken.

/**
 * Called from the webhook handler after `linked_account.created`.
 * Creates or replaces the connection row, schedules initial sync.
 * Internal — no user auth context.
 */
export const recordLinkedAccount = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    category: v.union(
      v.literal("accounting"),
      v.literal("hris"),
      v.literal("payroll"),
    ),
    mergeLinkedAccountId: v.string(),
    accountToken: v.string(),
    providerSlug: v.string(),
    providerDisplayName: v.string(),
    connectedByUserId: v.optional(v.id("users")),
    originatingApplicationId: v.optional(v.id("applications")),
    integrationRequestId: v.optional(v.id("integrationRequests")),
  },
  handler: async (ctx, args) => {
    const encryptedToken = await encrypt(args.accountToken);
    const now = Date.now();

    // Check uniqueness: one active connection per (clientOrgId, category, providerSlug)
    const existing = await ctx.db
      .query("integrationConnections")
      .withIndex("by_clientOrgId_category", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("category", args.category),
      )
      .filter((q) => q.eq(q.field("providerSlug"), args.providerSlug))
      .first();

    let connectionId: Id<"integrationConnections">;

    if (existing) {
      // Reconnect in place
      await ctx.db.patch(existing._id, {
        mergeAccountTokenEncrypted: encryptedToken,
        mergeLinkedAccountId: args.mergeLinkedAccountId,
        status: "connecting",
        connectedAt: now,
        disconnectedAt: undefined,
        lastSyncError: undefined,
      });
      connectionId = existing._id;
    } else {
      connectionId = await ctx.db.insert("integrationConnections", {
        clientOrgId: args.clientOrgId,
        category: args.category,
        mergeAccountTokenEncrypted: encryptedToken,
        mergeLinkedAccountId: args.mergeLinkedAccountId,
        providerSlug: args.providerSlug,
        providerDisplayName: args.providerDisplayName,
        status: "connecting",
        connectedByUserId: args.connectedByUserId,
        connectedAt: now,
        originatingApplicationId: args.originatingApplicationId,
        integrationRequestId: args.integrationRequestId,
      });
    }

    // Schedule initial sync
    await ctx.scheduler.runAfter(
      0,
      (internal as any).actions.mergeSync.runInitialSync,
      { connectionId },
    );

    return connectionId;
  },
});

/** Flip status to disconnected; call Merge delete endpoint. Internal version for webhook. */
export const markDisconnectedInternal = internalMutation({
  args: { mergeLinkedAccountId: v.string() },
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("integrationConnections")
      .withIndex("by_mergeLinkedAccountId", (q) =>
        q.eq("mergeLinkedAccountId", args.mergeLinkedAccountId),
      )
      .first();
    if (!conn) return;
    await ctx.db.patch(conn._id, { status: "disconnected", disconnectedAt: Date.now() });

    // Notify broker(s)
    const clientOrg = await ctx.db.get(conn.clientOrgId);
    if (clientOrg?.brokerOrgId) {
      await notify(ctx, {
        orgId: clientOrg.brokerOrgId,
        type: "integration_disconnected_for_client",
        title: `Integration disconnected`,
        body: `${conn.providerDisplayName} (${conn.category}) was disconnected for ${clientOrg.name}.`,
        relatedOrgId: conn.clientOrgId,
        actionType: "view_client_integrations",
        actionPayload: { clientOrgId: conn.clientOrgId },
      });
    }
  },
});

export const markReauthRequiredInternal = internalMutation({
  args: { mergeLinkedAccountId: v.string() },
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("integrationConnections")
      .withIndex("by_mergeLinkedAccountId", (q) =>
        q.eq("mergeLinkedAccountId", args.mergeLinkedAccountId),
      )
      .first();
    if (!conn) return;
    await ctx.db.patch(conn._id, { status: "reauth_required" });

    const clientOrg = await ctx.db.get(conn.clientOrgId);
    if (clientOrg?.brokerOrgId) {
      await notify(ctx, {
        orgId: clientOrg.brokerOrgId,
        type: "integration_disconnected_for_client",
        title: `Integration requires reconnection`,
        body: `${conn.providerDisplayName} (${conn.category}) needs to be reconnected for ${clientOrg.name}.`,
        relatedOrgId: conn.clientOrgId,
        actionType: "view_client_integrations",
        actionPayload: { clientOrgId: conn.clientOrgId },
      });
    }
  },
});

// disconnect has been moved to convex/actions/integrationConnectionActions.ts
// as an action (to allow external Merge API calls). Use api.actions.integrationConnectionActions.disconnect.

/** Internal: flip connection to disconnected by ID (called from disconnect action). */
export const markDisconnectedByIdInternal = internalMutation({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => {
    const conn = await ctx.db.get(args.connectionId);
    if (!conn) return;
    await ctx.db.patch(args.connectionId, { status: "disconnected", disconnectedAt: Date.now() });

    const clientOrg = await ctx.db.get(conn.clientOrgId);
    if (clientOrg?.brokerOrgId) {
      await notify(ctx, {
        orgId: clientOrg.brokerOrgId,
        type: "integration_disconnected_for_client",
        title: `Integration disconnected`,
        body: `${conn.providerDisplayName} (${conn.category}) was disconnected for ${clientOrg.name}.`,
        relatedOrgId: conn.clientOrgId,
        actionType: "view_client_integrations",
        actionPayload: { clientOrgId: conn.clientOrgId },
      });
    }
  },
});

/** Internal: mark active + update sync timestamps after a successful sync. */
export const markSyncComplete = internalMutation({
  args: {
    connectionId: v.id("integrationConnections"),
    status: v.union(v.literal("success"), v.literal("partial"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      status: args.status === "error" ? "error" : "active",
      lastSyncAt: Date.now(),
      lastSyncStatus: args.status,
      lastSyncError: args.error,
    });
  },
});

/** Internal: decrypt the account token for use in sync actions. */
export const getDecryptedTokenInternal = internalQuery({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => {
    const conn = await ctx.db.get(args.connectionId);
    if (!conn) return null;
    const token = await decrypt(conn.mergeAccountTokenEncrypted);
    return { token, category: conn.category, clientOrgId: conn.clientOrgId };
  },
});
