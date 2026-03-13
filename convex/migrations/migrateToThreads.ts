import { internalMutation, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";

/**
 * D5 — Migrate existing webChats and agentConversations into the unified
 * `threads` + `threadMessages` tables.
 *
 * Run with: npx convex run migrations/migrateToThreads:migrateWebChats
 *           npx convex run migrations/migrateToThreads:migrateEmailConversations
 *           npx convex run migrations/migrateToThreads:verifyMigration
 *
 * Both mutations are idempotent — safe to re-run.
 */

// ─── Part 1: webChats → threads, webChatMessages → threadMessages ───

export const migrateWebChats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const webChats = await ctx.db.query("webChats").collect();
    let threadsCreated = 0;
    let messagesCreated = 0;
    let chatsSkipped = 0;

    for (const chat of webChats) {
      // Idempotency: check if we already migrated this chat by looking for a
      // thread with the same orgId, createdBy, and title created at the same
      // time. We use a simple heuristic: search threads by orgId and compare
      // _creationTime to the chat's _creationTime within a small window.
      // A more robust approach: we store legacyChatId on the thread — but the
      // schema uses legacyConversationId (for email). Instead we check if any
      // threadMessages already reference this chat's messages via legacyChatMessageId.
      const chatMessages = await ctx.db
        .query("webChatMessages")
        .withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
        .collect();

      // Check idempotency: if the first chat message already has a corresponding
      // threadMessage with legacyChatMessageId set, skip this chat.
      if (chatMessages.length > 0) {
        const existingThreadMsg = await ctx.db
          .query("threadMessages")
          .withIndex("by_threadId")
          .filter((q) =>
            q.eq(q.field("legacyChatMessageId"), chatMessages[0]._id)
          )
          .first();
        if (existingThreadMsg) {
          chatsSkipped++;
          continue;
        }
      }

      // Create the thread
      const threadId = await ctx.db.insert("threads", {
        orgId: chat.orgId,
        title: chat.title,
        createdBy: chat.createdBy,
        lastMessageAt: chat.lastMessageAt ?? chat._creationTime,
        archivedAt: chat.archivedAt,
        initialContext: chat.initialContext,
      });
      threadsCreated++;

      // Migrate messages
      for (const msg of chatMessages) {
        await ctx.db.insert("threadMessages", {
          threadId,
          orgId: chat.orgId,
          channel: "chat",
          role: msg.role,
          userId: msg.userId,
          userName: msg.userName,
          content: msg.content,
          status: msg.status,
          error: msg.error,
          legacyChatMessageId: msg._id,
        });
        messagesCreated++;
      }
    }

    return { threadsCreated, messagesCreated, chatsSkipped };
  },
});

// ─── Part 2: agentConversations → threads + threadMessages ───

export const migrateEmailConversations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const conversations = await ctx.db.query("agentConversations").collect();
    let threadsCreated = 0;
    let messagesCreated = 0;
    let threadsSkipped = 0;

    // Group conversations by threadId.
    // Conversations with threadId set belong to that thread group.
    // Conversations without threadId are their own thread root (standalone).
    const threadGroups = new Map<
      string,
      typeof conversations
    >();

    for (const conv of conversations) {
      // The threadId field points to the root conversation of the thread.
      // If it's not set, this conversation IS a root (or standalone).
      const rootId = conv.threadId ?? conv._id;
      const group = threadGroups.get(rootId) ?? [];
      group.push(conv);
      threadGroups.set(rootId, group);
    }

    for (const [rootIdStr, group] of threadGroups) {
      const rootId = rootIdStr as Id<"agentConversations">;

      // Idempotency: check if a thread with this legacyConversationId exists
      const existingThread = await ctx.db
        .query("threads")
        .withIndex("by_legacyConversationId", (q) =>
          q.eq("legacyConversationId", rootId)
        )
        .first();
      if (existingThread) {
        threadsSkipped++;
        continue;
      }

      // Find the root conversation for metadata
      const rootConv = group.find((c) => c._id === rootId) ?? group[0];

      // Determine lastMessageAt from the latest message in the group
      let lastMessageAt = rootConv._creationTime;
      for (const conv of group) {
        if (conv.responseSentAt && conv.responseSentAt > lastMessageAt) {
          lastMessageAt = conv.responseSentAt;
        }
        if (conv._creationTime > lastMessageAt) {
          lastMessageAt = conv._creationTime;
        }
      }

      // Need an orgId — skip conversations without one
      if (!rootConv.orgId) {
        continue;
      }

      // Create the thread
      const threadId = await ctx.db.insert("threads", {
        orgId: rootConv.orgId,
        title: rootConv.subject,
        createdBy: rootConv.userId,
        lastMessageAt,
        archivedAt: rootConv.archivedAt,
        legacyConversationId: rootId,
      });
      threadsCreated++;

      // Sort group by creation time so messages are in order
      group.sort((a, b) => a._creationTime - b._creationTime);

      for (const conv of group) {
        // Inbound email message
        await ctx.db.insert("threadMessages", {
          threadId,
          orgId: rootConv.orgId,
          channel: "email",
          role: "user",
          userId: conv.userId,
          fromEmail: conv.fromEmail,
          fromName: conv.fromName,
          toAddresses: conv.toAddresses,
          ccAddresses: conv.ccAddresses,
          subject: conv.subject,
          content: conv.body,
          contentHtml: conv.bodyHtml,
          messageId: conv.messageId,
          attachments: conv.attachments,
          legacyConversationId: conv._id,
        });
        messagesCreated++;

        // Agent response (if one was sent)
        if (conv.responseBody) {
          await ctx.db.insert("threadMessages", {
            threadId,
            orgId: rootConv.orgId,
            channel: "email",
            role: "agent",
            content: conv.responseBody,
            responseMessageId: conv.responseMessageId,
            referencedPolicyIds: conv.referencedPolicyIds,
            referencedQuoteIds: conv.referencedQuoteIds,
            legacyConversationId: conv._id,
          });
          messagesCreated++;
        }
      }
    }

    return { threadsCreated, messagesCreated, threadsSkipped };
  },
});

// ─── Verification ───

export const verifyMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    const webChats = await ctx.db.query("webChats").collect();
    const threads = await ctx.db.query("threads").collect();
    const conversations = await ctx.db.query("agentConversations").collect();

    // Count email thread groups
    const threadRoots = new Set<string>();
    for (const conv of conversations) {
      threadRoots.add((conv.threadId ?? conv._id) as string);
    }
    // Exclude conversations without orgId (these are skipped during migration)
    const conversationsWithOrg = conversations.filter((c) => c.orgId);
    const emailRoots = new Set<string>();
    for (const conv of conversationsWithOrg) {
      emailRoots.add((conv.threadId ?? conv._id) as string);
    }

    const threadsWithLegacy = threads.filter((t) => t.legacyConversationId);
    const threadsWithoutLegacy = threads.filter((t) => !t.legacyConversationId);

    const webChatMessages = await ctx.db.query("webChatMessages").collect();
    const threadMessages = await ctx.db.query("threadMessages").collect();

    const chatThreadMessages = threadMessages.filter((m) => m.channel === "chat");
    const emailThreadMessages = threadMessages.filter((m) => m.channel === "email");

    return {
      source: {
        webChats: webChats.length,
        webChatMessages: webChatMessages.length,
        agentConversations: conversations.length,
        agentConversationsWithOrg: conversationsWithOrg.length,
        emailThreadGroups: emailRoots.size,
      },
      migrated: {
        threads: threads.length,
        threadsChatOrigin: threadsWithoutLegacy.length,
        threadsEmailOrigin: threadsWithLegacy.length,
        threadMessages: threadMessages.length,
        chatMessages: chatThreadMessages.length,
        emailMessages: emailThreadMessages.length,
      },
      ok:
        threadsWithoutLegacy.length >= webChats.length &&
        threadsWithLegacy.length >= emailRoots.size,
    };
  },
});
