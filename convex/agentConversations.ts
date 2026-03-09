import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export const checkDuplicate = internalQuery({
  args: { resendEmailId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentConversations")
      .withIndex("by_resendEmailId", (q) => q.eq("resendEmailId", args.resendEmailId))
      .first();
    return !!existing;
  },
});

export const insertInbound = internalMutation({
  args: {
    userId: v.id("users"),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toAddresses: v.array(v.string()),
    ccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    bodyHtml: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    messageId: v.optional(v.string()),
    mode: v.union(v.literal("direct"), v.literal("cc"), v.literal("forward"), v.literal("unknown")),
    resendEmailId: v.optional(v.string()),
    threadId: v.optional(v.id("agentConversations")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentConversations", {
      ...args,
      status: "received",
    });
  },
});

export const markProcessing = internalMutation({
  args: { id: v.id("agentConversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "processing" });
  },
});

export const updateResponse = internalMutation({
  args: {
    id: v.id("agentConversations"),
    responseBody: v.string(),
    responseHtml: v.optional(v.string()),
    responseTo: v.optional(v.string()),
    responseCc: v.optional(v.array(v.string())),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    responseMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, {
      ...fields,
      status: "replied",
      responseSentAt: Date.now(),
    });
  },
});

export const updateError = internalMutation({
  args: {
    id: v.id("agentConversations"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "error", error: args.error });
  },
});

/**
 * Normalize a Message-ID for comparison.
 * Gmail In-Reply-To might be "<re_abc123@resend.dev>" while we store "re_abc123".
 * Strip angle brackets, and extract the local part before @ for fuzzy matching.
 */
function normalizeMessageId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}

function messageIdsMatch(stored: string | undefined, lookup: string): boolean {
  if (!stored) return false;
  const normalizedStored = normalizeMessageId(stored);
  const normalizedLookup = normalizeMessageId(lookup);
  // Exact match after normalization
  if (normalizedStored === normalizedLookup) return true;
  // Check if one contains the other (e.g. "re_abc123" vs "re_abc123@resend.dev")
  if (normalizedLookup.startsWith(normalizedStored) || normalizedStored.startsWith(normalizedLookup)) return true;
  return false;
}

export const getById = internalQuery({
  args: { id: v.id("agentConversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const findByMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizeMessageId(args.messageId);

    // Check if any conversation has this as its messageId (inbound)
    // Try exact index match first
    const byInbound = await ctx.db
      .query("agentConversations")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    if (byInbound) return byInbound;

    // Try normalized index match (without angle brackets)
    if (normalized !== args.messageId) {
      const byNormalized = await ctx.db
        .query("agentConversations")
        .withIndex("by_messageId", (q) => q.eq("messageId", normalized))
        .first();
      if (byNormalized) return byNormalized;
    }

    // Check responseMessageId (outbound) with fuzzy matching
    // Resend returns IDs like "re_abc123", but In-Reply-To may be "<re_abc123@resend.dev>"
    const all = await ctx.db.query("agentConversations").collect();
    return all.find((c) => messageIdsMatch(c.responseMessageId, args.messageId)) ?? null;
  },
});

/**
 * Fallback thread matching by subject line.
 * Strips "Re:", "Fwd:", etc. prefixes and finds the most recent conversation
 * from the same user with a matching base subject.
 */
export const findThreadBySubject = internalQuery({
  args: {
    userId: v.id("users"),
    subject: v.string(),
    fromEmail: v.string(),
  },
  handler: async (ctx, args) => {
    // Normalize subject: strip Re:/Fwd:/Fw: prefixes (possibly repeated)
    const baseSubject = args.subject
      .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "")
      .trim()
      .toLowerCase();

    if (!baseSubject) return null;

    // Get recent conversations for this user
    const convs = await ctx.db
      .query("agentConversations")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(100);

    // Find a match by normalized subject from the same sender
    for (const conv of convs) {
      const convBaseSubject = conv.subject
        .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "")
        .trim()
        .toLowerCase();

      if (convBaseSubject === baseSubject && conv.fromEmail === args.fromEmail) {
        return conv;
      }
    }

    // Also match if subjects match but sender differs (e.g. agent replied, user follows up)
    for (const conv of convs) {
      const convBaseSubject = conv.subject
        .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "")
        .trim()
        .toLowerCase();

      if (convBaseSubject === baseSubject) {
        return conv;
      }
    }

    return null;
  },
});

export const getUserByHandle = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", args.handle))
      .first();
  },
});

export const getThreadMessages = internalQuery({
  args: { threadId: v.id("agentConversations") },
  handler: async (ctx, args) => {
    // Get all messages in this thread (including the root)
    const threadMessages = await ctx.db
      .query("agentConversations")
      .collect();
    const inThread = threadMessages.filter(
      (c) => c._id === args.threadId || c.threadId === args.threadId,
    );
    return inThread.sort((a, b) => a._creationTime - b._creationTime);
  },
});

export const list = query({
  args: { archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const all = await ctx.db
      .query("agentConversations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    if (args.archived) {
      return all.filter((c) => !!c.archivedAt);
    }
    return all.filter((c) => !c.archivedAt);
  },
});

export const get = query({
  args: { id: v.id("agentConversations") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== userId) return null;
    return conv;
  },
});

export const archive = mutation({
  args: { id: v.id("agentConversations") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { archivedAt: Date.now() });
  },
});

export const unarchive = mutation({
  args: { id: v.id("agentConversations") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { archivedAt: undefined });
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const all = await ctx.db
      .query("agentConversations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const active = all.filter((c) => !c.archivedAt);
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = active.filter((c) => c._creationTime > oneWeekAgo).length;
    return { total: active.length, recent };
  },
});
