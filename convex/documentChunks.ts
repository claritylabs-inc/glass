import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** Get a single chunk by ID. */
export const get = internalQuery({
  args: { id: v.id("documentChunks") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

/** List chunks for a specific policy. */
export const listByPolicy = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("documentChunks")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
  },
});

/** Check if any chunks exist for an org (used for fallback logic). */
export const hasChunksForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("documentChunks")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();
    return first !== null;
  },
});

/** Insert a single document chunk. */
export const insert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    chunkId: v.string(),
    chunkType: v.string(),
    text: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("documentChunks", args);
  },
});

/** Delete a single chunk by ID. */
export const deleteOne = internalMutation({
  args: { id: v.id("documentChunks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/** List all chunks for an org with embeddings (used by PCA projection). */
export const listAllForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("documentChunks")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

/** Delete all chunks for a policy (used when re-extracting). */
export const deleteByPolicy = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .take(50);
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
    return { deleted: chunks.length };
  },
});

/** Update a single chunk after text/category edits. */
export const updateOne = internalMutation({
  args: {
    id: v.id("documentChunks"),
    text: v.optional(v.string()),
    chunkType: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});
