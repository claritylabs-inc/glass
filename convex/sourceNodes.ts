import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getPolicyAccessForQuery } from "./lib/access";

const sourceNodeInsertFields = {
  orgId: v.id("organizations"),
  policyId: v.optional(v.id("policies")),
  nodeId: v.string(),
  documentId: v.string(),
  parentNodeId: v.optional(v.string()),
  kind: v.string(),
  title: v.string(),
  description: v.string(),
  textExcerpt: v.optional(v.string()),
  sourceSpanIds: v.array(v.string()),
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
  bbox: v.optional(v.any()),
  order: v.number(),
  path: v.string(),
  metadata: v.optional(v.any()),
  embedding: v.array(v.float64()),
  createdAt: v.number(),
};

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) return [];
    return ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
  },
});

export const listByPolicyAndNodeIds = query({
  args: {
    policyId: v.id("policies"),
    nodeIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) return [];
    const wanted = new Set(args.nodeIds);
    if (wanted.size === 0) return [];
    const nodes = await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const relatedIds = new Set(wanted);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (relatedIds.has(node.nodeId) && node.parentNodeId && !relatedIds.has(node.parentNodeId)) {
          relatedIds.add(node.parentNodeId);
          changed = true;
        }
        if (node.parentNodeId && relatedIds.has(node.parentNodeId) && !relatedIds.has(node.nodeId)) {
          relatedIds.add(node.nodeId);
          changed = true;
        }
      }
    }
    return [...relatedIds]
      .map((nodeId) => byId.get(nodeId))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
  },
});

export const listByPolicyInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
  },
});

export const hasNodesForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("sourceNodes")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();
    return first !== null;
  },
});

export const get = internalQuery({
  args: { id: v.id("sourceNodes") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const insertNode = internalMutation({
  args: sourceNodeInsertFields,
  handler: async (ctx, args) => {
    return ctx.db.insert("sourceNodes", args);
  },
});

export const deleteByPolicy = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const nodes = await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    for (const node of nodes) await ctx.db.delete(node._id);
  },
});
