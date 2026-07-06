import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** Get a single turn by ID. */
export const get = internalQuery({
  args: { id: v.id("conversationTurns") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

/** List turns for a conversation, ordered by creation time. */
export const listByConversation = internalQuery({
  args: {
    conversationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("conversationTurns")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", args.conversationId))
      .order("desc");
    const turns = await q.take(args.limit ?? 50);
    return turns.reverse(); // oldest first
  },
});

/** Insert a single conversation turn. */
export const insert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    conversationId: v.string(),
    role: v.string(),
    content: v.string(),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    void ctx;
    void args;
    return null;
  },
});
