import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getCurrentOrgAccess } from "./lib/access";
import { canAccessThread } from "./lib/threadAccess";

const classificationValidator = v.union(
  v.literal("ignore"),
  v.literal("policy_document"),
  v.literal("insurance_requirements"),
  v.literal("company_context"),
  v.literal("multiple"),
  v.literal("review_needed"),
);

const INCOMPLETE_CLASSIFICATION_REASON =
  "The mailbox classifier did not return a complete decision.";

function userFacingReviewReason(reason: string) {
  const normalized = reason.trim();
  if (
    normalized === INCOMPLETE_CLASSIFICATION_REASON ||
    normalized === "Glass could not classify this email automatically. Review its sender, date, and attachments before choosing an action."
  ) {
    return undefined;
  }
  return normalized || undefined;
}

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

export const reviewForThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const access = await getCurrentOrgAccess(ctx);
    if (!access) return null;
    const thread = await ctx.db.get(args.threadId);
    if (
      !thread ||
      !canAccessThread({
        userId: access.userId,
        userOrgId: access.orgId,
        thread,
        clientOrg: null,
      })
    ) {
      return null;
    }
    const items = await ctx.db
      .query("connectedEmailAutomationItems")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    const reviewItems = items.filter(
      (item) =>
        item.orgId === access.orgId &&
        (item.needsReview ?? item.classification === "review_needed"),
    );
    if (reviewItems.length === 0) return null;

    const accountIds = [...new Set(reviewItems.map((item) => item.accountId))];
    const accounts = await Promise.all(accountIds.map((accountId) => ctx.db.get(accountId)));
    const emailByAccountId = new Map(
      accounts.flatMap((account) =>
        account ? [[String(account._id), account.emailAddress] as const] : [],
      ),
    );
    const title = reviewItems.length === 1
      ? "Review email"
      : `Review ${reviewItems.length} emails`;

    return {
      title,
      status: "needs_review",
      searches: [],
      evidence: {
        emails: reviewItems.map((item) => ({
          emailRef: item.emailRef,
          mailbox: item.mailbox,
          accountEmail: emailByAccountId.get(String(item.accountId)),
          subject: item.subject,
          from: item.from,
          date: item.receivedAt
            ? dayjs(item.receivedAt).toISOString()
            : undefined,
          reason: userFacingReviewReason(item.reviewReason ?? item.reason),
          attachments: [],
        })),
      },
      toolCalls: [],
    };
  },
});

export const resolveReview = mutation({
  args: {
    threadId: v.id("threads"),
    emailRef: v.string(),
    resolution: v.union(
      v.literal("not_relevant"),
      v.literal("policy_imported"),
      v.literal("requirements_imported"),
    ),
  },
  handler: async (ctx, args) => {
    const access = await getCurrentOrgAccess(ctx);
    if (!access) throw new Error("Not authenticated");
    const thread = await ctx.db.get(args.threadId);
    if (
      !thread ||
      !canAccessThread({
        userId: access.userId,
        userOrgId: access.orgId,
        thread,
        clientOrg: null,
      })
    ) {
      throw new Error("Thread not found");
    }
    const item = await ctx.db
      .query("connectedEmailAutomationItems")
      .withIndex("by_threadId_and_emailRef", (q) =>
        q.eq("threadId", args.threadId).eq("emailRef", args.emailRef),
      )
      .unique();
    if (
      !item ||
      item.orgId !== access.orgId ||
      !(item.needsReview ?? item.classification === "review_needed")
    ) {
      return { resolved: false };
    }

    const classification = args.resolution === "not_relevant"
      ? "ignore" as const
      : args.resolution === "policy_imported"
        ? "policy_document" as const
        : "insurance_requirements" as const;
    const actionSummary = args.resolution === "not_relevant"
      ? "Marked as not relevant."
      : args.resolution === "policy_imported"
        ? "Policy import started."
        : "Insurance requirements imported.";
    await ctx.db.patch(item._id, {
      classification,
      needsReview: false,
      reviewReason: undefined,
      actionSummary,
      updatedAt: dayjs().valueOf(),
    });
    return { resolved: true };
  },
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
        needsReview: undefined,
        reviewReason: undefined,
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
    needsReview: v.optional(v.boolean()),
    reviewReason: v.optional(v.string()),
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
