import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/orgAuth";

async function restoreCancelledEmailAsDraft(
  ctx: MutationCtx,
  id: Id<"pendingEmails">,
) {
  const pending = await ctx.db.get(id);
  if (!pending || pending.status !== "cancelled") {
    return null;
  }

  await ctx.db.patch(id, {
    status: "draft",
    scheduledSendTime: 0,
    sentMessageId: undefined,
  });

  if (pending.threadMessageId) {
    await ctx.db.patch(pending.threadMessageId, {
      content: pending.emailBody,
      toAddresses: [pending.recipientEmail],
      ccAddresses: pending.ccAddresses,
      bccAddresses: pending.bccAddresses,
      subject: pending.subject,
      attachments: pending.attachments,
      referencedPolicyIds: pending.referencedPolicyIds,
      referencedQuoteIds: pending.referencedQuoteIds,
      pendingEmailId: id,
      responseMessageId: undefined,
      status: "draft_email",
      error: undefined,
    });
  }

  if (pending.chatMessageId) {
    await ctx.db.patch(pending.chatMessageId, {
      content: "Email restored as a draft. Review it in the email draft card.",
      status: undefined,
      pendingEmailId: id,
    });
  }

  return pending;
}

// ── Queries ──

export const get = query({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId) return null;
    return pending;
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
        pendingEmailId: undefined,
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
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(),
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
    status: v.optional(v.union(v.literal("draft"), v.literal("pending"))),
  },
  handler: async (ctx, args) => {
    const { status, ...fields } = args;
    return await ctx.db.insert("pendingEmails", {
      ...fields,
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
    attachments: v.optional(v.array(v.object({
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      fileId: v.id("_storage"),
    }))),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
    chatMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, {
      ...patch,
      status: "draft",
      scheduledSendTime: 0,
    });
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
    return await ctx.db.get(args.id);
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
    return rows
      .filter((row) => row.orgId === args.orgId && row.status === "draft")
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Cancel a pending email (internal — no auth check) */
export const cancelInternal = internalMutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.id);
    if (!pending || (pending.status !== "pending" && pending.status !== "draft")) {
      return false;
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
        pendingEmailId: undefined,
      });
    }
    return true;
  },
});

export const restoreAsDraftInternal = internalMutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const restored = await restoreCancelledEmailAsDraft(ctx, args.id);
    return restored ? { id: args.id } : null;
  },
});
