import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";

const nodeFields = {
  orgId: v.id("organizations"),
  proposalId: v.id("procurementProposals"),
  proposalDocumentId: v.id("procurementProposalDocuments"),
  extractionFingerprint: v.string(),
  documentId: v.string(),
  nodeId: v.string(),
  parentNodeId: v.optional(v.string()),
  kind: v.string(),
  title: v.string(),
  textExcerpt: v.optional(v.string()),
  sourceSpanIds: v.array(v.string()),
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
  order: v.number(),
  path: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
};

export const listByDocument = query({
  args: { proposalDocumentId: v.id("procurementProposalDocuments") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const document = await ctx.db.get(args.proposalDocumentId);
    if (!document) return [];
    const proposal = await ctx.db.get(document.proposalId);
    if (
      !proposal?.extractionFingerprint ||
      !proposal.extractedOffer ||
      proposal.status === "extracting"
    )
      return [];
    return (
      await ctx.db
        .query("proposalSourceNodes")
        .withIndex("proposal_fingerprint", (q) =>
          q
            .eq("proposalId", document.proposalId)
            .eq("extractionFingerprint", proposal.extractionFingerprint!),
        )
        .collect()
    ).filter((row) => row.proposalDocumentId === args.proposalDocumentId);
  },
});

export const listChildren = query({
  args: {
    proposalDocumentId: v.id("procurementProposalDocuments"),
    parentNodeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const document = await ctx.db.get(args.proposalDocumentId);
    if (!document) return [];
    const proposal = await ctx.db.get(document.proposalId);
    if (
      !proposal?.extractionFingerprint ||
      !proposal.extractedOffer ||
      proposal.status === "extracting"
    )
      return [];
    return (
      await ctx.db
        .query("proposalSourceNodes")
        .withIndex("proposal_fingerprint", (q) =>
          q
            .eq("proposalId", document.proposalId)
            .eq("extractionFingerprint", proposal.extractionFingerprint!),
        )
        .collect()
    ).filter(
      (row) =>
        row.proposalDocumentId === args.proposalDocumentId &&
        row.parentNodeId === args.parentNodeId,
    );
  },
});

export const listByProposalInternal = internalQuery({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) =>
    ctx.db.get(args.proposalId).then((proposal) =>
      proposal?.extractionFingerprint &&
      proposal.extractedOffer &&
      proposal.status !== "extracting"
        ? ctx.db
            .query("proposalSourceNodes")
            .withIndex("proposal_fingerprint", (q) =>
              q
                .eq("proposalId", args.proposalId)
                .eq("extractionFingerprint", proposal.extractionFingerprint!),
            )
            .collect()
        : [],
    ),
});

export const deleteOtherFingerprintsBatch = internalMutation({
  args: {
    proposalId: v.id("procurementProposals"),
    keepFingerprint: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (
      !proposal ||
      proposal.extractionFingerprint !== args.keepFingerprint ||
      proposal.status === "extracting"
    )
      return { deleted: 0, done: true };
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    const rows = await ctx.db
      .query("proposalSourceNodes")
      .withIndex("proposal", (q) => q.eq("proposalId", args.proposalId))
      .filter((q) =>
        q.neq(q.field("extractionFingerprint"), args.keepFingerprint),
      )
      .take(limit);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, done: rows.length < limit };
  },
});

export const insertBatch = internalMutation({
  args: { nodes: v.array(v.object(nodeFields)) },
  handler: async (ctx, args) => {
    for (const node of args.nodes) {
      const existing = await ctx.db
        .query("proposalSourceNodes")
        .withIndex("fingerprint_node", (q) =>
          q
            .eq("proposalId", node.proposalId)
            .eq("extractionFingerprint", node.extractionFingerprint)
            .eq("nodeId", node.nodeId),
        )
        .first();
      if (existing) await ctx.db.patch(existing._id, node);
      else await ctx.db.insert("proposalSourceNodes", node);
    }
    return { inserted: args.nodes.length };
  },
});
