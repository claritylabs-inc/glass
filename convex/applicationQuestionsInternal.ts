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
    groupId: v.id("applicationGroups"),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.questionId, {
      groupId: args.groupId,
      order: args.order,
      placedByAi: true,
    });
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
