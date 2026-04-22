import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireAuth } from "./lib/access";
import type { PipelineStatus } from "@claritylabs/cl-pipelines";

// Internal query used by Node actions to authorize a caller as a broker-org
// member for a given application. Actions don't have ctx.db, so this runs in
// a query. Keys off app.brokerOrgId (always set at createDraft) rather than
// the client org's brokerOrgId (which may be unset on seed/legacy orgs).
export const requireBrokerAccessForApplication = internalQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const app = await ctx.db.get(args.applicationId);
    if (!app) throw new Error("Application not found");
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", app.brokerOrgId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new Error("Broker access required for this application");
    return {
      userId,
      brokerOrgId: app.brokerOrgId,
      clientOrgId: app.clientOrgId,
    };
  },
});

export const requireBrokerAccessForClient = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const clientOrg = await ctx.db.get(args.clientOrgId);
    if (!clientOrg) throw new Error("Client org not found");
    const brokerOrgId = clientOrg.brokerOrgId;
    if (!brokerOrgId) throw new Error("Client org has no broker");
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", brokerOrgId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new Error("Broker access required for this client");
    return { userId, brokerOrgId };
  },
});

// Internal mutation to create a draft application without requiring an auth session.
// Used by extractApplicationPdf action (which runs in the Convex internal action runtime).
export const patchDraftMetaInternal = internalMutation({
  args: {
    applicationId: v.id("applications"),
    title: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const t = args.title.trim();
      if (t) patch.title = t;
    }
    if (args.lineOfBusiness !== undefined) {
      const l = args.lineOfBusiness.trim();
      if (l) patch.lineOfBusiness = l;
    }
    await ctx.db.patch(args.applicationId, patch as any);
  },
});

export const deleteDraftInternal = internalMutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const app = await ctx.db.get(args.applicationId);
    if (!app) return;
    const [flags, answers, questions, groups] = await Promise.all([
      ctx.db
        .query("applicationQuestionFlags")
        .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
        .collect(),
      ctx.db
        .query("applicationAnswers")
        .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
        .collect(),
      ctx.db
        .query("applicationQuestions")
        .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
        .collect(),
      ctx.db
        .query("applicationGroups")
        .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
        .collect(),
    ]);
    for (const f of flags) await ctx.db.delete(f._id);
    for (const a of answers) await ctx.db.delete(a._id);
    for (const q of questions) await ctx.db.delete(q._id);
    for (const g of groups) await ctx.db.delete(g._id);
    await ctx.db.delete(args.applicationId);
  },
});

export const createDraftInternal = internalMutation({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    createdByUserId: v.id("users"),
    creationPath: v.union(v.literal("ai"), v.literal("extracted_pdf")),
    title: v.string(),
    lineOfBusiness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("applications", {
      brokerOrgId: args.brokerOrgId,
      clientOrgId: args.clientOrgId,
      createdByUserId: args.createdByUserId,
      creationPath: args.creationPath,
      title: args.title,
      lineOfBusiness: args.lineOfBusiness,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Internal query to also retrieve application data (used by pipeline entry points).
export const getInternal = internalQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.applicationId);
  },
});

// ─── cl-pipelines CONTRACT FUNCTIONS ──────────────────────────────────────────
// These five functions implement the ConvexPipelineMutations contract required
// by @claritylabs/cl-pipelines/convex adapters.

export const getJob = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const doc = await ctx.db
      .query("applications")
      .filter((q) => q.eq(q.field("_id"), jobId))
      .first();
    if (!doc) return null;
    return {
      status: (doc.pipelineStatus ?? "idle") as PipelineStatus,
      checkpoint: doc.pipelineCheckpoint ?? null,
      error: doc.pipelineError,
    };
  },
});

export const setStatus = internalMutation({
  args: {
    jobId: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("complete"),
      v.literal("error"),
    ),
    // null means "clear the error" — do NOT use v.optional here, as that
    // would allow the adapter to omit the field and leave a stale error.
    error: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { jobId, status, error }) => {
    await ctx.db.patch(jobId as any, {
      pipelineStatus: status,
      pipelineError: error ?? undefined, // clears on null
    });
  },
});

export const setCheckpoint = internalMutation({
  args: { jobId: v.string(), checkpoint: v.optional(v.any()) },
  handler: async (ctx, { jobId, checkpoint }) => {
    await ctx.db.patch(jobId as any, {
      pipelineCheckpoint: checkpoint ?? undefined,
    });
  },
});

export const appendLog = internalMutation({
  args: {
    jobId: v.string(),
    timestamp: v.number(),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, timestamp, message, phase, level }) => {
    const doc = await ctx.db.get(jobId as any as import("./_generated/dataModel").Id<"applications">);
    if (!doc) return;
    const log = doc.pipelineLog ?? [];
    await ctx.db.patch(jobId as any, {
      pipelineLog: [...log, { timestamp, message, phase, level }],
    });
  },
});

export const clearLog = internalMutation({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    await ctx.db.patch(jobId as any, { pipelineLog: [] });
  },
});
