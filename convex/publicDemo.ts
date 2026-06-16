import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const channelValidator = v.union(v.literal("email"), v.literal("imessage"));
const stageValidator = v.union(
  v.literal("new"),
  v.literal("engaged"),
  v.literal("qualified"),
  v.literal("booking_intent"),
  v.literal("cta_sent"),
  v.literal("signup_intent"),
  v.literal("not_fit"),
  v.literal("rate_limited"),
);
const ctaStatusValidator = v.union(
  v.literal("not_shown"),
  v.literal("asked_for_email"),
  v.literal("cal_link_sent"),
  v.literal("signup_link_sent"),
);
const directionValidator = v.union(
  v.literal("inbound"),
  v.literal("outbound"),
  v.literal("system"),
);

const PUBLIC_DEMO_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_DEMO_BURST_LIMIT = 30;
const PUBLIC_DEMO_MIN_MS_BETWEEN_MESSAGES = 750;

export const checkRateLimit = internalMutation({
  args: { rateKey: v.string() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const counter = await ctx.db
      .query("publicDemoRateCounters")
      .withIndex("by_rateKey", (q) => q.eq("rateKey", args.rateKey))
      .first();

    if (!counter || now - counter.windowStart > PUBLIC_DEMO_WINDOW_MS) {
      if (counter) await ctx.db.delete(counter._id);
      await ctx.db.insert("publicDemoRateCounters", {
        rateKey: args.rateKey,
        windowStart: now,
        count: 1,
        lastRequestAt: now,
      });
      return { allowed: true };
    }

    if (now - counter.lastRequestAt < PUBLIC_DEMO_MIN_MS_BETWEEN_MESSAGES) {
      return { allowed: false, reason: "sustained" as const };
    }
    if (counter.count >= PUBLIC_DEMO_BURST_LIMIT) {
      return { allowed: false, reason: "burst" as const };
    }

    await ctx.db.patch(counter._id, {
      count: counter.count + 1,
      lastRequestAt: now,
    });
    return { allowed: true };
  },
});

export const findOrCreateConversation = internalMutation({
  args: {
    channel: channelValidator,
    senderHash: v.string(),
    senderContact: v.optional(v.string()),
    agentAddress: v.optional(v.string()),
    leadEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("publicDemoConversations")
      .withIndex("by_channel_senderHash", (q) =>
        q.eq("channel", args.channel).eq("senderHash", args.senderHash),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        senderContact: args.senderContact ?? existing.senderContact,
        agentAddress: args.agentAddress ?? existing.agentAddress,
        leadEmail: args.leadEmail ?? existing.leadEmail,
        updatedAt: now,
      });
      return (await ctx.db.get(existing._id))!;
    }

    const id = await ctx.db.insert("publicDemoConversations", {
      channel: args.channel,
      senderHash: args.senderHash,
      senderContact: args.senderContact,
      agentAddress: args.agentAddress,
      leadEmail: args.leadEmail,
      stage: "new",
      ctaStatus: "not_shown",
      turnCount: 0,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get(id))!;
  },
});

export const getConversationInternal = internalQuery({
  args: { id: v.id("publicDemoConversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listConversationLogsInternal = internalQuery({
  args: {
    conversationId: v.id("publicDemoConversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("publicDemoChatLogs")
      .withIndex("by_conversationId_createdAt", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(Math.max(1, Math.min(args.limit ?? 20, 100)));
    return logs.reverse();
  },
});

export const appendChatLog = internalMutation({
  args: {
    conversationId: v.id("publicDemoConversations"),
    channel: channelValidator,
    direction: directionValidator,
    subject: v.optional(v.string()),
    content: v.string(),
    contentHtml: v.optional(v.string()),
    modelProvider: v.optional(v.string()),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    ctaUrl: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()),
    deliveryId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const id = await ctx.db.insert("publicDemoChatLogs", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    const conversation = await ctx.db.get(args.conversationId);
    if (conversation) {
      await ctx.db.patch(args.conversationId, {
        lastMessageAt: now,
        turnCount:
          args.direction === "inbound"
            ? conversation.turnCount + 1
            : conversation.turnCount,
        updatedAt: now,
      });
    }
    return id;
  },
});

export const patchChatLogDelivery = internalMutation({
  args: {
    id: v.id("publicDemoChatLogs"),
    deliveryStatus: v.string(),
    deliveryId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      deliveryStatus: args.deliveryStatus,
      deliveryId: args.deliveryId,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const updateConversationLead = internalMutation({
  args: {
    conversationId: v.id("publicDemoConversations"),
    leadName: v.optional(v.string()),
    leadCompany: v.optional(v.string()),
    leadEmail: v.optional(v.string()),
    leadUseCase: v.optional(v.string()),
    stage: v.optional(stageValidator),
    ctaStatus: v.optional(ctaStatusValidator),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    const now = dayjs().valueOf();
    await ctx.db.patch(args.conversationId, {
      leadName: args.leadName ?? conversation.leadName,
      leadCompany: args.leadCompany ?? conversation.leadCompany,
      leadEmail: args.leadEmail ?? conversation.leadEmail,
      leadUseCase: args.leadUseCase ?? conversation.leadUseCase,
      stage: args.stage ?? conversation.stage,
      ctaStatus: args.ctaStatus ?? conversation.ctaStatus,
      updatedAt: now,
    });
    return await ctx.db.get(args.conversationId);
  },
});

export const upsertSalesTranscript = internalMutation({
  args: {
    conversationId: v.id("publicDemoConversations"),
    channel: channelValidator,
    senderContact: v.optional(v.string()),
    leadName: v.optional(v.string()),
    leadCompany: v.optional(v.string()),
    leadEmail: v.optional(v.string()),
    leadUseCase: v.optional(v.string()),
    stage: stageValidator,
    ctaStatus: ctaStatusValidator,
    summary: v.string(),
    objections: v.array(v.string()),
    nextStep: v.string(),
    curatedTurns: v.array(
      v.object({
        speaker: v.string(),
        content: v.string(),
        at: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("publicDemoSalesTranscripts")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastUpdatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("publicDemoSalesTranscripts", {
      ...args,
      createdAt: now,
      lastUpdatedAt: now,
    });
  },
});
