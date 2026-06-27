import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getPolicyAccessForQuery } from "./lib/access";
import { getActiveOperatorProfile } from "./lib/operatorIdentity";

const sourceKindValidator = v.union(
  v.literal("policy_pdf"),
  v.literal("email"),
  v.literal("attachment"),
  v.literal("manual_note"),
);

const sourceSpanInsertFields = {
  orgId: v.id("organizations"),
  policyId: v.optional(v.id("policies")),
  spanId: v.string(),
  documentId: v.string(),
  sourceKind: sourceKindValidator,
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
  sectionId: v.optional(v.string()),
  formNumber: v.optional(v.string()),
  sourceUnit: v.optional(v.string()),
  parentSpanId: v.optional(v.string()),
  table: v.optional(v.any()),
  location: v.optional(v.any()),
  text: v.string(),
  textHash: v.string(),
  bbox: v.optional(v.any()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
};

const sourceChunkInsertFields = {
  orgId: v.id("organizations"),
  policyId: v.optional(v.id("policies")),
  chunkId: v.string(),
  documentId: v.string(),
  sourceSpanIds: v.array(v.string()),
  text: v.string(),
  metadata: v.optional(v.any()),
  embedding: v.optional(v.array(v.float64())),
  createdAt: v.number(),
};

type SourceSpanDoc = Doc<"sourceSpans">;

function parentFor(span: SourceSpanDoc) {
  const metadata = span.metadata && typeof span.metadata === "object"
    ? span.metadata as Record<string, unknown>
    : {};
  const table = span.table && typeof span.table === "object"
    ? span.table as Record<string, unknown>
    : {};
  const parent =
    span.parentSpanId ??
    table.rowSpanId ??
    table.tableSpanId ??
    metadata.parentSpanId ??
    metadata.rowSpanId ??
    metadata.tableSpanId;
  return typeof parent === "string" && parent.length > 0 ? parent : undefined;
}

export const listSpansByPolicyAndSpanIds = query({
  args: {
    policyId: v.id("policies"),
    spanIds: v.array(v.string()),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) {
      const operatorAccess = args.allowOperatorAccess
        ? await getActiveOperatorProfile(ctx)
        : null;
      if (!operatorAccess) return [];
    }

    const wanted = new Set(args.spanIds);
    if (wanted.size === 0) return [];
    const relatedIds = new Set(wanted);
    const byId = new Map<string, SourceSpanDoc>();
    const loadSpan = async (spanId: string) => {
      if (byId.has(spanId)) return byId.get(spanId);
      const span = await ctx.db
        .query("sourceSpans")
        .withIndex("by_policyId_spanId", (q) =>
          q.eq("policyId", args.policyId).eq("spanId", spanId),
        )
        .first();
      if (span) byId.set(spanId, span);
      return span;
    };

    let changed = true;
    while (changed) {
      changed = false;
      for (const spanId of [...relatedIds]) {
        const span = await loadSpan(spanId);
        if (!span) continue;
        const parentId = parentFor(span);
        if (parentId && !relatedIds.has(parentId)) {
          relatedIds.add(parentId);
          changed = true;
        }
      }
    }

    for (const spanId of [...relatedIds]) {
      const children = await ctx.db
        .query("sourceSpans")
        .withIndex("by_policyId_parentSpanId", (q) =>
          q.eq("policyId", args.policyId).eq("parentSpanId", spanId),
        )
        .collect();
      for (const child of children) {
        if (!relatedIds.has(child.spanId)) {
          relatedIds.add(child.spanId);
        }
        byId.set(child.spanId, child);
      }
    }

    return [...relatedIds]
      .map((spanId) => byId.get(spanId))
      .filter((span): span is NonNullable<typeof span> => Boolean(span));
  },
});

export const listSpansByPolicyInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sourceSpans")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
  },
});

export const listChunksByPolicy = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sourceChunks")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
  },
});

export const listChunksByOrgInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 1000), 2000));
    return ctx.db
      .query("sourceChunks")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .take(limit);
  },
});

export const hasChunksForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("sourceChunks")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();
    return first !== null;
  },
});

export const getSpan = internalQuery({
  args: { id: v.id("sourceSpans") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const getChunk = internalQuery({
  args: { id: v.id("sourceChunks") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const insertSpan = internalMutation({
  args: sourceSpanInsertFields,
  handler: async (ctx, args) => {
    return ctx.db.insert("sourceSpans", args);
  },
});

export const insertSpansBatch = internalMutation({
  args: {
    spans: v.array(v.object(sourceSpanInsertFields)),
  },
  handler: async (ctx, args) => {
    const inserted = [];
    for (const span of args.spans) {
      inserted.push(await ctx.db.insert("sourceSpans", span));
    }
    return { inserted: inserted.length };
  },
});

export const insertChunk = internalMutation({
  args: sourceChunkInsertFields,
  handler: async (ctx, args) => {
    return ctx.db.insert("sourceChunks", args);
  },
});

export const insertChunksBatch = internalMutation({
  args: {
    chunks: v.array(v.object(sourceChunkInsertFields)),
  },
  handler: async (ctx, args) => {
    const inserted = [];
    for (const chunk of args.chunks) {
      inserted.push(await ctx.db.insert("sourceChunks", chunk));
    }
    return { inserted: inserted.length };
  },
});

export const deleteByPolicy = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const spans = await ctx.db
      .query("sourceSpans")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .take(100);
    const chunks = await ctx.db
      .query("sourceChunks")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .take(50);
    for (const span of spans) await ctx.db.delete(span._id);
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
    return { deleted: spans.length + chunks.length };
  },
});
