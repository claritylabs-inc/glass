import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export const list = query({
  args: { connectionId: v.optional(v.id("emailConnections")) },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    if (args.connectionId) {
      const all = await ctx.db
        .query("emails")
        .withIndex("by_connection_processed", (q) =>
          q.eq("connectionId", args.connectionId!)
        )
        .collect();
      return all.filter((e) => e.userId === userId);
    }
    return await ctx.db
      .query("emails")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId as any))
      .collect();
  },
});

export const getInsuranceEmails = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId as any))
      .collect();
    return emails.filter((e) => e.isInsuranceRelated === true);
  },
});

export const insert = mutation({
  args: {
    userId: v.optional(v.id("users")),
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
