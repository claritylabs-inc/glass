import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const sourceValidator = v.union(
  v.literal("pending_email"),
  v.literal("email_subagent"),
  v.literal("policy_delivery"),
  v.literal("inbound_email"),
);

export const start = internalMutation({
  args: {
    orgId: v.id("organizations"),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    source: sourceValidator,
    deliveryMode: v.optional(v.string()),
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("emailDeliveryAttempts", {
      ...args,
      provider: "resend",
      status: "attempting",
      startedAt: dayjs().valueOf(),
    });
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("emailDeliveryAttempts"),
    resendEmailId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      resendEmailId: args.resendEmailId,
      completedAt: dayjs().valueOf(),
      error: undefined,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    id: v.id("emailDeliveryAttempts"),
    status: v.union(v.literal("failed"), v.literal("blocked")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      error: args.error,
      completedAt: dayjs().valueOf(),
    });
  },
});
