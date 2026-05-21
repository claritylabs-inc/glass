import dayjs from "dayjs";
import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";
import { requireBrokerAccessToClient } from "./lib/access";
import { buildImessageGroupMemberTitle } from "./lib/imessageGroupResolution";

// Note: mutations/queries don't have process.env
// The domain is stored on the org via setAgentDomain action, or passed by the client
const FALLBACK_AGENT_DOMAIN = "glass.insure";
const EMAIL_MODE_VALIDATOR = v.union(
  v.literal("direct"),
  v.literal("cc"),
  v.literal("forward"),
  v.literal("unknown"),
);
const IMESSAGE_GROUP_TITLE_PREFIX = "iMessage group - ";
const IMESSAGE_DIRECT_TITLE_PREFIX = "iMessage - ";

/** Generate a short alphanumeric ID for thread email addresses */
function shortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function formatImessageThreadTitle(args: { isGroup: boolean; displayName: string }): string {
  return args.isGroup
    ? `${IMESSAGE_GROUP_TITLE_PREFIX}${args.displayName}`
    : `${IMESSAGE_DIRECT_TITLE_PREFIX}${args.displayName}`;
}

async function deriveImessageGroupDisplayTitle(
  ctx: QueryCtx,
  thread: Doc<"threads">,
): Promise<string | undefined> {
  if (!thread.imessageIsGroup || !thread.imessageChatGuid) return undefined;
  if (!thread.title.startsWith(IMESSAGE_GROUP_TITLE_PREFIX)) return undefined;

  const participants = await ctx.db
    .query("imessageParticipants")
    .withIndex("by_chatGuid", (q) => q.eq("chatGuid", thread.imessageChatGuid!))
    .collect();
  if (participants.length === 0) return undefined;

  const users = await Promise.all(
    participants.map((participant) =>
      participant.userId ? ctx.db.get(participant.userId) : Promise.resolve(null),
    ),
  );
  const memberTitle = buildImessageGroupMemberTitle(
    participants.map((participant, index) => ({
      address: participant.address,
      displayName: participant.displayName,
      userName: users[index]?.name,
    })),
  );

  return memberTitle ? `${IMESSAGE_GROUP_TITLE_PREFIX}${memberTitle}` : undefined;
}

async function withImessageGroupDisplayTitle(
  ctx: QueryCtx,
  thread: Doc<"threads">,
): Promise<Doc<"threads">> {
  const title = await deriveImessageGroupDisplayTitle(ctx, thread);
  return title ? { ...thread, title } : thread;
}

async function withImessageGroupDisplayTitles(
  ctx: QueryCtx,
  threads: Array<Doc<"threads">>,
): Promise<Array<Doc<"threads">>> {
  return await Promise.all(threads.map((thread) => withImessageGroupDisplayTitle(ctx, thread)));
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
      return await withImessageGroupDisplayTitles(ctx, all.filter((t) => !!t.archivedAt));
    }
    return await withImessageGroupDisplayTitles(ctx, all.filter((t) => !t.archivedAt));
  },
});

export const get = query({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.id);
    if (!thread || thread.orgId !== orgId) return null;
    return await withImessageGroupDisplayTitle(ctx, thread);
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
      return await withImessageGroupDisplayTitle(ctx, thread);
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

// ── Broker-scoped read-only queries ──

export const listForClient = query({
  args: {
    clientOrgId: v.id("organizations"),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireBrokerAccessToClient(ctx, args.clientOrgId);
    const all = await ctx.db
      .query("threads")
      .withIndex("by_orgId_lastMessageAt", (q) => q.eq("orgId", args.clientOrgId))
      .order("desc")
      .collect();
    if (args.archived) {
      return await withImessageGroupDisplayTitles(ctx, all.filter((t) => !!t.archivedAt));
    }
    return await withImessageGroupDisplayTitles(ctx, all.filter((t) => !t.archivedAt));
  },
});

export const getForClient = query({
  args: {
    clientOrgId: v.id("organizations"),
    id: v.id("threads"),
  },
  handler: async (ctx, args) => {
    await requireBrokerAccessToClient(ctx, args.clientOrgId);
    const thread = await ctx.db.get(args.id);
    if (!thread || thread.orgId !== args.clientOrgId) return null;
    return await withImessageGroupDisplayTitle(ctx, thread);
  },
});

export const messagesForClient = query({
  args: {
    clientOrgId: v.id("organizations"),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    await requireBrokerAccessToClient(ctx, args.clientOrgId);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== args.clientOrgId) return [];
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
    clientMutationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    if (args.clientMutationId) {
      const existing = await ctx.db
        .query("threads")
        .withIndex("by_orgId_clientMutationId", (q) =>
          q.eq("orgId", orgId).eq("clientMutationId", args.clientMutationId),
        )
        .first();
      if (existing) return existing._id;
    }
    const now = dayjs().valueOf();
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
      clientMutationId: args.clientMutationId,
      lastMessageAt: now,
      initialContext: args.initialContext,
      threadEmail,
      originChannel: "chat",
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

export const getAttachmentUrl = query({
  args: { threadId: v.optional(v.id("threads")), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    // Backwards compatibility for the currently deployed frontend, which calls this
    // query with only fileId. The thread-scoped path below should be preferred once
    // the Next.js bundle containing threadId is deployed.
    if (!args.threadId) {
      return await ctx.storage.getUrl(args.fileId);
    }
    const threadId = args.threadId;
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.orgId !== orgId) return null;
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .collect();
    const isThreadAttachment = messages.some((message) =>
      message.orgId === orgId &&
      (message.attachments ?? []).some((attachment) => attachment.fileId === args.fileId),
    );
    if (!isThreadAttachment) return null;
    return await ctx.storage.getUrl(args.fileId);
  },
});

export const getAttachmentUrls = query({
  args: { threadId: v.id("threads"), fileIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== orgId) return [];
    const requested = new Set(args.fileIds);
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    const allowed = new Set<string>();
    for (const message of messages) {
      if (message.orgId !== orgId) continue;
      for (const attachment of message.attachments ?? []) {
        if (attachment.fileId && requested.has(attachment.fileId)) {
          allowed.add(attachment.fileId);
        }
      }
    }
    const entries = await Promise.all(
      args.fileIds.map(async (fileId) => {
        if (!allowed.has(fileId)) return null;
        const url = await ctx.storage.getUrl(fileId);
        return url ? { fileId, url } : null;
      }),
    );
    return entries.filter((entry) => entry !== null);
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
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
    referencedRequirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    referencedMailboxIds: v.optional(v.array(v.id("connectedEmailAccounts"))),
    skipAgentResponse: v.optional(v.boolean()),
    clientMutationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== orgId) throw new Error("Not found");

    if (args.clientMutationId) {
      const existing = await ctx.db
        .query("threadMessages")
        .withIndex("by_orgId_clientMutationId", (q) =>
          q.eq("orgId", orgId).eq("clientMutationId", args.clientMutationId),
        )
        .first();
      if (existing && existing.threadId === args.threadId && existing.role === "user") {
        return existing._id;
      }
    }

    const user = await ctx.db.get(userId);
    const userName = user?.name ?? user?.email ?? "User";
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    for (const message of messages) {
      if (
        message.orgId !== orgId ||
        message.role !== "agent" ||
        message.status !== "processing"
      ) {
        continue;
      }
      await ctx.db.patch(message._id, {
        content: "Response cancelled.",
        reasoning: undefined,
        status: "cancelled",
      });
    }

    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId,
      clientMutationId: args.clientMutationId,
      channel: "chat",
      role: "user",
      userId,
      userName,
      content: args.content,
      attachments: args.attachments,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedQuoteIds: args.referencedQuoteIds,
      referencedRequirementIds: args.referencedRequirementIds,
      referencedMailboxIds: args.referencedMailboxIds,
    });

    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });

    const agentMessageId = args.skipAgentResponse
      ? undefined
      : await ctx.db.insert("threadMessages", {
          threadId: args.threadId,
          orgId,
          channel: "chat",
          role: "agent",
          content: "",
          status: "processing",
          replyToMessageId: messageId,
        });

    if (
      thread.originChannel === "imessage" &&
      (thread.imessageChatGuid || thread.threadPhone)
    ) {
      await ctx.scheduler.runAfter(0, internal.actions.mirrorWebChatToImessage.run, {
        threadId: args.threadId,
        messageId,
      });
    }

    // Schedule agent response (skip when streaming API route handles it)
    if (!args.skipAgentResponse) {
      await ctx.scheduler.runAfter(0, internal.actions.processThreadChat.run, {
        threadId: args.threadId,
        orgId,
        userId,
        userMessageId: messageId,
        agentMessageId,
      });
    }

    // Auto-generate a title from the first user message — runs independently
    // of the agent response so streaming failures don't prevent renaming.
    if (thread.title === "New chat") {
      await ctx.scheduler.runAfter(0, internal.actions.threadTitle.generate, {
        threadId: args.threadId,
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
    await ctx.db.patch(args.id, { archivedAt: dayjs().valueOf() });
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
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
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
    await ctx.db.patch(msg.threadId, { lastMessageAt: dayjs().valueOf() });
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
    await ctx.db.patch(args.messageId, {
      content: "Response cancelled.",
      reasoning: undefined,
      status: "cancelled",
    });
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
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    replyToMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
      replyToMessageId: args.replyToMessageId,
    });
  },
});

export const claimAgentResponse = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userMessageId: v.id("threadMessages"),
    agentMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    if (args.agentMessageId) {
      const agentMessage = await ctx.db.get(args.agentMessageId);
      if (
        !agentMessage ||
        agentMessage.threadId !== args.threadId ||
        agentMessage.orgId !== args.orgId ||
        agentMessage.role !== "agent" ||
        agentMessage.replyToMessageId !== args.userMessageId
      ) {
        return { messageId: args.agentMessageId, claimed: false };
      }
      if (agentMessage.agentRunStartedAt) {
        return { messageId: agentMessage._id, claimed: false };
      }
      await ctx.db.patch(agentMessage._id, { agentRunStartedAt: now });
      return { messageId: agentMessage._id, claimed: true };
    }

    const existing = await ctx.db
      .query("threadMessages")
      .withIndex("by_replyToMessageId", (q) => q.eq("replyToMessageId", args.userMessageId))
      .first();
    if (existing) {
      if (existing.agentRunStartedAt) {
        return { messageId: existing._id, claimed: false };
      }
      await ctx.db.patch(existing._id, { agentRunStartedAt: now });
      return { messageId: existing._id, claimed: true };
    }

    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
      replyToMessageId: args.userMessageId,
      agentRunStartedAt: now,
    });
    return { messageId, claimed: true };
  },
});

export const updateAgentMessage = internalMutation({
  args: {
    id: v.id("threadMessages"),
    content: v.string(),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
    citedSections: v.optional(v.array(v.string())),
    citedCoverageNames: v.optional(v.array(v.string())),
    citedSourceSpanIds: v.optional(v.array(v.string())),
    usedTools: v.optional(v.array(v.string())),
    toolCalls: v.optional(v.array(v.object({
      name: v.string(),
      input: v.optional(v.string()),
      output: v.optional(v.string()),
    }))),
    toolArtifacts: v.optional(v.array(v.object({
      type: v.string(),
      data: v.any(),
    }))),
    attachments: v.optional(v.array(v.object({
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      fileId: v.optional(v.id("_storage")),
    }))),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    status: v.optional(v.union(
      v.literal("pending_send"),
      v.literal("processing"),
      v.literal("error"),
      v.literal("draft_email"),
      v.literal("cancelled"),
    )),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing?.status === "cancelled") return;
    await ctx.db.patch(args.id, {
      content: args.content,
      status: args.status ?? undefined,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedQuoteIds: args.referencedQuoteIds,
      citedSections: args.citedSections,
      citedCoverageNames: args.citedCoverageNames,
      citedSourceSpanIds: args.citedSourceSpanIds,
      usedTools: args.usedTools,
      toolCalls: args.toolCalls,
      toolArtifacts: args.toolArtifacts,
      attachments: args.attachments,
      pendingEmailId: args.pendingEmailId,
      policyChangeCaseId: args.policyChangeCaseId,
    });
  },
});

export const attachPendingEmailToAgentMessage = internalMutation({
  args: {
    id: v.id("threadMessages"),
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      pendingEmailId: args.pendingEmailId,
    });
  },
});

export const insertAttachmentMessageInternal = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    content: v.string(),
    attachments: v.array(v.object({
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      fileId: v.id("_storage"),
    })),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== args.orgId) {
      throw new Error("Thread not found");
    }
    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      content: args.content,
      attachments: args.attachments,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
    return messageId;
  },
});

export const listThreadAttachmentsInternal = internalQuery({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    excludeEmailArtifacts: v.optional(v.boolean()),
    excludeAgentCoiAttachments: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    return messages
      .filter((message) => {
        if (message.orgId !== args.orgId) return false;
        if (args.excludeEmailArtifacts && message.channel === "email") {
          return false;
        }
        return true;
      })
      .flatMap((message) =>
        (message.attachments ?? [])
          .filter((attachment) => attachment.fileId)
          .filter(
            (attachment) =>
              !(
                args.excludeAgentCoiAttachments &&
                message.role === "agent" &&
                /\b(coi|certificate[-_\s]?of[-_\s]?insurance)\b/i.test(
                  attachment.filename,
                )
              ),
          )
          .map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            fileId: attachment.fileId!,
          })),
      );
  },
});

export const deleteMessageInternal = internalMutation({
  args: { id: v.id("threadMessages") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/** Update agent message content while still streaming (keeps status as "processing") */
export const streamAgentMessage = internalMutation({
  args: { id: v.id("threadMessages"), content: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing?.status === "cancelled") return;
    await ctx.db.patch(args.id, { content: args.content });
  },
});

export const streamAgentProgress = internalMutation({
  args: {
    id: v.id("threadMessages"),
    content: v.optional(v.string()),
    usedTools: v.optional(v.array(v.string())),
    toolCalls: v.optional(v.array(v.object({
      name: v.string(),
      input: v.optional(v.string()),
      output: v.optional(v.string()),
    }))),
    toolArtifacts: v.optional(v.array(v.object({
      type: v.string(),
      data: v.any(),
    }))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing?.status === "cancelled") return;
    const patch: Record<string, unknown> = {};
    if (args.content !== undefined) patch.content = args.content;
    if (args.usedTools !== undefined) patch.usedTools = args.usedTools;
    if (args.toolCalls !== undefined) patch.toolCalls = args.toolCalls;
    if (args.toolArtifacts !== undefined) patch.toolArtifacts = args.toolArtifacts;
    await ctx.db.patch(args.id, patch);
  },
});

/** Update agent reasoning while streaming (for models that support reasoning) */
export const streamReasoning = internalMutation({
  args: { id: v.id("threadMessages"), reasoning: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing?.status === "cancelled") return;
    await ctx.db.patch(args.id, { reasoning: args.reasoning });
  },
});

export const updateAgentError = internalMutation({
  args: { id: v.id("threadMessages"), error: v.string(), content: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing?.status === "cancelled") return;
    await ctx.db.patch(args.id, {
      status: "error",
      error: args.error,
      ...(args.content !== undefined ? { content: args.content } : {}),
    });
  },
});

export const touchThread = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
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
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_orgId_lastMessageAt", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(50);
    return await withImessageGroupDisplayTitles(ctx, threads);
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
      lastMessageAt: dayjs().valueOf(),
      originChannel: "chat",
    });
  },
});

export const createProactiveInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const threadId = await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: args.title,
      createdBy: args.userId,
      lastMessageAt: now,
      originChannel: "chat",
    });
    const messageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      content: args.content,
    });
    return { threadId, messageId };
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
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
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

// ── Inbound email / iMessage routing helpers ──

export const findOrCreateByPhone = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    fromPhone: v.string(),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("threads")
      .withIndex("by_orgId_threadPhone", (q) =>
        q.eq("orgId", args.orgId).eq("threadPhone", args.fromPhone)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { lastMessageAt: dayjs().valueOf() });
      return existing._id;
    }
    const displayName = args.userName ?? args.fromPhone;
    return await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: `iMessage - ${displayName}`,
      createdBy: args.userId,
      lastMessageAt: dayjs().valueOf(),
      threadPhone: args.fromPhone,
      originChannel: "imessage",
    });
  },
});

export const findOrCreateByImessageChat = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    chatGuid: v.string(),
    isGroup: v.boolean(),
    scope: v.union(v.literal("single_org"), v.literal("multi_org")),
    title: v.optional(v.string()),
    fallbackPhone: v.optional(v.string()),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingThreads = await ctx.db
      .query("threads")
      .withIndex("by_orgId_imessageChatGuid", (q) =>
        q.eq("orgId", args.orgId).eq("imessageChatGuid", args.chatGuid),
      )
      .collect();
    const existing = existingThreads.find(
      (thread) => (thread.imessageIsGroup ?? false) === args.isGroup,
    );
    if (existing) {
      const displayName = args.title ?? args.userName ?? args.fallbackPhone ?? "Group chat";
      const nextTitle = formatImessageThreadTitle({ isGroup: args.isGroup, displayName });
      await ctx.db.patch(existing._id, {
        lastMessageAt: dayjs().valueOf(),
        imessageIsGroup: args.isGroup,
        imessageScope: args.scope,
        threadPhone: existing.threadPhone ?? args.fallbackPhone,
        ...(args.isGroup && existing.title.startsWith(IMESSAGE_GROUP_TITLE_PREFIX)
          ? { title: nextTitle }
          : {}),
      });
      return existing._id;
    }

    const displayName = args.title ?? args.userName ?? args.fallbackPhone ?? "Group chat";
    return await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: formatImessageThreadTitle({ isGroup: args.isGroup, displayName }),
      createdBy: args.userId,
      lastMessageAt: dayjs().valueOf(),
      threadPhone: args.fallbackPhone,
      imessageChatGuid: args.chatGuid,
      imessageIsGroup: args.isGroup,
      imessageScope: args.scope,
      originChannel: "imessage",
    });
  },
});

export const insertImessageMessage = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    role: v.union(v.literal("user"), v.literal("agent")),
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    imessageSenderAddress: v.optional(v.string()),
    imessageParticipantLabel: v.optional(v.string()),
    content: v.string(),
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
    toolArtifacts: v.optional(v.array(v.object({
      type: v.string(),
      data: v.any(),
    }))),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    status: v.optional(v.union(v.literal("processing"), v.literal("error"))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "imessage",
      role: args.role,
      userId: args.userId,
      userName: args.userName,
      imessageSenderAddress: args.imessageSenderAddress,
      imessageParticipantLabel: args.imessageParticipantLabel,
      content: args.content,
      messageId: args.messageId,
      responseMessageId: args.responseMessageId,
      attachments: args.attachments,
      toolArtifacts: args.toolArtifacts,
      referencedPolicyIds: args.referencedPolicyIds,
      pendingEmailId: args.pendingEmailId,
      status: args.status,
      error: args.error,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
    return messageId;
  },
});

export const getImessageHistory = internalQuery({
  args: { threadId: v.id("threads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(args.limit ?? 20);
    return messages.reverse();
  },
});

export const findOrCreateForEmail = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    subject: v.string(),
    existingThreadId: v.optional(v.id("threads")),
    mode: v.optional(EMAIL_MODE_VALIDATOR),
    agentDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.existingThreadId) {
      const existing = await ctx.db.get(args.existingThreadId);
      if (existing && existing.orgId === args.orgId) {
        await ctx.db.patch(existing._id, {
          lastMessageAt: dayjs().valueOf(),
          emailMode: existing.emailMode ?? args.mode,
          originChannel: existing.originChannel ?? "email",
        });
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
      lastMessageAt: dayjs().valueOf(),
      threadEmail,
      originChannel: "email",
      emailMode: args.mode,
    });

    return threadId;
  },
});

function normalizeMessageId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}

export const checkDuplicateEmail = internalQuery({
  args: {
    resendEmailId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.resendEmailId) {
      const byResend = await ctx.db
        .query("threadMessages")
        .withIndex("by_resendEmailId", (q) => q.eq("resendEmailId", args.resendEmailId))
        .first();
      if (byResend) return true;
    }
    if (args.messageId) {
      const byMessage = await ctx.db
        .query("threadMessages")
        .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
        .first();
      if (byMessage) return true;
      const normalized = normalizeMessageId(args.messageId);
      if (normalized !== args.messageId) {
        const byNormalized = await ctx.db
          .query("threadMessages")
          .withIndex("by_messageId", (q) => q.eq("messageId", normalized))
          .first();
        if (byNormalized) return true;
      }
    }
    return false;
  },
});

export const findThreadByEmailMessageId = internalQuery({
  args: {
    orgId: v.id("organizations"),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const candidates = [args.messageId, normalizeMessageId(args.messageId)];
    for (const candidate of [...new Set(candidates)]) {
      const inbound = await ctx.db
        .query("threadMessages")
        .withIndex("by_messageId", (q) => q.eq("messageId", candidate))
        .first();
      if (inbound && inbound.orgId === args.orgId) {
        return await ctx.db.get(inbound.threadId);
      }

      const outbound = await ctx.db
        .query("threadMessages")
        .withIndex("by_responseMessageId", (q) => q.eq("responseMessageId", candidate))
        .first();
      if (outbound && outbound.orgId === args.orgId) {
        return await ctx.db.get(outbound.threadId);
      }
    }
    return null;
  },
});

export const findEmailThreadBySubject = internalQuery({
  args: {
    orgId: v.id("organizations"),
    subject: v.string(),
    fromEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const baseSubject = args.subject
      .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "")
      .trim()
      .toLowerCase();
    if (!baseSubject) return null;

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_orgId_lastMessageAt", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(100);

    for (const thread of threads) {
      const threadBaseSubject = thread.title
        .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "")
        .trim()
        .toLowerCase();
      if (threadBaseSubject !== baseSubject) continue;

      const messages = await ctx.db
        .query("threadMessages")
        .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
        .take(20);
      if (messages.some((message) => message.fromEmail === args.fromEmail)) {
        return thread;
      }
    }

    return threads.find((thread) =>
      thread.title.replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "").trim().toLowerCase() === baseSubject
    ) ?? null;
  },
});

export const getEmailHistory = internalQuery({
  args: {
    threadId: v.id("threads"),
    excludeMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    return messages
      .filter((message) => message.channel === "email" && message._id !== args.excludeMessageId)
      .sort((a, b) => a._creationTime - b._creationTime);
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
    bccAddresses: v.optional(v.array(v.string())),
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
    toolArtifacts: v.optional(v.array(v.object({
      type: v.string(),
      data: v.any(),
    }))),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
    resendEmailId: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("processing"),
      v.literal("error"),
      v.literal("pending_send"),
      v.literal("draft_email"),
      v.literal("cancelled"),
    )),
    error: v.optional(v.string()),
    pendingEmailId: v.optional(v.id("pendingEmails")),
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
      bccAddresses: args.bccAddresses,
      subject: args.subject,
      content: args.content,
      contentHtml: args.contentHtml,
      messageId: args.messageId,
      responseMessageId: args.responseMessageId,
      resendEmailId: args.resendEmailId,
      attachments: args.attachments,
      toolArtifacts: args.toolArtifacts,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedQuoteIds: args.referencedQuoteIds,
      status: args.status,
      error: args.error,
      pendingEmailId: args.pendingEmailId,
    });

    // Update the thread's lastMessageAt
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });

    return messageDocId;
  },
});

export const updateEmailMessage = internalMutation({
  args: {
    id: v.id("threadMessages"),
    content: v.optional(v.string()),
    toAddresses: v.optional(v.array(v.string())),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    attachments: v.optional(v.array(v.object({
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      fileId: v.optional(v.id("_storage")),
    }))),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    status: v.optional(v.union(v.literal("draft_email"), v.literal("cancelled"))),
    clearStatus: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, clearStatus, ...patch } = args;
    await ctx.db.patch(id, patch);
    if (clearStatus) {
      await ctx.db.patch(id, { status: undefined });
    }
  },
});
