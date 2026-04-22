import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireAuth } from "./lib/access";

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
