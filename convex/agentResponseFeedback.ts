import dayjs from "dayjs";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { assertCanUseTenantAgent, requireCurrentOrgAccess } from "./lib/access";
import { canAccessThread } from "./lib/threadAccess";

const ratingValidator = v.union(v.literal("positive"), v.literal("negative"));

async function feedbackContext(ctx: QueryCtx, messageId: Id<"threadMessages">) {
  const access = await requireCurrentOrgAccess(ctx);
  assertCanUseTenantAgent(access);
  const { userId, orgId: userOrgId } = access;
  const message = await ctx.db.get(messageId);
  if (!message || message.role !== "agent")
    throw new Error("Response not found");
  const thread = await ctx.db.get(message.threadId);
  if (!thread) throw new Error("Response not found");
  const clientOrg = await ctx.db.get(thread.orgId);
  if (!canAccessThread({ userId, userOrgId, thread, clientOrg })) {
    throw new Error("Response not found");
  }
  return { userId, message, thread };
}

export const getContextInternal = internalQuery({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => await feedbackContext(ctx, args.messageId),
});

export const getForMessage = query({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => {
    const { userId } = await feedbackContext(ctx, args.messageId);
    return await ctx.db
      .query("agentResponseFeedback")
      .withIndex("message_user", (query) =>
        query.eq("threadMessageId", args.messageId).eq("userId", userId),
      )
      .unique();
  },
});

export const recordWebInternal = internalMutation({
  args: {
    messageId: v.id("threadMessages"),
    userId: v.id("users"),
    rating: ratingValidator,
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    const thread = message ? await ctx.db.get(message.threadId) : null;
    if (!message || !thread || message.role !== "agent") {
      throw new Error("Response feedback context is invalid");
    }
    const existing = await ctx.db
      .query("agentResponseFeedback")
      .withIndex("message_user", (query) =>
        query.eq("threadMessageId", message._id).eq("userId", args.userId),
      )
      .unique();
    if (existing) {
      if (!existing.routerRequestId && message.routerRequestId) {
        await ctx.db.patch(existing._id, {
          routerRequestId: message.routerRequestId,
          routerSignalStatus: "pending",
          routerSignalAttempts: existing.routerSignalAttempts ?? 0,
          updatedAt: dayjs().valueOf(),
        });
      }
      return {
        id: existing._id,
        rating: existing.rating,
        routerRequestId: existing.routerRequestId ?? message.routerRequestId,
        shouldSubmit:
          Boolean(existing.routerRequestId ?? message.routerRequestId) &&
          existing.routerSignalStatus !== "submitted",
      };
    }
    const timestamp = dayjs().valueOf();
    const id = await ctx.db.insert("agentResponseFeedback", {
      orgId: message.orgId,
      threadId: thread._id,
      threadMessageId: message._id,
      routerRequestId: message.routerRequestId,
      source: "web",
      userId: args.userId,
      rating: args.rating,
      comment: args.comment?.trim().slice(0, 2_000) || undefined,
      routerSignalStatus: message.routerRequestId
        ? "pending"
        : "not_applicable",
      routerSignalAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      id,
      rating: args.rating,
      routerRequestId: message.routerRequestId,
      shouldSubmit: true,
    };
  },
});

export const recordImessageInternal = internalMutation({
  args: {
    messageId: v.id("threadMessages"),
    senderAddress: v.string(),
    rating: ratingValidator,
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message ||
      message.role !== "agent" ||
      message.channel !== "imessage" ||
      !message.feedbackPromptedAt
    ) {
      throw new Error("iMessage feedback context is invalid");
    }
    const senderAddress = args.senderAddress.trim().toLowerCase();
    const existing = await ctx.db
      .query("agentResponseFeedback")
      .withIndex("message_sender", (query) =>
        query
          .eq("threadMessageId", message._id)
          .eq("imessageSenderAddress", senderAddress),
      )
      .unique();
    if (existing) {
      if (!existing.routerRequestId && message.routerRequestId) {
        await ctx.db.patch(existing._id, {
          routerRequestId: message.routerRequestId,
          routerSignalStatus: "pending",
          routerSignalAttempts: existing.routerSignalAttempts ?? 0,
          updatedAt: dayjs().valueOf(),
        });
      }
      return {
        id: existing._id,
        routerRequestId: existing.routerRequestId ?? message.routerRequestId,
        shouldSubmit:
          Boolean(existing.routerRequestId ?? message.routerRequestId) &&
          existing.routerSignalStatus !== "submitted",
      };
    }
    const timestamp = dayjs().valueOf();
    const id = await ctx.db.insert("agentResponseFeedback", {
      orgId: message.orgId,
      threadId: message.threadId,
      threadMessageId: message._id,
      routerRequestId: message.routerRequestId,
      source: "imessage",
      imessageSenderAddress: senderAddress,
      rating: args.rating,
      routerSignalStatus: message.routerRequestId
        ? "pending"
        : "not_applicable",
      routerSignalAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { id, routerRequestId: message.routerRequestId, shouldSubmit: true };
  },
});

export const markRouterSignalInternal = internalMutation({
  args: {
    feedbackId: v.id("agentResponseFeedback"),
    status: v.union(v.literal("submitted"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const feedback = await ctx.db.get(args.feedbackId);
    if (!feedback) return false;
    await ctx.db.patch(feedback._id, {
      routerSignalStatus: args.status,
      routerSignalAttempts: (feedback.routerSignalAttempts ?? 0) + 1,
      routerSignalError:
        args.status === "error"
          ? args.error?.trim().slice(0, 1_000)
          : undefined,
      updatedAt: dayjs().valueOf(),
    });
    return true;
  },
});

export const listPendingRouterSignalsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 100));
    const pending = await ctx.db
      .query("agentResponseFeedback")
      .withIndex("router_signal", (query) =>
        query.eq("routerSignalStatus", "pending"),
      )
      .take(limit);
    if (pending.length >= limit) return pending;
    const errors = await ctx.db
      .query("agentResponseFeedback")
      .withIndex("router_signal", (query) =>
        query.eq("routerSignalStatus", "error"),
      )
      .order("desc")
      .take(limit * 2);
    return [
      ...pending,
      ...errors.filter((feedback) => (feedback.routerSignalAttempts ?? 0) < 10),
    ].slice(0, limit);
  },
});
