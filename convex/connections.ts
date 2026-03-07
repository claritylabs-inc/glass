import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return await ctx.db
      .query("emailConnections")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId as any))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const connection = await ctx.db.get(args.id);
    if (!connection || connection.userId !== userId) return null;
    return connection;
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
    const userId = await requireAuth(ctx);
    return await ctx.db.insert("emailConnections", {
      ...args,
      userId: userId as any,
    });
  },
});

export const updateScanStatus = mutation({
  args: {
    id: v.id("emailConnections"),
    lastScanStatus: v.union(
      v.literal("scanning"),
      v.literal("success"),
      v.literal("error")
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
    const userId = await requireAuth(ctx);
    const connection = await ctx.db.get(args.id);
    if (!connection || connection.userId !== userId) throw new Error("Not found");

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
        .withIndex("by_userId", (idx) => idx.eq("userId", userId as any))
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
    const userId = await requireAuth(ctx);
    const connection = await ctx.db.get(args.id);
    if (!connection || connection.userId !== userId) return { emailCount: 0, policyCount: 0 };

    const emails = await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (idx) =>
        idx.eq("connectionId", args.id)
      )
      .collect();
    const emailIds = new Set(emails.map((e) => e._id));

    const allPolicies = await ctx.db
      .query("policies")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId as any))
      .collect();
    const linked = allPolicies.filter(
      (p) => p.emailId && emailIds.has(p.emailId) && p.extractionStatus === "complete"
    );

    return { emailCount: emails.length, policyCount: linked.length };
  },
});
