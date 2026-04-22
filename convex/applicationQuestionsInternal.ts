import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Bulk insert questions into a newly created application.
// Caller must already have a valid applicationId.
// Creates a placeholder "Extracted" group if needed.
export const bulkInsert = internalMutation({
  args: {
    applicationId: v.id("applications"),
    questions: v.array(v.object({
      intentKey: v.union(v.string(), v.null()),
      prompt: v.string(),
      answerType: v.string(),
      pdfFieldName: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Create a single placeholder group
    const groupId = await ctx.db.insert("applicationGroups", {
      applicationId: args.applicationId,
      order: 0,
      title: "Extracted Questions",
      status: "not_started",
    });

    for (let i = 0; i < args.questions.length; i++) {
      const q = args.questions[i];
      await ctx.db.insert("applicationQuestions", {
        applicationId: args.applicationId,
        groupId,
        order: i,
        intentKey: q.intentKey ?? undefined,
        prompt: q.prompt,
        answerType: q.answerType,
        required: false,
        placedByAi: false,
        createdAt: now,
      });
    }
    return groupId;
  },
});

export const patch = internalMutation({
  args: {
    questionId: v.id("applicationQuestions"),
    groupId: v.optional(v.id("applicationGroups")),
    order: v.optional(v.number()),
    prompt: v.optional(v.string()),
    repeating: v.optional(v.object({
      collectionKey: v.string(),
      itemLabel: v.string(),
      dependsOnQuestionId: v.optional(v.id("applicationQuestions")),
      minItems: v.optional(v.number()),
      maxItems: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { placedByAi: true };
    if (args.groupId !== undefined) patch.groupId = args.groupId;
    if (args.order !== undefined) patch.order = args.order;
    if (args.prompt !== undefined) patch.prompt = args.prompt;
    if (args.repeating !== undefined) patch.repeating = args.repeating;
    await ctx.db.patch(args.questionId, patch as any);
  },
});

// Delete a question and any dependent answers/flags. Used by AI cleanup
// to prune non-digitizable fields (signatures, broker-only fields, dates, etc).
export const deleteQuestion = internalMutation({
  args: { questionId: v.id("applicationQuestions") },
  handler: async (ctx, args) => {
    const q = await ctx.db.get(args.questionId);
    if (!q) return;
    const answers = await ctx.db
      .query("applicationAnswers")
      .withIndex("by_questionId", (idx) => idx.eq("questionId", args.questionId))
      .collect();
    for (const a of answers) await ctx.db.delete(a._id);
    const flags = await ctx.db
      .query("applicationQuestionFlags")
      .withIndex("by_questionId", (idx) => idx.eq("questionId", args.questionId))
      .collect();
    for (const f of flags) await ctx.db.delete(f._id);
    await ctx.db.delete(args.questionId);
  },
});

export const deleteQuestions = internalMutation({
  args: { questionIds: v.array(v.id("applicationQuestions")) },
  handler: async (ctx, args) => {
    for (const questionId of args.questionIds) {
      const q = await ctx.db.get(questionId);
      if (!q) continue;
      const answers = await ctx.db
        .query("applicationAnswers")
        .withIndex("by_questionId", (idx) => idx.eq("questionId", questionId))
        .collect();
      for (const a of answers) await ctx.db.delete(a._id);
      const flags = await ctx.db
        .query("applicationQuestionFlags")
        .withIndex("by_questionId", (idx) => idx.eq("questionId", questionId))
        .collect();
      for (const f of flags) await ctx.db.delete(f._id);
      await ctx.db.delete(questionId);
    }
  },
});

// Rewrite a question's prompt. Preserves the original in rawPrompt on first rewrite.
export const rewritePrompt = internalMutation({
  args: {
    questionId: v.id("applicationQuestions"),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.questionId);
    if (!existing) return;
    const patch: Record<string, unknown> = { prompt: args.prompt };
    if (!existing.rawPrompt) patch.rawPrompt = existing.prompt;
    await ctx.db.patch(args.questionId, patch as any);
  },
});

export const rewritePrompts = internalMutation({
  args: {
    rewrites: v.array(v.object({
      questionId: v.id("applicationQuestions"),
      prompt: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    for (const rewrite of args.rewrites) {
      const existing = await ctx.db.get(rewrite.questionId);
      if (!existing) continue;
      const patch: Record<string, unknown> = { prompt: rewrite.prompt };
      if (!existing.rawPrompt) patch.rawPrompt = existing.prompt;
      await ctx.db.patch(rewrite.questionId, patch as any);
    }
  },
});

export const patchMany = internalMutation({
  args: {
    patches: v.array(v.object({
      questionId: v.id("applicationQuestions"),
      groupId: v.optional(v.id("applicationGroups")),
      order: v.optional(v.number()),
      prompt: v.optional(v.string()),
      repeating: v.optional(v.object({
        collectionKey: v.string(),
        itemLabel: v.string(),
        dependsOnQuestionId: v.optional(v.id("applicationQuestions")),
        minItems: v.optional(v.number()),
        maxItems: v.optional(v.number()),
      })),
    })),
  },
  handler: async (ctx, args) => {
    for (const item of args.patches) {
      const patch: Record<string, unknown> = { placedByAi: true };
      if (item.groupId !== undefined) patch.groupId = item.groupId;
      if (item.order !== undefined) patch.order = item.order;
      if (item.prompt !== undefined) patch.prompt = item.prompt;
      if (item.repeating !== undefined) patch.repeating = item.repeating;
      await ctx.db.patch(item.questionId, patch as any);
    }
  },
});
