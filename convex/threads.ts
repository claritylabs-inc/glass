import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

// Note: mutations/queries don't have process.env
// The domain is stored on the org via setAgentDomain action, or passed by the client
const FALLBACK_AGENT_DOMAIN = "prism.claritylabs.inc";

/** Generate a short alphanumeric ID for thread email addresses */
function shortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ── Public queries/mutations ──

export const list = query({
  args: { archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("threads")
      .withIndex("by_orgId_lastMessageAt", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    if (args.archived) {
      return all.filter((t) => !!t.archivedAt);
    }
    return all.filter((t) => !t.archivedAt);
  },
});

export const get = query({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.id);
    if (!thread || thread.orgId !== orgId) return null;
    return thread;
  },
});

export const tryGet = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    try {
      const normalized = ctx.db.normalizeId("threads", args.id);
      if (!normalized) return null;
      const thread = await ctx.db.get(normalized);
      if (!thread || thread.orgId !== orgId) return null;
      return thread;
    } catch {
      return null;
    }
  },
});

export const messages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== orgId) return [];
    return await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
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
    agentDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const now = Date.now();
    const domain = args.agentDomain || FALLBACK_AGENT_DOMAIN;

    // Look up the org's agent handle to build the thread-specific email
    const org = await ctx.db.get(orgId);
    const handle = org?.agentHandle;
    const threadEmail = handle
      ? `${handle}+${shortId()}@${domain}`
      : undefined;

    return await ctx.db.insert("threads", {
      orgId,
      title: args.title ?? "New chat",
      createdBy: userId,
      lastMessageAt: now,
      initialContext: args.initialContext,
      threadEmail,
    });
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrgAccess(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.id("threads"),
    content: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.id("_storage"),
        })
      )
    ),
    skipAgentResponse: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== orgId) throw new Error("Not found");

    const user = await ctx.db.get(userId);
    const userName = user?.name ?? user?.email ?? "User";

    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId,
      channel: "chat",
      role: "user",
      userId,
      userName,
      content: args.content,
      attachments: args.attachments,
    });

    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });

    // Schedule agent response (skip when streaming API route handles it)
    if (!args.skipAgentResponse) {
      await ctx.scheduler.runAfter(0, internal.actions.processThreadChat.run, {
        threadId: args.threadId,
        orgId,
        userId,
        userMessageId: messageId,
      });
    }

    return messageId;
  },
});

export const archive = mutation({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.id);
    if (!thread || thread.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { archivedAt: Date.now() });
  },
});

export const unarchive = mutation({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.id);
    if (!thread || thread.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { archivedAt: undefined });
  },
});

export const updateTitle = mutation({
  args: { id: v.id("threads"), title: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.id);
    if (!thread || thread.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { title: args.title });
  },
});

// ── Public mutations for streaming API route ──
// These are thin auth-checked wrappers around internal mutations,
// callable via ConvexHttpClient from the Next.js streaming API route.

export const insertProcessingMessage = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== orgId) throw new Error("Not found");
    return await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
    });
  },
});

export const updateAgentResponse = mutation({
  args: {
    messageId: v.id("threadMessages"),
    content: v.string(),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("quotes"))),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.messageId, {
      content: args.content,
      status: undefined,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedQuoteIds: args.referencedQuoteIds,
    });
    await ctx.db.patch(msg.threadId, { lastMessageAt: Date.now() });
  },
});

export const streamContent = mutation({
  args: { messageId: v.id("threadMessages"), content: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.messageId, { content: args.content });
  },
});

export const setMessageError = mutation({
  args: { messageId: v.id("threadMessages"), error: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.messageId, { status: "error", error: args.error });
  },
});

export const cancelProcessing = mutation({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.orgId !== orgId || msg.role !== "agent") throw new Error("Not found");
    if (msg.status !== "processing") return; // already finished
    await ctx.db.delete(args.messageId);
  },
});

export const retryAgentResponse = mutation({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.orgId !== orgId || msg.role !== "agent") throw new Error("Not found");

    // Find the user message that triggered this agent response
    // (the most recent user message before this agent message)
    const threadMessages = await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", msg.threadId))
      .order("asc")
      .collect();
    const msgIndex = threadMessages.findIndex((m) => m._id === args.messageId);
    let userMessageId: typeof msg._id | undefined;
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (threadMessages[i].role === "user") {
        userMessageId = threadMessages[i]._id;
        break;
      }
    }
    if (!userMessageId) throw new Error("No user message found to retry");

    // Delete the failed agent message
    await ctx.db.delete(args.messageId);

    // Re-schedule processThreadChat
    await ctx.scheduler.runAfter(0, internal.actions.processThreadChat.run, {
      threadId: msg.threadId,
      orgId,
      userId,
      userMessageId,
    });
  },
});

// ── Internal (for actions) ──

export const getInternal = internalQuery({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getMessageInternal = internalQuery({
  args: { id: v.id("threadMessages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const messagesInternal = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const insertAgentMessage = internalMutation({
  args: { threadId: v.id("threads"), orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
    });
  },
});

export const updateAgentMessage = internalMutation({
  args: {
    id: v.id("threadMessages"),
    content: v.string(),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("quotes"))),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    status: v.optional(v.union(v.literal("pending_send"), v.literal("processing"), v.literal("error"))),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      content: args.content,
      status: args.status ?? undefined,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedQuoteIds: args.referencedQuoteIds,
      pendingEmailId: args.pendingEmailId,
    });
  },
});

/** Update agent message content while still streaming (keeps status as "processing") */
export const streamAgentMessage = internalMutation({
  args: { id: v.id("threadMessages"), content: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { content: args.content });
  },
});

export const updateAgentError = internalMutation({
  args: { id: v.id("threadMessages"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "error", error: args.error });
  },
});

export const touchThread = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });
  },
});

export const updateTitleInternal = internalMutation({
  args: { threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { title: args.title });
  },
});

export const listByOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_orgId_lastMessageAt", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(50);
  },
});

export const createInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: args.title ?? "New chat",
      createdBy: args.userId,
      lastMessageAt: Date.now(),
    });
  },
});

export const insertUserMessageInternal = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userName: v.optional(v.string()),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "user",
      userId: args.userId,
      userName: args.userName,
      content: args.content,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });
    return messageId;
  },
});

export const findByEmail = internalQuery({
  args: { threadEmail: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_threadEmail", (q) => q.eq("threadEmail", args.threadEmail))
      .first();
  },
});

// ── D3: Inbound email routing helpers ──

export const findByLegacyId = internalQuery({
  args: { legacyConversationId: v.id("agentConversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_legacyConversationId", (q) =>
        q.eq("legacyConversationId", args.legacyConversationId)
      )
      .first();
  },
});

export const findOrCreateForEmail = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    subject: v.string(),
    legacyConversationId: v.optional(v.id("agentConversations")),
    mode: v.optional(v.string()),
    agentDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If we have a legacy conversation ID, try to find an existing thread
    if (args.legacyConversationId) {
      const existing = await ctx.db
        .query("threads")
        .withIndex("by_legacyConversationId", (q) =>
          q.eq("legacyConversationId", args.legacyConversationId)
        )
        .first();
      if (existing) {
        return existing._id;
      }
    }

    const domain = args.agentDomain || FALLBACK_AGENT_DOMAIN;

    // Look up agent handle for thread email
    const org = await ctx.db.get(args.orgId);
    const handle = org?.agentHandle;
    const threadEmail = handle
      ? `${handle}+${shortId()}@${domain}`
      : undefined;

    // Create a new thread
    const threadId = await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: args.subject,
      createdBy: args.userId,
      lastMessageAt: Date.now(),
      legacyConversationId: args.legacyConversationId,
      threadEmail,
    });

    return threadId;
  },
});

export const insertEmailMessage = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    toAddresses: v.optional(v.array(v.string())),
    ccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    content: v.string(),
    contentHtml: v.optional(v.string()),
    messageId: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.optional(v.id("_storage")),
        })
      )
    ),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("quotes"))),
    legacyConversationId: v.optional(v.id("agentConversations")),
  },
  handler: async (ctx, args) => {
    const messageDocId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "email",
      role: args.role,
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      toAddresses: args.toAddresses,
      ccAddresses: args.ccAddresses,
      subject: args.subject,
      content: args.content,
      contentHtml: args.contentHtml,
      messageId: args.messageId,
      responseMessageId: args.responseMessageId,
      attachments: args.attachments,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedQuoteIds: args.referencedQuoteIds,
      legacyConversationId: args.legacyConversationId,
    });

    // Update the thread's lastMessageAt
    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });

    return messageDocId;
  },
});
