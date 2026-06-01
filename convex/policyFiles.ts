import dayjs from "dayjs";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { makePipelineMutations } from "./lib/pipelineMutations";

export const listByPolicyInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("policyFiles")
      .withIndex("by_policyId", (idx) => idx.eq("policyId", args.policyId))
      .collect();
  },
});

export const insert = internalMutation({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    emailId: v.optional(v.id("emails")),
    fileName: v.string(),
    fileType: v.union(
      v.literal("declaration"),
      v.literal("wording"),
      v.literal("endorsement"),
      v.literal("schedule"),
      v.literal("renewal"),
      v.literal("certificate"),
      v.literal("unknown"),
    ),
    extractedData: v.optional(v.any()),
    pageCount: v.optional(v.number()),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("policyFiles", {
      ...args,
      createdAt: dayjs().valueOf(),
    });
  },
});

export const updateExtraction = internalMutation({
  args: {
    id: v.id("policyFiles"),
    extractedData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const appendExtractionLog = internalMutation({
  args: {
    id: v.id("policyFiles"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.id);
    if (!file) return;
    const log = file.pipelineLog ?? [];
    log.push({ timestamp: dayjs().valueOf(), message: args.message });
    await ctx.db.patch(args.id, { pipelineLog: log });
  },
});

export const remove = internalMutation({
  args: { id: v.id("policyFiles") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const reassignToPolicy = internalMutation({
  args: {
    id: v.id("policyFiles"),
    newPolicyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { policyId: args.newPolicyId });
  },
});

// ── cl-pipelines contract mutations for policyFiles ────────────────────────────
const _policyFilesPipeline = makePipelineMutations("policyFiles");
export const pipelineGetJob = _policyFilesPipeline.getJob;
export const pipelineSetStatus = _policyFilesPipeline.setStatus;
export const pipelineSetCheckpoint = _policyFilesPipeline.setCheckpoint;
export const pipelineAppendLog = _policyFilesPipeline.appendLog;
export const pipelineClearLog = _policyFilesPipeline.clearLog;
