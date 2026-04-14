import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";

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

/** Get vector DB stats for the current org. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    // Aggregate by chunk type
    const byType: Record<string, number> = {};
    const byPolicy: Record<string, { carrier: string; policyNumber: string; count: number }> = {};

    for (const chunk of chunks) {
      byType[chunk.chunkType] = (byType[chunk.chunkType] || 0) + 1;

      const pid = chunk.policyId as string;
      if (!byPolicy[pid]) {
        byPolicy[pid] = { carrier: "", policyNumber: "", count: 0 };
      }
      byPolicy[pid].count++;
    }

    // Hydrate policy info for top policies
    const policyIds = Object.keys(byPolicy);
    for (const pid of policyIds) {
      const policy = await ctx.db.get(pid as any);
      if (policy) {
        byPolicy[pid].carrier = (policy as any).carrier ?? "Unknown";
        byPolicy[pid].policyNumber = (policy as any).policyNumber ?? "Unknown";
      }
    }

    return {
      totalChunks: chunks.length,
      totalPolicies: policyIds.length,
      byType: Object.entries(byType)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      byPolicy: Object.entries(byPolicy)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.count - a.count),
    };
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
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
  },
});
