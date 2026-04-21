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
