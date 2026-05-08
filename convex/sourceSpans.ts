import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";

const sourceKindValidator = v.union(
  v.literal("policy_pdf"),
  v.literal("application_pdf"),
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
  embedding: v.array(v.float64()),
  createdAt: v.number(),
};

export const listSpansByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx);
    return ctx.db
      .query("sourceSpans")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
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

export const insertChunk = internalMutation({
  args: sourceChunkInsertFields,
  handler: async (ctx, args) => {
    return ctx.db.insert("sourceChunks", args);
  },
});

export const deleteByPolicy = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const spans = await ctx.db
      .query("sourceSpans")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    const chunks = await ctx.db
      .query("sourceChunks")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    for (const span of spans) await ctx.db.delete(span._id);
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
  },
});
