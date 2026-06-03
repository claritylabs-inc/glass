import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getPolicyAccessForQuery } from "./lib/access";
import { getActiveOperatorProfile } from "./lib/operatorIdentity";

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
  embedding: v.optional(v.array(v.float64())),
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
  formNumber?: string;
  bbox?: unknown;
  order: number;
  path: string;
  metadata?: unknown;
  hasChildren: boolean;
  children?: PublicSourceNode[];
};

async function canReadPolicySourceNodes(
  ctx: Pick<QueryCtx, "auth" | "db">,
  policyId: Id<"policies">,
  allowOperatorAccess = false,
) {
  try {
    if (await getPolicyAccessForQuery(ctx as QueryCtx, policyId)) return true;
  } catch {
    // Fall through to the operator check. Unauthenticated callers still fail.
  }
  return allowOperatorAccess
    ? Boolean(await getActiveOperatorProfile(ctx as QueryCtx))
    : false;
}

function likelyHasChildNodes(node: SourceNodeDoc) {
  return !["text", "table_cell"].includes(node.kind);
}

function publicSourceNode(
  node: SourceNodeDoc,
  hasChildren: boolean,
  children?: PublicSourceNode[],
) {
  const metadata = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
    ? node.metadata as Record<string, unknown>
    : undefined;
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
    formNumber: typeof metadata?.formNumber === "string" ? metadata.formNumber : undefined,
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
): Promise<PublicSourceNode[]> {
  const children = await childNodes(ctx, policyId, parentNodeId);
  return Promise.all(children.map(async (node: SourceNodeDoc) => {
    if (node.kind !== "table_row") {
      return publicSourceNode(node, likelyHasChildNodes(node));
    }
    return publicSourceNode(
      node,
      true,
      await publicChildNodes(ctx, policyId, node.nodeId),
    );
  }));
}

export const listTopLevelByPolicy = query({
  args: {
    policyId: v.id("policies"),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!await canReadPolicySourceNodes(ctx, args.policyId, args.allowOperatorAccess)) return [];

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

    const hydratedTopLevel = await Promise.all(topLevel.map(async (node) => {
      if (!likelyHasChildNodes(node) || node.kind === "page") {
        return publicSourceNode(node, likelyHasChildNodes(node));
      }
      return publicSourceNode(
        node,
        true,
        await publicChildNodes(ctx, args.policyId, node.nodeId),
      );
    }));
    return hydratedTopLevel;
  },
});

export const listChildrenByPolicyAndParentNodeId = query({
  args: {
    policyId: v.id("policies"),
    parentNodeId: v.string(),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!await canReadPolicySourceNodes(ctx, args.policyId, args.allowOperatorAccess)) return [];
    return await publicChildNodes(ctx, args.policyId, args.parentNodeId);
  },
});

export const listByPolicy = query({
  args: {
    policyId: v.id("policies"),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!await canReadPolicySourceNodes(ctx, args.policyId, args.allowOperatorAccess)) return [];
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
    if (!await canReadPolicySourceNodes(ctx, args.policyId)) return [];
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
          publicSourceNode(node, likelyHasChildNodes(node)),
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

export const listByOrgInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 1000), 2000));
    return ctx.db
      .query("sourceNodes")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .take(limit);
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

export const hasNodesForPolicy = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
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
