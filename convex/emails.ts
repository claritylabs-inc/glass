import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

export const dateCoverage = query({
  args: { connectionId: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { dates: [] as string[], earliest: null, latest: null, total: 0 };
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (q) =>
        q.eq("connectionId", args.connectionId)
      )
      .collect();

    // Collect unique dates (YYYY-MM-DD)
    const dateSet = new Set<string>();
    for (const e of emails) {
      try {
        const d = new Date(e.date);
        if (!isNaN(d.getTime())) {
          dateSet.add(d.toISOString().split("T")[0]);
        }
      } catch { /* skip */ }
    }

    const sorted = [...dateSet].sort();
    return {
      dates: sorted,
      earliest: sorted[0] ?? null,
      latest: sorted[sorted.length - 1] ?? null,
      total: emails.length,
    };
  },
});

export const count = query({
  args: { connectionId: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return 0;
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (q) =>
        q.eq("connectionId", args.connectionId)
      )
      .collect();
    return emails.length;
  },
});

export const listPaginated = query({
  args: {
    connectionId: v.id("emailConnections"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { page: [], isDone: true, continueCursor: "" };
    return await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (q) =>
        q.eq("connectionId", args.connectionId)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

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

export const bulkReclassify = mutation({
  args: {
    ids: v.array(v.id("emails")),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx) as any;
    if (!orgId) throw new Error("Not authenticated");

    // Reset all emails
    for (const id of args.ids) {
      const email = await ctx.db.get(id);
      if (!email || email.orgId !== orgId) continue;
      await ctx.db.patch(id, {
        processed: false,
        isInsuranceRelated: undefined,
        classificationReason: undefined,
        classificationConfidence: undefined,
        intelligenceStatus: undefined,
      });
    }

    // Get the connection from the first email to schedule classification
    const first = await ctx.db.get(args.ids[0]);
    if (first?.connectionId) {
      await ctx.scheduler.runAfter(0, internal.actions.classifyEmails.classifyEmails, {
        connectionId: first.connectionId,
        userId: userId,
        orgId: orgId,
      });
    }
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

export const updateIntelligenceStatus = internalMutation({
  args: {
    id: v.id("emails"),
    intelligenceStatus: v.union(
      v.literal("pending"),
      v.literal("skipped"),
      v.literal("extracted"),
      v.literal("error")
    ),
    intelligenceExtractedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});
