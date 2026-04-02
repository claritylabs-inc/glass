import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

export const list = query({
  args: { connectionId: v.optional(v.id("emailConnections")) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    if (args.connectionId) {
      const all = await ctx.db
        .query("emails")
        .withIndex("by_connection_processed", (q) =>
          q.eq("connectionId", args.connectionId!)
        )
        .collect();
      return all.filter((e) => (e as any).orgId === orgId);
    }
    return await ctx.db
      .query("emails")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
  },
});

export const getInsuranceEmails = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return emails.filter((e) => e.isInsuranceRelated === true);
  },
});

export const insert = mutation({
  args: {
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    connectionId: v.id("emailConnections"),
    messageId: v.string(),
    uid: v.optional(v.number()),
    subject: v.string(),
    from: v.string(),
    date: v.string(),
    hasAttachments: v.boolean(),
    processed: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Dedup by messageId
    const existing = await ctx.db
      .query("emails")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("emails", args);
  },
});

export const markClassified = mutation({
  args: {
    id: v.id("emails"),
    isInsuranceRelated: v.boolean(),
    classificationReason: v.optional(v.string()),
    classificationConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const markProcessed = mutation({
  args: { id: v.id("emails") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { processed: true });
  },
});

export const updateClassification = mutation({
  args: {
    id: v.id("emails"),
    isInsuranceRelated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const email = await ctx.db.get(args.id);
    if (!email || email.orgId !== orgId) {
      throw new Error("Email not found");
    }
    await ctx.db.patch(args.id, {
      isInsuranceRelated: args.isInsuranceRelated,
      classificationReason: "Manual override",
      classificationConfidence: 1.0,
    });
  },
});

export const resetProcessed = mutation({
  args: { id: v.id("emails") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const email = await ctx.db.get(args.id);
    if (!email || email.orgId !== orgId) {
      throw new Error("Email not found");
    }
    await ctx.db.patch(args.id, {
      processed: false,
      isInsuranceRelated: undefined,
      classificationReason: undefined,
      classificationConfidence: undefined,
    });
  },
});

export const triggerExtraction = mutation({
  args: { id: v.id("emails") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const email = await ctx.db.get(args.id);
    if (!email || email.orgId !== orgId) {
      throw new Error("Email not found");
    }
    if (!email.hasAttachments) {
      throw new Error("Email has no attachments");
    }
    await ctx.scheduler.runAfter(0, internal.actions.extractPolicy.extractPolicy, {
      emailId: args.id,
      connectionId: email.connectionId,
      userId,
      orgId,
    });
    await ctx.db.patch(args.id, { processed: true });
  },
});

// Internal queries for use by scheduled actions (no auth context)
export const listByConnection = internalQuery({
  args: { connectionId: v.id("emailConnections") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (q) =>
        q.eq("connectionId", args.connectionId)
      )
      .collect();
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("emails") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
