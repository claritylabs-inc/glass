import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const classificationValidator = v.union(
  v.literal("ignore"),
  v.literal("policy_document"),
  v.literal("insurance_requirements"),
  v.literal("company_context"),
  v.literal("multiple"),
  v.literal("review_needed"),
);

function automationItemByMessageKey(
  ctx: MutationCtx,
  accountId: Id<"connectedEmailAccounts">,
  messageKey: string,
) {
  return ctx.db
    .query("connectedEmailAutomationItems")
    .withIndex("by_accountId_messageKey", (query) =>
      query.eq("accountId", accountId).eq("messageKey", messageKey),
    )
    .first();
}

export const getScanStateInternal = internalQuery({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    mailbox: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("connectedEmailScanStates")
      .withIndex("by_accountId_mailbox", (query) =>
        query.eq("accountId", args.accountId).eq("mailbox", args.mailbox),
      )
      .first(),
});

export const recordScanAttemptInternal = internalMutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    mailbox: v.string(),
    uidValidity: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("connectedEmailScanStates")
      .withIndex("by_accountId_mailbox", (query) =>
        query.eq("accountId", args.accountId).eq("mailbox", args.mailbox),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        uidValidity: args.uidValidity,
        lastUid:
          existing.uidValidity &&
          args.uidValidity &&
          existing.uidValidity !== args.uidValidity
            ? undefined
            : existing.lastUid,
        lastAttemptedAt: now,
        lastError: undefined,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("connectedEmailScanStates", {
      ...args,
      lastAttemptedAt: now,
      updatedAt: now,
    });
  },
});

export const recordScanSuccessInternal = internalMutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    mailbox: v.string(),
    uidValidity: v.optional(v.string()),
    lastUid: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("connectedEmailScanStates")
      .withIndex("by_accountId_mailbox", (query) =>
        query.eq("accountId", args.accountId).eq("mailbox", args.mailbox),
      )
      .first();
    const patch = {
      uidValidity: args.uidValidity,
      lastUid: args.lastUid,
      lastAttemptedAt: now,
      lastSuccessfulAt: now,
      lastError: undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("connectedEmailScanStates", {
      accountId: args.accountId,
      orgId: args.orgId,
      mailbox: args.mailbox,
      ...patch,
    });
  },
});

export const recordScanFailureInternal = internalMutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    mailbox: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("connectedEmailScanStates")
      .withIndex("by_accountId_mailbox", (query) =>
        query.eq("accountId", args.accountId).eq("mailbox", args.mailbox),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastAttemptedAt: now,
        lastError: args.error,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("connectedEmailScanStates", {
      accountId: args.accountId,
      orgId: args.orgId,
      mailbox: args.mailbox,
      lastAttemptedAt: now,
      lastError: args.error,
      updatedAt: now,
    });
  },
});

export const claimItemInternal = internalMutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    mailbox: v.string(),
    uid: v.number(),
    messageKey: v.string(),
    emailRef: v.string(),
    sourceMessageId: v.optional(v.string()),
    subject: v.string(),
    from: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    classification: classificationValidator,
    confidence: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await automationItemByMessageKey(
      ctx,
      args.accountId,
      args.messageKey,
    );
    if (existing?.status === "completed" || existing?.status === "skipped") {
      return { claimed: false, itemId: existing._id, status: existing.status };
    }
    if (
      existing?.status === "processing" &&
      now - existing.updatedAt < 15 * 60 * 1000
    ) {
      return { claimed: false, itemId: existing._id, status: existing.status };
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        classification: args.classification,
        confidence: args.confidence,
        reason: args.reason,
        status: "processing",
        attempts: existing.attempts + 1,
        lastError: undefined,
        updatedAt: now,
      });
      return { claimed: true, itemId: existing._id, status: "processing" as const };
    }
    const itemId = await ctx.db.insert("connectedEmailAutomationItems", {
      ...args,
      status: "processing",
      attempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { claimed: true, itemId, status: "processing" as const };
  },
});

// A message the IMAP fetch cannot read must not stall the scan watermark
// forever: record the failure per attempt, then give up and skip the message
// so the watermark can advance past it.
const MAX_UNREADABLE_MESSAGE_ATTEMPTS = 3;

export const recordUnreadableItemInternal = internalMutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    mailbox: v.string(),
    uid: v.number(),
    messageKey: v.string(),
    emailRef: v.string(),
    error: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ attempts: number; willRetry: boolean }> => {
    const now = dayjs().valueOf();
    const existing = await automationItemByMessageKey(
      ctx,
      args.accountId,
      args.messageKey,
    );
    if (existing?.status === "completed" || existing?.status === "skipped") {
      return { attempts: existing.attempts, willRetry: false };
    }
    const attempts = (existing?.attempts ?? 0) + 1;
    const gaveUp = attempts >= MAX_UNREADABLE_MESSAGE_ATTEMPTS;
    const patch = {
      status: gaveUp ? ("skipped" as const) : ("failed" as const),
      attempts,
      lastError: args.error,
      actionSummary: gaveUp
        ? "Skipped: Glass could not read this mailbox message after repeated attempts."
        : undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("connectedEmailAutomationItems", {
        accountId: args.accountId,
        orgId: args.orgId,
        userId: args.userId,
        mailbox: args.mailbox,
        uid: args.uid,
        messageKey: args.messageKey,
        emailRef: args.emailRef,
        subject: "(unreadable message)",
        classification: "review_needed",
        confidence: 0,
        reason: "Glass could not read this mailbox message.",
        createdAt: now,
        ...patch,
      });
    }
    return { attempts, willRetry: !gaveUp };
  },
});

export const finishItemInternal = internalMutation({
  args: {
    itemId: v.id("connectedEmailAutomationItems"),
    status: v.union(v.literal("completed"), v.literal("skipped")),
    actionSummary: v.optional(v.string()),
    policyIds: v.optional(v.array(v.id("policies"))),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    memoryIds: v.optional(v.array(v.id("orgMemory"))),
    threadId: v.optional(v.id("threads")),
  },
  handler: async (ctx, args) => {
    const { itemId, ...patch } = args;
    await ctx.db.patch(itemId, {
      ...patch,
      lastError: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const failItemInternal = internalMutation({
  args: {
    itemId: v.id("connectedEmailAutomationItems"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status === "completed" || item.status === "skipped") {
      return;
    }
    await ctx.db.patch(args.itemId, {
      status: "failed",
      lastError: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const attachThreadInternal = internalMutation({
  args: {
    itemId: v.id("connectedEmailAutomationItems"),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      threadId: args.threadId,
      updatedAt: dayjs().valueOf(),
    });
  },
});
