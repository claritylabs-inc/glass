import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";

const spanFields = {
  orgId: v.id("organizations"),
  proposalId: v.id("procurementProposals"),
  proposalDocumentId: v.id("procurementProposalDocuments"),
  extractionFingerprint: v.string(),
  documentId: v.string(),
  spanId: v.string(),
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
  text: v.string(),
  textHash: v.string(),
  bbox: v.optional(v.any()),
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
    if (!proposal?.extractionFingerprint || !proposal.extractedOffer || proposal.status === "extracting") return [];
    return (await ctx.db
      .query("proposalSourceSpans")
      .withIndex("proposal_fingerprint", (q) =>
        q.eq("proposalId", document.proposalId)
          .eq("extractionFingerprint", proposal.extractionFingerprint!),
      )
      .collect()).filter((row) => row.proposalDocumentId === args.proposalDocumentId);
  },
});

export const listByProposalAndSpanIds = query({
  args: {
    proposalId: v.id("procurementProposals"),
    spanIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal?.extractionFingerprint || !proposal.extractedOffer || proposal.status === "extracting") return [];
    const wanted = [...new Set(args.spanIds)].slice(0, 256);
    return (await Promise.all(wanted.map((spanId) =>
      ctx.db
        .query("proposalSourceSpans")
        .withIndex("fingerprint_span", (q) =>
          q.eq("proposalId", args.proposalId)
            .eq("extractionFingerprint", proposal.extractionFingerprint!)
            .eq("spanId", spanId),
        )
        .first()
    ))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  },
});

export const listByProposalInternal = internalQuery({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => ctx.db
    .get(args.proposalId)
    .then((proposal) => proposal?.extractionFingerprint && proposal.extractedOffer && proposal.status !== "extracting"
      ? ctx.db.query("proposalSourceSpans").withIndex("proposal_fingerprint", (q) =>
          q.eq("proposalId", args.proposalId)
            .eq("extractionFingerprint", proposal.extractionFingerprint!),
        ).collect()
      : []),
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
    ) return { deleted: 0, done: true };
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    const rows = await ctx.db
      .query("proposalSourceSpans")
      .withIndex("proposal", (q) => q.eq("proposalId", args.proposalId))
      .filter((q) => q.neq(q.field("extractionFingerprint"), args.keepFingerprint))
      .take(limit);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, done: rows.length < limit };
  },
});

export const insertBatch = internalMutation({
  args: { spans: v.array(v.object(spanFields)) },
  handler: async (ctx, args) => {
    for (const span of args.spans) {
      const existing = await ctx.db.query("proposalSourceSpans")
        .withIndex("fingerprint_span", (q) =>
          q.eq("proposalId", span.proposalId)
            .eq("extractionFingerprint", span.extractionFingerprint)
            .eq("spanId", span.spanId),
        )
        .first();
      if (existing) await ctx.db.patch(existing._id, span);
      else await ctx.db.insert("proposalSourceSpans", span);
    }
    return { inserted: args.spans.length };
  },
});
