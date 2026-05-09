import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

// ── Public queries/mutations (auth-scoped) ──

export const list = query({
  args: { archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("webChats")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    if (args.archived) {
      return all.filter((c) => !!c.archivedAt);
    }
    return all.filter((c) => !c.archivedAt);
  },
});

export const get = query({
  args: { id: v.id("webChats") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const chat = await ctx.db.get(args.id);
    if (!chat || chat.orgId !== orgId) return null;
    return chat;
  },
});

/** Safe lookup by string ID — returns null if the ID isn't a webChats ID. */
export const tryGet = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    try {
      const normalized = ctx.db.normalizeId("webChats", args.id);
      if (!normalized) return null;
      const chat = await ctx.db.get(normalized);
      if (!chat || chat.orgId !== orgId) return null;
      return chat;
    } catch {
      return null;
    }
  },
});

export const messages = query({
  args: { chatId: v.id("webChats") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.orgId !== orgId) return [];
    return await ctx.db
      .query("webChatMessages")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    initialContext: v.optional(v.object({
      pageType: v.string(),
      entityId: v.optional(v.string()),
      summary: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const now = Date.now();
    return await ctx.db.insert("webChats", {
      orgId,
      title: args.title ?? "New chat",
      createdBy: userId,
      lastMessageAt: now,
      initialContext: args.initialContext,
    });
  },
});

export const sendMessage = mutation({
  args: { chatId: v.id("webChats"), content: v.string() },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.orgId !== orgId) throw new Error("Not found");

    const user = await ctx.db.get(userId);
    const userName = user?.name ?? user?.email ?? "User";

    const messageId = await ctx.db.insert("webChatMessages", {
      chatId: args.chatId,
      orgId,
      userId,
      userName,
      role: "user",
      content: args.content,
    });

    await ctx.db.patch(args.chatId, { lastMessageAt: Date.now() });

    // Schedule agent response
    await ctx.scheduler.runAfter(0, internal.actions.processWebChat.run, {
      chatId: args.chatId,
      orgId,
      userId,
      userMessageId: messageId,
    });

    return messageId;
  },
});

export const archive = mutation({
  args: { id: v.id("webChats") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const chat = await ctx.db.get(args.id);
    if (!chat || chat.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { archivedAt: Date.now() });
  },
});

export const unarchive = mutation({
  args: { id: v.id("webChats") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const chat = await ctx.db.get(args.id);
    if (!chat || chat.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { archivedAt: undefined });
  },
});

export const updateTitle = mutation({
  args: { id: v.id("webChats"), title: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const chat = await ctx.db.get(args.id);
    if (!chat || chat.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { title: args.title });
  },
});

// ── Internal (for processWebChat action) ──

export const getInternal = internalQuery({
  args: { id: v.id("webChats") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const messagesInternal = internalQuery({
  args: { chatId: v.id("webChats") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webChatMessages")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .collect();
  },
});

export const getMessageInternal = internalQuery({
  args: { id: v.id("webChatMessages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const insertAgentMessage = internalMutation({
  args: { chatId: v.id("webChats"), orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.insert("webChatMessages", {
      chatId: args.chatId,
      orgId: args.orgId,
      role: "agent",
      content: "",
      status: "processing",
    });
  },
});

export const updateAgentMessage = internalMutation({
  args: {
    id: v.id("webChatMessages"),
    content: v.string(),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      content: args.content,
      status: undefined,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedQuoteIds: args.referencedQuoteIds,
    });
  },
});

/** Update agent message content while still streaming (keeps status as "processing") */
export const streamAgentMessage = internalMutation({
  args: { id: v.id("webChatMessages"), content: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { content: args.content });
  },
});

export const updateAgentError = internalMutation({
  args: { id: v.id("webChatMessages"), error: v.string(), content: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "error",
      error: args.error,
      ...(args.content !== undefined ? { content: args.content } : {}),
    });
  },
});

export const touchChat = internalMutation({
  args: { chatId: v.id("webChats") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chatId, { lastMessageAt: Date.now() });
  },
});

export const updateTitleInternal = internalMutation({
  args: { chatId: v.id("webChats"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chatId, { title: args.title });
  },
});
