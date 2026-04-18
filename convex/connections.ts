import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess, requireOrgAdmin, getOrgAccess } from "./lib/orgAuth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    return await ctx.db
      .query("emailConnections")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", access.orgId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const connection = await ctx.db.get(args.id);
    if (!connection || connection.orgId !== orgId) return null;
    return connection;
  },
});

// Internal query to list all connections (for cron jobs, no auth context)
export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("emailConnections").collect();
  },
});

// Internal query for use by scheduled actions (no auth context)
export const getInternal = internalQuery({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    imapHost: v.string(),
    imapPort: v.number(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAdmin(ctx);
    return await ctx.db.insert("emailConnections", {
      ...args,
      provider: "imap",
      userId,
      orgId,
    });
  },
});

export const createGoogle = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
    email: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiry: v.number(),
  },
  handler: async (ctx, args) => {
    // Check for existing Google connection with same email + org (upsert)
    const existing = await ctx.db
      .query("emailConnections")
      .withIndex("by_email_orgId_provider", (idx) =>
        idx.eq("email", args.email).eq("orgId", args.orgId).eq("provider", "google")
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        tokenExpiry: args.tokenExpiry,
        lastScanStatus: undefined,
        lastScanError: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("emailConnections", {
      provider: "google",
      userId: args.userId,
      orgId: args.orgId,
      label: args.email,
      email: args.email,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      tokenExpiry: args.tokenExpiry,
    });
  },
});

export const updateTokens = internalMutation({
  args: {
    id: v.id("emailConnections"),
    accessToken: v.string(),
    tokenExpiry: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      accessToken: args.accessToken,
      tokenExpiry: args.tokenExpiry,
    });
  },
});

// OAuth state management
export const createOAuthState = internalMutation({
  args: {
    state: v.string(),
    userId: v.id("users"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("oauthStates", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (idx) => idx.eq("state", args.state))
      .first();

    if (!record) return null;

    // Expire after 10 minutes
    if (Date.now() - record.createdAt > 10 * 60 * 1000) {
      await ctx.db.delete(record._id);
      return null;
    }

    await ctx.db.delete(record._id);
    return { userId: record.userId, orgId: record.orgId };
  },
});

// Public mutation for Google OAuth callback (no user auth context — uses server secret)
export const connectGoogle = mutation({
  args: {
    serverSecret: v.string(),
    orgId: v.string(),
    email: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiry: v.number(),
    sinceDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.GOOGLE_OAUTH_SERVER_SECRET;
    if (!expected || args.serverSecret !== expected) {
      throw new Error("Unauthorized");
    }

    const orgId = args.orgId as string; // from URL state, already validated

    // Upsert: update existing Google connection or create new one
    const existing = await ctx.db
      .query("emailConnections")
      .withIndex("by_email_orgId_provider", (idx) =>
        idx.eq("email", args.email).eq("orgId", orgId).eq("provider", "google")
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        tokenExpiry: args.tokenExpiry,
        lastScanStatus: undefined,
        lastScanError: undefined,
      });
      return existing._id;
    }

    const connectionId = await ctx.db.insert("emailConnections", {
      provider: "google",
      orgId,
      label: args.email,
      email: args.email,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      tokenExpiry: args.tokenExpiry,
      lastScanParams: args.sinceDate ? { sinceDate: args.sinceDate } : undefined,
    });

    // Schedule initial scan
    await ctx.scheduler.runAfter(0, internal.actions.dailyScan.scanSingleConnection, {
      connectionId,
    });

    return connectionId;
  },
});

export const updateScanStatus = mutation({
  args: {
    id: v.id("emailConnections"),
    lastScanStatus: v.union(
      v.literal("scanning"),
      v.literal("success"),
      v.literal("error"),
      v.literal("disconnected")
    ),
    lastScanAt: v.optional(v.number()),
    lastScanError: v.optional(v.string()),
    emailsFound: v.optional(v.number()),
    policiesExtracted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const updateScanProgress = mutation({
  args: {
    id: v.id("emailConnections"),
    scanProgress: v.object({
      phase: v.string(),
      totalEmails: v.optional(v.number()),
      processedEmails: v.optional(v.number()),
      insuranceFound: v.optional(v.number()),
      extracting: v.optional(v.number()),
      extracted: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { scanProgress: args.scanProgress });
  },
});

/**
 * Atomically increment the extracted counter on scanProgress.
 * Runs inside a single Convex mutation (transaction) so concurrent calls
 * are serialized — no lost increments.
 */
export const incrementExtracted = internalMutation({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const conn = await ctx.db.get(args.id);
    if (!conn?.scanProgress) return;

    const extracted = (conn.scanProgress.extracted ?? 0) + 1;
    const extracting = conn.scanProgress.extracting ?? 0;

    await ctx.db.patch(args.id, {
      scanProgress: {
        ...conn.scanProgress,
        extracted,
        phase: extracted >= extracting ? "complete" : conn.scanProgress.phase,
      },
    });
  },
});

export const stopScan = mutation({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const connection = await ctx.db.get(args.id);
    if (!connection || connection.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, {
      scanProgress: { phase: "complete" },
      lastScanStatus: "success" as const,
    });
  },
});

export const updateLastScanParams = mutation({
  args: {
    id: v.id("emailConnections"),
    lastScanParams: v.object({
      sinceDate: v.optional(v.string()),
      untilDate: v.optional(v.string()),
      senderDomains: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastScanParams: args.lastScanParams });
  },
});

export const remove = mutation({
  args: {
    id: v.id("emailConnections"),
    deletePolicies: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const connection = await ctx.db.get(args.id);
    if (!connection || connection.orgId !== orgId) throw new Error("Not found");

    // Find all emails for this connection
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (idx) =>
        idx.eq("connectionId", args.id)
      )
      .collect();
    const emailIds = new Set(emails.map((e) => e._id));

    if (args.deletePolicies) {
      // Delete policies linked to these emails
      const allPolicies = await ctx.db
        .query("policies")
        .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
        .collect();
      for (const policy of allPolicies) {
        if (policy.emailId && emailIds.has(policy.emailId)) {
          await ctx.db.delete(policy._id);
        }
      }
    }

    // Delete emails
    for (const email of emails) {
      await ctx.db.delete(email._id);
    }

    // Delete the connection itself
    await ctx.db.delete(args.id);
  },
});

export const countLinkedPolicies = query({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { emailCount: 0, policyCount: 0 };
    const { orgId } = access;
    const connection = await ctx.db.get(args.id);
    if (!connection || connection.orgId !== orgId) return { emailCount: 0, policyCount: 0 };

    const emails = await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (idx) =>
        idx.eq("connectionId", args.id)
      )
      .collect();
    const emailIds = new Set(emails.map((e) => e._id));

    const allPolicies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const linked = allPolicies.filter(
      (p) => p.emailId && emailIds.has(p.emailId) && p.extractionStatus === "complete"
    );

    return { emailCount: emails.length, policyCount: linked.length };
  },
});
