import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
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

type SourceNodeDoc = Doc<"sourceNodes">;
type PublicSourceNode = {
  _id: SourceNodeDoc["_id"];
  _creationTime: number;
  id: string;
  nodeId: string;
  documentId: string;
  parentNodeId?: string;
  title: string;
  type: string;
  label: string;
  description: string;
  excerpt?: string;
  content?: string;
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
  bbox?: unknown;
  order: number;
  path: string;
  metadata?: unknown;
  hasChildren: boolean;
  children?: PublicSourceNode[];
};

async function hasChildNode(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
  parentNodeId: string,
) {
  const child = await ctx.db
    .query("sourceNodes")
    .withIndex("by_policyId_parentNodeId", (q) =>
      q.eq("policyId", policyId).eq("parentNodeId", parentNodeId),
    )
    .first();
  return child !== null;
}

function publicSourceNode(
  node: SourceNodeDoc,
  hasChildren: boolean,
  children?: PublicSourceNode[],
) {
  return {
    _id: node._id,
    _creationTime: node._creationTime,
    id: node.nodeId,
    nodeId: node.nodeId,
    documentId: node.documentId,
    parentNodeId: node.parentNodeId,
    title: node.title,
    type: node.kind,
    label: node.kind,
    description: node.description,
    excerpt: node.textExcerpt,
    content: node.textExcerpt,
    sourceSpanIds: node.sourceSpanIds,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    bbox: node.bbox,
    order: node.order,
    path: node.path,
    metadata: node.metadata,
    hasChildren,
    children,
  };
}

async function childNodes(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
  parentNodeId: string,
) {
  const children = await ctx.db
    .query("sourceNodes")
    .withIndex("by_policyId_parentNodeId", (q) =>
      q.eq("policyId", policyId).eq("parentNodeId", parentNodeId),
    )
    .collect();
  return children.sort((left, right) => left.order - right.order);
}

async function publicChildNodes(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
  parentNodeId: string,
) {
  const children = await childNodes(ctx, policyId, parentNodeId);
  return Promise.all(
    children.map(async (node: SourceNodeDoc) =>
      publicSourceNode(node, await hasChildNode(ctx, policyId, node.nodeId)),
    ),
  );
}

export const listTopLevelByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) return [];

    const rootCandidates = await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId_parentNodeId", (q) =>
        q.eq("policyId", args.policyId).eq("parentNodeId", undefined),
      )
      .collect();
    const root = rootCandidates.find((node) => node.kind === "document");
    const topLevel = root
      ? await childNodes(ctx, args.policyId, root.nodeId)
      : rootCandidates
        .filter((node) => node.kind !== "document")
        .sort((left, right) => left.order - right.order);

    return Promise.all(
      topLevel.map(async (node) =>
        publicSourceNode(node, await hasChildNode(ctx, args.policyId, node.nodeId)),
      ),
    );
  },
});

export const listChildrenByPolicyAndParentNodeId = query({
  args: {
    policyId: v.id("policies"),
    parentNodeId: v.string(),
  },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) return [];

    const parent = await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId_nodeId", (q) =>
        q.eq("policyId", args.policyId).eq("nodeId", args.parentNodeId),
      )
      .first();
    if (!parent) return [];

    const children = await publicChildNodes(ctx, args.policyId, args.parentNodeId);
    if (parent.kind !== "table") return children;

    return Promise.all(
      children.map(async (child) => {
        if (child.type !== "table_row") return child;
        return {
          ...child,
          children: await publicChildNodes(ctx, args.policyId, child.nodeId),
        };
      }),
    );
  },
});

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) return [];
    const nodes = await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    const childParentIds = new Set(
      nodes
        .map((node) => node.parentNodeId)
        .filter((parentNodeId): parentNodeId is string => Boolean(parentNodeId)),
    );
    return nodes
      .sort((left, right) => left.order - right.order)
      .map((node) => publicSourceNode(node, childParentIds.has(node.nodeId)));
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

    const byId = new Map<string, SourceNodeDoc>();
    const loadNode = async (nodeId: string) => {
      if (byId.has(nodeId)) return byId.get(nodeId);
      const node = await ctx.db
        .query("sourceNodes")
        .withIndex("by_policyId_nodeId", (q) =>
          q.eq("policyId", args.policyId).eq("nodeId", nodeId),
        )
        .first();
      if (node) byId.set(nodeId, node);
      return node;
    };

    for (const nodeId of wanted) {
      let node = await loadNode(nodeId);
      while (node?.parentNodeId) {
        node = await loadNode(node.parentNodeId);
      }
    }

    for (const nodeId of wanted) {
      const children = await childNodes(ctx, args.policyId, nodeId);
      for (const child of children) byId.set(child.nodeId, child);
    }

    return Promise.all(
      [...byId.values()]
        .sort((left, right) => left.order - right.order)
        .map(async (node) =>
          publicSourceNode(node, await hasChildNode(ctx, args.policyId, node.nodeId)),
        ),
    );
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
      .take(50);
    for (const node of nodes) await ctx.db.delete(node._id);
    return { deleted: nodes.length };
  },
});
