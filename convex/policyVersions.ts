import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getPolicyAccessForQuery } from "./lib/access";
import {
  buildPolicyVersionFieldDiffs,
  buildPolicyVersionSnapshot,
  policyVersionSummary,
} from "./lib/policyVersioning";

const policyVersionKindValidator = v.union(
  v.literal("new_policy"),
  v.literal("policy_change"),
  v.literal("re_extraction"),
  v.literal("renewal"),
);

async function nextVersionNumber(ctx: MutationCtx, policyId: Id<"policies">) {
  const latest = await ctx.db
    .query("policyVersions")
    .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", policyId))
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const access = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!access) return [];
    return await ctx.db
      .query("policyVersions")
      .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", args.policyId))
      .order("desc")
      .collect();
  },
});

export const listByPolicyInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("policyVersions")
      .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", args.policyId))
      .order("desc")
      .collect();
  },
});

export const listForOrgInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
  },
  handler: async (ctx, args) => {
    const rows = args.policyId
      ? await ctx.db
          .query("policyVersions")
          .withIndex("by_policyId_createdAt", (q) => q.eq("policyId", args.policyId!))
          .order("desc")
          .collect()
      : await ctx.db
          .query("policyVersions")
          .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
          .collect();
    return rows
      .filter((row) => row.orgId === args.orgId)
      .sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const getCurrentInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) return null;
    if (policy.currentPolicyVersionId) {
      const current = await ctx.db.get(policy.currentPolicyVersionId);
      if (current) return current;
    }
    return await ctx.db
      .query("policyVersions")
      .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", args.policyId))
      .order("desc")
      .first();
  },
});

export const getByIdInternal = internalQuery({
  args: { id: v.id("policyVersions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const createInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    versionKind: policyVersionKindValidator,
    sourcePolicyFileIds: v.optional(v.array(v.id("policyFiles"))),
    sourceFileIds: v.optional(v.array(v.id("_storage"))),
    caseId: v.optional(v.id("policyChangeCases")),
    extractionRunId: v.optional(v.id("policyExtractionRuns")),
    beforeSnapshot: v.optional(v.any()),
    summary: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) throw new Error("Policy not found");

    const snapshot = buildPolicyVersionSnapshot(policy as unknown as Record<string, unknown>);
    const now = dayjs().valueOf();
    const versionId = await ctx.db.insert("policyVersions", {
      orgId: policy.orgId,
      policyId: args.policyId,
      versionNumber: await nextVersionNumber(ctx, args.policyId),
      versionKind: args.versionKind,
      effectiveDate: policy.effectiveDate,
      expirationDate: policy.expirationDate,
      policyNumber: policy.policyNumber,
      sourcePolicyFileIds: args.sourcePolicyFileIds,
      sourceFileIds: args.sourceFileIds,
      caseId: args.caseId,
      extractionRunId: args.extractionRunId,
      snapshot,
      fieldDiffs: buildPolicyVersionFieldDiffs(args.beforeSnapshot, snapshot),
      summary: args.summary ?? policyVersionSummary(
        policy as unknown as Record<string, unknown>,
        args.versionKind.replace(/_/g, " "),
      ),
      createdByUserId: args.createdByUserId,
      createdAt: now,
    });
    await ctx.db.patch(args.policyId, { currentPolicyVersionId: versionId });
    return versionId;
  },
});

export const ensureInitialInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) throw new Error("Policy not found");
    if (policy.currentPolicyVersionId) {
      const current = await ctx.db.get(policy.currentPolicyVersionId);
      if (current) return current._id;
    }

    const latest = await ctx.db
      .query("policyVersions")
      .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", args.policyId))
      .order("desc")
      .first();
    if (latest) {
      await ctx.db.patch(args.policyId, { currentPolicyVersionId: latest._id });
      return latest._id;
    }

    const now = dayjs().valueOf();
    const snapshot = buildPolicyVersionSnapshot(policy as unknown as Record<string, unknown>);
    const versionId = await ctx.db.insert("policyVersions", {
      orgId: policy.orgId,
      policyId: args.policyId,
      versionNumber: 1,
      versionKind: "new_policy",
      effectiveDate: policy.effectiveDate,
      expirationDate: policy.expirationDate,
      policyNumber: policy.policyNumber,
      sourceFileIds: policy.fileId ? [policy.fileId] : undefined,
      snapshot,
      fieldDiffs: [],
      summary: policyVersionSummary(policy as unknown as Record<string, unknown>, "Initial policy"),
      createdByUserId: args.createdByUserId,
      createdAt: now,
    });
    await ctx.db.patch(args.policyId, { currentPolicyVersionId: versionId });
    return versionId;
  },
});
