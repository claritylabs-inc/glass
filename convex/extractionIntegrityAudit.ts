import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

const MAX_PAGE_SIZE = 25;

function pageSize(value: number | undefined) {
  return Math.max(1, Math.min(Math.floor(value ?? MAX_PAGE_SIZE), MAX_PAGE_SIZE));
}

export const listPoliciesPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("policies").order("asc").paginate({
      cursor: args.cursor,
      numItems: pageSize(args.limit),
    });
    const policies = await Promise.all(result.page
      .filter((policy) => policy.extractionDataStage === "final")
      .map(async (policy) => {
        const run = await ctx.db
          .query("policyExtractionRuns")
          .withIndex("by_policyId", (q) => q.eq("policyId", policy._id))
          .first();
        return { policy, run };
      }));
    return { ...result, page: policies };
  },
});

export const listSourceSpansPageInternal = internalQuery({
  args: {
    policyId: v.id("policies"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sourceSpans")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .paginate({ cursor: args.cursor, numItems: 200 });
  },
});

export const listSourceNodesPageInternal = internalQuery({
  args: {
    policyId: v.id("policies"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sourceNodes")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .paginate({ cursor: args.cursor, numItems: 200 });
  },
});

export const getQueueCandidateInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || policy.extractionDataStage !== "final" || !policy.fileId) return null;
    const run = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .first();
    return {
      policyId: policy._id,
      pipelineStatus: run?.pipelineStatus ?? policy.pipelineStatus,
    };
  },
});
