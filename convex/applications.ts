import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  assertCanCreateApplication,
  assertCanEditApplicationDraft,
  assertCanSendApplication,
} from "./lib/applicationCapabilities";
import { requireOrgAccess } from "./lib/orgAuth";
import { deriveApplicationStatus } from "./lib/applicationDerivation";
import { internal } from "./_generated/api";

export const listForClient = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    if (access.orgId !== args.clientOrgId) throw new Error("Forbidden");
    return await ctx.db
      .query("applications")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
      .collect();
  },
});

export const listForBroker = query({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.optional(v.id("organizations")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    if (access.orgId !== args.brokerOrgId) throw new Error("Forbidden");
    let apps = await ctx.db
      .query("applications")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", args.brokerOrgId))
      .collect();
    if (args.clientOrgId) apps = apps.filter((a) => a.clientOrgId === args.clientOrgId);
    if (args.status) apps = apps.filter((a) => a.status === args.status);
    return apps;
  },
});

export const get = query({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    const app = await ctx.db.get(args.applicationId);
    if (!app) return null;
    if (app.brokerOrgId !== access.orgId && app.clientOrgId !== access.orgId) {
      throw new Error("Forbidden");
    }

    const groups = await ctx.db
      .query("applicationGroups")
      .withIndex("by_applicationId_order", (q) => q.eq("applicationId", args.applicationId))
      .collect();

    const questions = await ctx.db
      .query("applicationQuestions")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();

    const answers = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();

    const flags = await ctx.db
      .query("applicationQuestionFlags")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();

    return { app, groups, questions, answers, flags };
  },
});

export const createDraft = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    creationPath: v.union(v.literal("custom"), v.literal("ai"), v.literal("template")),
    title: v.string(),
    lineOfBusiness: v.optional(v.string()),
    aiGenerationPrompt: v.optional(v.string()),
    sourceTemplateId: v.optional(v.id("applicationTemplates")),
  },
  handler: async (ctx, args) => {
    const access = await assertCanCreateApplication(ctx, args.clientOrgId);
    const now = Date.now();
    const applicationId = await ctx.db.insert("applications", {
      brokerOrgId: access.orgId,
      clientOrgId: args.clientOrgId,
      createdByUserId: access.userId,
      creationPath: args.creationPath,
      title: args.title,
      lineOfBusiness: args.lineOfBusiness,
      aiGenerationPrompt: args.aiGenerationPrompt,
      sourceTemplateId: args.sourceTemplateId,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    return applicationId;
  },
});

export const addQuestion = mutation({
  args: {
    applicationId: v.id("applications"),
    intentKey: v.optional(v.string()),
    prompt: v.string(),
    answerType: v.string(),
    required: v.boolean(),
    selectOptions: v.optional(v.array(v.object({ value: v.string(), label: v.string() }))),
    conditional: v.optional(v.any()),
    helpText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertCanEditApplicationDraft(ctx, args.applicationId);
    const existing = await ctx.db
      .query("applicationQuestions")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();
    const order = existing.length;
    let groupId = existing[0]?.groupId;
    if (!groupId) {
      groupId = await ctx.db.insert("applicationGroups", {
        applicationId: args.applicationId,
        order: 0,
        title: "Ungrouped",
        status: "not_started",
      });
    }
    const questionId = await ctx.db.insert("applicationQuestions", {
      applicationId: args.applicationId,
      groupId,
      order,
      intentKey: args.intentKey,
      prompt: args.prompt,
      answerType: args.answerType,
      required: args.required,
      selectOptions: args.selectOptions,
      conditional: args.conditional,
      helpText: args.helpText,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.applicationId, { updatedAt: Date.now() });
    return questionId;
  },
});

export const removeQuestion = mutation({
  args: { applicationId: v.id("applications"), questionId: v.id("applicationQuestions") },
  handler: async (ctx, args) => {
    await assertCanEditApplicationDraft(ctx, args.applicationId);
    const q = await ctx.db.get(args.questionId);
    if (!q || q.applicationId !== args.applicationId) throw new Error("Question not found");
    await ctx.db.delete(args.questionId);
    await ctx.db.patch(args.applicationId, { updatedAt: Date.now() });
  },
});

export const updateQuestion = mutation({
  args: {
    applicationId: v.id("applications"),
    questionId: v.id("applicationQuestions"),
    prompt: v.optional(v.string()),
    required: v.optional(v.boolean()),
    helpText: v.optional(v.string()),
    conditional: v.optional(v.any()),
    binding: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await assertCanEditApplicationDraft(ctx, args.applicationId);
    const { questionId, applicationId: _aid, ...patch } = args;
    const filtered: Record<string, unknown> = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(questionId, filtered as any);
    await ctx.db.patch(args.applicationId, { updatedAt: Date.now() });
  },
});

export const send = mutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    await assertCanSendApplication(ctx, args.applicationId);
    await ctx.db.patch(args.applicationId, {
      status: "sent",
      sentAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Trigger AI grouping + ordering
    await ctx.scheduler.runAfter(0, (internal as any).actions.applicationAuthoring.regroupAndOrder, {
      applicationId: args.applicationId,
    });
  },
});

export const cancel = mutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    const app = await ctx.db.get(args.applicationId);
    if (!app || app.brokerOrgId !== access.orgId) throw new Error("Forbidden");
    await ctx.db.patch(args.applicationId, { status: "cancelled", updatedAt: Date.now() });
  },
});

/** Recompute and persist application status from group statuses. Called after any group state change. */
export const recomputeStatus = mutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const app = await ctx.db.get(args.applicationId);
    if (!app || app.status === "cancelled" || app.status === "draft") return;
    const groups = await ctx.db
      .query("applicationGroups")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();
    const derived = deriveApplicationStatus(
      groups.map((g) => g.status) as Parameters<typeof deriveApplicationStatus>[0],
    );
    const now = Date.now();
    const patch: Record<string, unknown> = { status: derived, updatedAt: now };
    if (derived === "complete") patch.completedAt = now;
    await ctx.db.patch(args.applicationId, patch as any);

    // Trigger filled PDF generation for template-derived apps on completion
    if (derived === "complete" && app.sourceTemplateId) {
      const template = await ctx.db.get(app.sourceTemplateId);
      if (template?.sourcePdfStorageId) {
        await ctx.scheduler.runAfter(0, (internal as any).actions.applicationOutput.generateFilledPdf, {
          applicationId: args.applicationId,
        });
      }
    }
  },
});

export const cloneTemplateQuestions = mutation({
  args: {
    applicationId: v.id("applications"),
    templateId: v.id("applicationTemplates"),
  },
  handler: async (ctx, args) => {
    await assertCanEditApplicationDraft(ctx, args.applicationId);
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    const app = await ctx.db.get(args.applicationId);
    if (!app) throw new Error("Application not found");

    // Ensure no questions already exist (idempotent guard)
    const existing = await ctx.db
      .query("applicationQuestions")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();
    if (existing.length > 0) throw new Error("Questions already loaded for this application");

    // Create a single placeholder group; AI will regroup on send
    const groupId = await ctx.db.insert("applicationGroups", {
      applicationId: args.applicationId,
      order: 0,
      title: "Template Questions",
      status: "not_started",
    });

    const now = Date.now();
    for (let i = 0; i < template.questionSet.length; i++) {
      const item = template.questionSet[i];
      let prompt = item.promptOverride ?? "";
      let answerType = "text";
      if (item.intentKey) {
        const intent = await ctx.db
          .query("questionIntents")
          .withIndex("by_intentKey", (q) => q.eq("intentKey", item.intentKey!))
          .first();
        if (intent) {
          prompt = item.promptOverride ?? intent.defaultPrompt;
          answerType = intent.answerType;
        }
      }
      await ctx.db.insert("applicationQuestions", {
        applicationId: args.applicationId,
        groupId,
        order: i,
        intentKey: item.intentKey,
        prompt,
        answerType,
        required: item.required,
        conditional: item.conditional,
        createdAt: now,
      });
    }
    await ctx.db.patch(args.applicationId, {
      sourceTemplateId: args.templateId,
      updatedAt: now,
    });
  },
});
