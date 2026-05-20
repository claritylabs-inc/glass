import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const STALE_SENDING_MS = 5 * 60 * 1000;

export const claim = internalMutation({
  args: {
    idempotencyKey: v.string(),
    orgId: v.optional(v.id("organizations")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("imessageOutboundSends")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();

    if (existing) {
      if (
        existing.status === "sent" ||
        (existing.status === "sending" &&
          now - existing.updatedAt < STALE_SENDING_MS)
      ) {
        return { claimed: false, status: existing.status };
      }

      await ctx.db.patch(existing._id, {
        status: "sending",
        error: undefined,
        orgId: args.orgId ?? existing.orgId,
        threadId: args.threadId ?? existing.threadId,
        threadMessageId: args.threadMessageId ?? existing.threadMessageId,
        updatedAt: now,
      });
      return { claimed: true, status: "sending" as const };
    }

    await ctx.db.insert("imessageOutboundSends", {
      idempotencyKey: args.idempotencyKey,
      orgId: args.orgId,
      threadId: args.threadId,
      threadMessageId: args.threadMessageId,
      status: "sending",
      createdAt: now,
      updatedAt: now,
    });
    return { claimed: true, status: "sending" as const };
  },
});

export const complete = internalMutation({
  args: {
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageOutboundSends")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "sent",
      error: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const fail = internalMutation({
  args: {
    idempotencyKey: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageOutboundSends")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "failed",
      error: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});
