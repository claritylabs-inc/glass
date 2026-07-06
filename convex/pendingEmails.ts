import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireCurrentOrgAccess as requireOrgAccess } from "./lib/access";
import {
  cancelDraftOrPendingEmail,
  restoreCancelledEmailAsDraft,
  updateDraftRecipient,
  withLegacySendBlockedReason,
} from "./lib/emailDraftService";
import { extractStoredEmailPayloadFields } from "./lib/emailPayloadFields";

// ── Queries ──

export const get = query({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId) return null;
    return await withLegacySendBlockedReason(ctx, pending);
  },
});

// ── Mutations ──

export const cancel = mutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId) throw new Error("Not found");
    if (pending.status !== "pending" && pending.status !== "draft") {
      throw new Error("Email already processed");
    }

    await ctx.db.patch(args.id, { status: "cancelled" });

    if (pending.threadMessageId) {
      await ctx.db.patch(pending.threadMessageId, {
        status: "cancelled",
      });
    }

    if (pending.chatMessageId) {
      await ctx.db.patch(pending.chatMessageId, {
        content: "Email cancelled.",
        status: undefined,
        pendingEmailId: args.id,
      });
    }
  },
});

export const restoreAsDraft = mutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId) throw new Error("Not found");
    if (pending.status !== "cancelled") {
      throw new Error("Only cancelled emails can be restored");
    }

    await restoreCancelledEmailAsDraft(ctx, args.id);
  },
});

// ── Internal ──

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    emailPayload: v.string(),
    scheduledSendTime: v.number(),
    chatMessageId: v.optional(v.id("threadMessages")),
    threadMessageId: v.optional(v.id("threadMessages")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(),
    fromHeader: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    renderedText: v.optional(v.string()),
    renderedHtml: v.optional(v.string()),
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
    allowMultipleCoiAttachments: v.optional(v.boolean()),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    sendBlockedReason: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("pending"))),
  },
  handler: async (ctx, args) => {
    const {
      status,
      emailPayload,
      fromHeader,
      replyTo,
      inReplyTo,
      references,
      renderedText,
      renderedHtml,
      ...fields
    } = args;
    const payloadFields = extractStoredEmailPayloadFields(emailPayload);
    return await ctx.db.insert("pendingEmails", {
      ...fields,
      emailPayload,
      fromHeader: fromHeader ?? payloadFields.fromHeader,
      replyTo: replyTo ?? payloadFields.replyTo,
      inReplyTo: inReplyTo ?? payloadFields.inReplyTo,
      references: references ?? payloadFields.references,
      renderedText: renderedText ?? payloadFields.renderedText,
      renderedHtml: renderedHtml ?? payloadFields.renderedHtml,
      status: status ?? "pending",
    });
  },
});

export const setThreadMessage = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    threadMessageId: v.id("threadMessages"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { threadMessageId: args.threadMessageId });
  },
});

export const updateDraftInternal = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    emailPayload: v.string(),
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(),
    fromHeader: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    renderedText: v.optional(v.string()),
    renderedHtml: v.optional(v.string()),
    attachments: v.optional(v.array(v.object({
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      fileId: v.id("_storage"),
    }))),
    allowMultipleCoiAttachments: v.optional(v.boolean()),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    chatMessageId: v.optional(v.id("threadMessages")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    sendBlockedReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const {
      id,
      emailPayload,
      fromHeader,
      replyTo,
      inReplyTo,
      references,
      renderedText,
      renderedHtml,
      ...patch
    } = args;
    const payloadFields = extractStoredEmailPayloadFields(emailPayload);
    await ctx.db.patch(id, {
      ...patch,
      emailPayload,
      fromHeader: fromHeader ?? payloadFields.fromHeader,
      replyTo: replyTo ?? payloadFields.replyTo,
      inReplyTo: inReplyTo ?? payloadFields.inReplyTo,
      references: references ?? payloadFields.references,
      renderedText: renderedText ?? payloadFields.renderedText,
      renderedHtml: renderedHtml ?? payloadFields.renderedHtml,
      status: "draft",
      scheduledSendTime: 0,
      sendBlockedReason: args.sendBlockedReason,
    });
  },
});

export const updateDraftRecipientInternal = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    recipientEmail: v.string(),
  },
  handler: async (ctx, args) => {
    return await updateDraftRecipient(ctx, args.id, args.recipientEmail);
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    sentMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      sentMessageId: args.sentMessageId,
    });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    return await withLegacySendBlockedReason(ctx, await ctx.db.get(args.id));
  },
});

/** Find pending (not yet sent/cancelled) emails in a thread */
export const findPendingByThread = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    return all.filter((e) => e.status === "pending");
  },
});

export const findDraftByThread = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    return all
      .filter((e) => e.status === "draft")
      .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
  },
});

export const findDraftByThreadAndRecipient = internalQuery({
  args: {
    threadId: v.id("threads"),
    recipientEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const recipientEmail = args.recipientEmail.trim().toLowerCase();
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    return all
      .filter((e) =>
        e.status === "draft" &&
        e.recipientEmail.trim().toLowerCase() === recipientEmail
      )
      .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
  },
});

export const findLatestCancelledByThread = internalQuery({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    return all
      .filter((e) => e.orgId === args.orgId && e.status === "cancelled")
      .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
  },
});

export const listDraftsInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
  },
  handler: async (ctx, args) => {
    const rows = args.threadId
      ? await ctx.db
          .query("pendingEmails")
          .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId!))
          .collect()
      : await ctx.db
          .query("pendingEmails")
          .withIndex("by_status", (q) => q.eq("status", "draft"))
          .collect();
    const drafts = rows
      .filter((row) => row.orgId === args.orgId && row.status === "draft")
      .sort((a, b) => b._creationTime - a._creationTime);
    const enriched = await Promise.all(
      drafts.map((draft) => withLegacySendBlockedReason(ctx, draft)),
    );
    return enriched.filter(
      (draft): draft is Doc<"pendingEmails"> => draft !== null,
    );
  },
});

/** Cancel a pending email (internal — no auth check) */
export const cancelInternal = internalMutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    return await cancelDraftOrPendingEmail(ctx, args.id);
  },
});

export const restoreAsDraftInternal = internalMutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const restored = await restoreCancelledEmailAsDraft(ctx, args.id);
    return restored ? { id: args.id } : null;
  },
});
