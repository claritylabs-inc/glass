"use node";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { getModel } from "../lib/models";
import { generateText, Output } from "ai";
import { z } from "zod";
import { applyGroupingOutput } from "../lib/applicationGrouping";

// ── generateQuestionSet ──

export const generateQuestionSet = action({
  args: {
    prompt: v.string(),
    clientOrgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const intents = await ctx.runQuery((api as any).questionIntents.search, {}) as Array<{ intentKey: string; label: string; answerType: string }>;

    const intentSummary = intents
      .map((i) => `${i.intentKey} (${i.label}) — ${i.answerType}`)
      .join("\n");

    const model = getModel("application_authoring");

    const { output } = await generateText({
      model,
      output: Output.object({
        schema: z.object({
          questions: z.array(
            z.object({
              intentKey: z.string().optional(),
              customPrompt: z.string().optional(),
              answerType: z.enum([
                "text", "long_text", "number", "currency", "percent", "date",
                "yes_no", "select", "multi_select", "address", "location_list",
                "subsidiary_list", "loss_list", "file_upload",
              ]),
              required: z.boolean(),
            }),
          ),
        }),
      }),
      prompt: `You are an insurance application designer. Generate a question set for the following application request.
Use intent keys from the catalog when possible. Add custom questions only when the catalog lacks coverage.

BROKER REQUEST:
${args.prompt}

INTENT CATALOG (intentKey — answerType):
${intentSummary}

Return a list of questions. Prefer intentKey references. For custom questions, set customPrompt and answerType but leave intentKey empty.
Keep to 15-30 questions. Focus on what underwriters need for this line of business.`,
    });

    return output!.questions;
  },
});

// ── regroupAndOrder ──

export const regroupAndOrder = internalAction({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery((api as any).applications.get, { applicationId: args.applicationId }) as { groups: Array<{ _id: string; title: string }>; questions: Array<{ _id: string; groupId: string; intentKey?: string; prompt: string; answerType: string; required: boolean; createdAt: number; order: number; applicationId: string }>; answers: Array<{ questionId: string }> } | null;
    if (!data) throw new Error("Application not found");
    const { groups, questions, answers } = data;

    const answeredQuestionIds = new Set(answers.map((a) => String(a.questionId)));

    const questionRows = questions.map((q) => ({
      ...q,
      existingAnswerId: answeredQuestionIds.has(String(q._id)) ? String(q._id) : undefined,
    }));

    const existingGroupIdByTitle = Object.fromEntries(
      groups.map((g) => [g.title, g._id]),
    ) as Record<string, (typeof groups)[0]["_id"]>;

    const questionSummary = questionRows.map((q) => ({
      id: q._id,
      intentKey: q.intentKey,
      prompt: q.prompt,
      answerType: q.answerType,
      category: "(inferred)",
      answered: !!q.existingAnswerId,
    }));

    const model = getModel("application_authoring");
    const { output } = await generateText({
      model,
      output: Output.object({
        schema: z.object({
          groups: z.array(
            z.object({
              title: z.string(),
              description: z.string().optional(),
              questionIds: z.array(z.string()),
              order: z.number(),
            }),
          ),
        }),
      }),
      prompt: `You are an insurance application UX optimizer. Group and order the following questions to minimize client friction.

RULES:
1. Group questions by data source: questions answerable from integration/passport data first, then manual.
2. Order groups easiest-first (integration-backed > passport-backed > manual).
3. Within each group, put dependency questions last.
4. Questions marked answered=true MUST stay in their current groups — do not move them.
5. Aim for 3-7 groups.

QUESTIONS (JSON):
${JSON.stringify(questionSummary, null, 2)}

Return the groups with their question IDs ordered as you prescribe.`,
    });

    // Normalize description: zod optional → required undefined for GroupingOutput
    const normalizedOutput = {
      groups: (output!.groups as Array<{ title: string; description?: string; questionIds: string[]; order: number }>).map((g) => ({
        title: g.title,
        description: g.description as string | undefined,
        questionIds: g.questionIds,
        order: g.order,
      })),
    };
    const applyResult = applyGroupingOutput(questionRows as any, normalizedOutput, { existingGroupIdByTitle: existingGroupIdByTitle as any });

    // Insert new groups and collect their IDs
    const newGroupIdByTitle: Record<string, (typeof questions)[0]["groupId"]> = {};
    for (const g of applyResult.groupInserts) {
      const newId = await ctx.runMutation((internal as any).applicationGroupsMutationsInternal.insert, {
        applicationId: args.applicationId,
        title: g.title,
        description: g.description,
        order: g.order,
      });
      newGroupIdByTitle[g.title] = newId;
    }

    // Resolve sentinel IDs
    const resolvedPatches = applyResult.questionPatches.map((p) => {
      const groupId = String(p.groupId).startsWith("new:")
        ? newGroupIdByTitle[String(p.groupId).slice(4)]
        : p.groupId;
      return { id: p.id, groupId, order: p.order };
    });

    for (const patch of resolvedPatches) {
      await ctx.runMutation((internal as any).applicationQuestionsInternal.patch, {
        questionId: patch.id,
        groupId: patch.groupId,
        order: patch.order,
      });
    }
  },
});
