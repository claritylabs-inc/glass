import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const outboundAttachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
});
const STALE_SENDING_MS = 5 * 60 * 1_000;

export const claim = internalMutation({
  args: {
    idempotencyKey: v.string(),
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
    content: v.string(),
    attachments: v.optional(v.array(outboundAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.status !== "active" ||
      connection.clientOrgId !== args.orgId
    ) {
      throw new Error("Slack connection does not belong to the organization");
    }
    const thread = args.threadId ? await ctx.db.get(args.threadId) : null;
    if (
      thread &&
      (thread.orgId !== args.orgId ||
        thread.slackConnectionId !== args.connectionId)
    ) {
      throw new Error("Slack thread does not belong to the connection");
    }
    if (args.threadId && !thread) {
      throw new Error("Slack thread does not exist");
    }
    if (args.threadMessageId) {
      const message = await ctx.db.get(args.threadMessageId);
      if (
        !message ||
        message.orgId !== args.orgId ||
        (thread && message.threadId !== thread._id)
      ) {
        throw new Error("Slack message does not belong to the thread");
      }
      if (!thread) {
        const messageThread = await ctx.db.get(message.threadId);
        if (
          !messageThread ||
          messageThread.orgId !== args.orgId ||
          messageThread.slackConnectionId !== args.connectionId
        ) {
          throw new Error("Slack message does not belong to the connection");
        }
      }
    }
    const existing = await ctx.db
      .query("slackOutboundSends")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    const now = dayjs().valueOf();
    if (existing) {
      if (existing.status === "sent" || existing.attemptCount >= 3) {
        return { send: false, row: existing };
      }
      if (
        existing.status === "sending" &&
        now - existing.updatedAt < STALE_SENDING_MS
      ) {
        return { send: false, row: existing };
      }
      await ctx.db.patch(existing._id, {
        status: "sending",
        error: undefined,
        attemptCount: existing.attemptCount + 1,
        nextAttemptAt: undefined,
        updatedAt: now,
      });
      return {
        send: true,
        row: {
          ...existing,
          status: "sending" as const,
          attemptCount: existing.attemptCount + 1,
        },
      };
    }
    const id = await ctx.db.insert("slackOutboundSends", {
      ...args,
      status: "sending",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Could not create Slack outbound ledger row");
    return { send: true, row };
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("slackOutboundSends"),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      error: undefined,
      nextAttemptAt: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const markFailed = internalMutation({
  args: {
    id: v.id("slackOutboundSends"),
    error: v.string(),
    retry: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const retry = args.retry && row.attemptCount < 3;
    const nextAttemptAt = retry
      ? dayjs().add(2 ** row.attemptCount, "second").valueOf()
      : undefined;
    await ctx.db.patch(row._id, {
      status: "failed",
      error: args.error,
      nextAttemptAt,
      updatedAt: dayjs().valueOf(),
    });
    return nextAttemptAt;
  },
});

export const get = internalQuery({
  args: { id: v.id("slackOutboundSends") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const getSendTarget = internalQuery({
  args: {
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    const binding = await ctx.db
      .query("slackChannelBindings")
      .withIndex("by_connectionId_and_status", (q) =>
        q.eq("connectionId", connection._id).eq("status", "active"),
      )
      .first();
    return {
      connection,
      teamId:
        binding?.hostChannelId === args.channelId
          ? binding.hostTeamId
          : connection.teamId,
    };
  },
});
