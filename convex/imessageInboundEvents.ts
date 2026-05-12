import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const claim = internalMutation({
  args: {
    eventKey: v.string(),
    fromPhone: v.string(),
    chatGuid: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    messageText: v.string(),
    sourceMessageId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageInboundEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", args.eventKey))
      .first();

    if (existing) {
      return {
        duplicate: true,
        status: existing.status,
        response: existing.response,
      };
    }

    const now = Date.now();
    await ctx.db.insert("imessageInboundEvents", {
      eventKey: args.eventKey,
      fromPhone: args.fromPhone,
      chatGuid: args.chatGuid,
      isGroup: args.isGroup,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    });

    return { duplicate: false, status: "processing" as const };
  },
});

export const complete = internalMutation({
  args: {
    eventKey: v.string(),
    response: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageInboundEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", args.eventKey))
      .first();
    if (!existing) return;

    await ctx.db.patch(existing._id, {
      status: "completed",
      response: args.response,
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const fail = internalMutation({
  args: {
    eventKey: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageInboundEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", args.eventKey))
      .first();
    if (!existing) return;

    await ctx.db.patch(existing._id, {
      status: "error",
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});
