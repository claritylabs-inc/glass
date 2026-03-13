import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";
import type { FormField, QuestionBatch } from "./lib/applicationTypes";

function parseFields(raw?: string): FormField[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function parseBatches(raw?: string): QuestionBatch[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ── Public (auth-scoped) ──

export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const sessions = await ctx.db
      .query("applicationSessions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .order("desc")
      .collect();
    return sessions.map((s) => ({
      ...s,
      // Don't send large JSON blobs to the list view
      extractedFields: undefined,
      questionBatches: undefined,
      rawExtractionResponse: undefined,
    }));
  },
});

export const get = query({
  args: { id: v.id("applicationSessions") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.orgId !== orgId) return null;
    return {
      ...session,
      parsedFields: parseFields(session.extractedFields),
      parsedBatches: parseBatches(session.questionBatches),
    };
  },
});

/** Returns thread IDs for all application sessions in the org — used to tag conversations. */
export const threadIds = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return {};
    const { orgId } = access;
    const sessions = await ctx.db
      .query("applicationSessions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    // Map threadId → { sessionId, status, applicationTitle }
    const map: Record<string, { sessionId: string; status: string; title?: string }> = {};
    for (const s of sessions) {
      const key = String(s.threadId ?? s.conversationId);
      map[key] = {
        sessionId: s._id,
        status: s.status,
        title: s.applicationTitle ?? s.sourceFileName,
      };
    }
    return map;
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { active: 0, completed: 0, total: 0 };
    const { orgId } = access;
    const sessions = await ctx.db
      .query("applicationSessions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const active = sessions.filter(
      (s) => !["complete", "cancelled"].includes(s.status),
    ).length;
    const completed = sessions.filter((s) => s.status === "complete").length;
    return { active, completed, total: sessions.length };
  },
});

/** Public mutation: update a single field's value by its ID. */
export const updateFieldValue = mutation({
  args: {
    id: v.id("applicationSessions"),
    fieldId: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.orgId !== orgId) throw new Error("Not found");
    const fields: FormField[] = parseFields(session.extractedFields);
    const field = fields.find((f) => f.id === args.fieldId);
    if (!field) throw new Error("Field not found");
    (field as any).value = args.value || undefined;
    if (args.value) (field as any).source = "manual";
    const filledFields = fields.filter((f) => {
      if (f.fieldType === "table") return ((f as any).rows?.length ?? 0) > 0;
      return !!(f as any).value;
    }).length;
    await ctx.db.patch(args.id, {
      extractedFields: JSON.stringify(fields),
      filledFields,
    });
  },
});

export const cancel = mutation({
  args: { id: v.id("applicationSessions") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.orgId !== orgId) throw new Error("Not found");
    if (["complete", "cancelled"].includes(session.status)) {
      throw new Error("Session already ended");
    }
    await ctx.db.patch(args.id, {
      status: "cancelled",
      cancelledAt: Date.now(),
    });
  },
});

export const getSourceFileUrl = query({
  args: { id: v.id("applicationSessions") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.orgId !== orgId) return null;
    return await ctx.storage.getUrl(session.sourceFileId);
  },
});

export const getSummaryFileUrl = query({
  args: { id: v.id("applicationSessions") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.orgId !== orgId || !session.summaryFileId)
      return null;
    return await ctx.storage.getUrl(session.summaryFileId);
  },
});

export const getFilledFileUrl = query({
  args: { id: v.id("applicationSessions") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.orgId !== orgId || !session.filledFileId)
      return null;
    return await ctx.storage.getUrl(session.filledFileId);
  },
});

// ── Internal ──

export const getInternal = internalQuery({
  args: { id: v.id("applicationSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) return null;
    return {
      ...session,
      parsedFields: parseFields(session.extractedFields),
      parsedBatches: parseBatches(session.questionBatches),
    };
  },
});

export const findByThreadId = internalQuery({
  args: { threadId: v.id("agentConversations") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("applicationSessions")
      .withIndex("by_threadId", (idx) => idx.eq("threadId", args.threadId))
      .collect();
    // Find active session (not complete or cancelled)
    return (
      sessions.find(
        (s) => !["complete", "cancelled"].includes(s.status),
      ) ?? null
    );
  },
});

/** Find an active application session by a sent message ID (for reply routing). */
export const findBySentMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    // Normalize: strip angle brackets if present
    const normalized = args.messageId.replace(/^<|>$/g, "").trim();

    const sessions = await ctx.db
      .query("applicationSessions")
      .filter((q) => q.neq(q.field("status"), "complete"))
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .collect();

    return (
      sessions.find((s) => {
        if (!s.lastSentMessageId) return false;
        const storedNorm = s.lastSentMessageId.replace(/^<|>$/g, "").trim();
        // Check exact match, prefix match, or Resend ID match (id@resend.dev format)
        return (
          storedNorm === normalized ||
          normalized.startsWith(storedNorm) ||
          storedNorm.startsWith(normalized)
        );
      }) ?? null
    );
  },
});

/** Find any active application session for an org (fallback when threading fails). */
export const findActiveByOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("applicationSessions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return (
      sessions.find(
        (s) => !["complete", "cancelled"].includes(s.status) && s.status !== "extracting_fields" && s.status !== "filling_known",
      ) ?? null
    );
  },
});

/** All application sessions for an org (used by agent for context) */
export const listAllInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("applicationSessions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    // Return lightweight summaries (no large JSON blobs)
    return sessions.map((s) => ({
      _id: s._id,
      status: s.status,
      applicationTitle: s.applicationTitle,
      sourceFileName: s.sourceFileName,
      totalFields: s.totalFields,
      filledFields: s.filledFields,
      confirmedFields: s.confirmedFields,
      currentBatchIndex: s.currentBatchIndex,
      completedAt: s.completedAt,
      cancelledAt: s.cancelledAt,
      _creationTime: s._creationTime,
    }));
  },
});

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    conversationId: v.id("agentConversations"),
    threadId: v.optional(v.id("agentConversations")),
    sourceFileId: v.id("_storage"),
    sourceFileName: v.string(),
    applicationTitle: v.optional(v.string()),
    originalMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("applicationSessions", {
      orgId: args.orgId,
      userId: args.userId,
      conversationId: args.conversationId,
      threadId: args.threadId,
      sourceFileId: args.sourceFileId,
      sourceFileName: args.sourceFileName,
      applicationTitle: args.applicationTitle,
      originalMessageId: args.originalMessageId,
      status: "extracting_fields",
    });
  },
});

export const updateFields = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    extractedFields: v.string(),
    totalFields: v.number(),
    filledFields: v.number(),
    rawExtractionResponse: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const updateStatus = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    status: v.union(
      v.literal("extracting_fields"),
      v.literal("filling_known"),
      v.literal("asking_questions"),
      v.literal("pending_confirmation"),
      v.literal("confirmed"),
      v.literal("complete"),
      v.literal("cancelled"),
    ),
    extractedFields: v.optional(v.string()),
    filledFields: v.optional(v.number()),
    confirmedFields: v.optional(v.number()),
    applicationTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const updateBatches = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    questionBatches: v.string(),
    currentBatchIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const markComplete = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    summaryFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "complete",
      completedAt: Date.now(),
      summaryFileId: args.summaryFileId,
    });
  },
});

export const updateError = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { error: args.error });
  },
});

export const updateLastSentMessageId = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    lastSentMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastSentMessageId: args.lastSentMessageId });
  },
});

export const setFilledFileId = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    filledFileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { filledFileId: args.filledFileId });
  },
});

export const resetForRetry = internalMutation({
  args: { id: v.id("applicationSessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "extracting_fields",
      error: undefined,
      extractedFields: undefined,
      questionBatches: undefined,
      currentBatchIndex: undefined,
      totalFields: undefined,
      filledFields: undefined,
      confirmedFields: undefined,
      rawExtractionResponse: undefined,
    });
  },
});
