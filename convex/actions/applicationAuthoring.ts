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

// Public wrapper so the broker UI can manually retry the regroup pass.
// Delegates to the internal action after an auth check.
export const regroupAndOrderPublic = action({
  args: { applicationId: v.id("applications") },
  returns: v.object({ groupCount: v.number() }),
  handler: async (ctx, args): Promise<{ groupCount: number }> => {
    await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId: args.applicationId },
    );
    return await ctx.runAction(
      (internal as any).actions.applicationAuthoring.regroupAndOrder,
      { applicationId: args.applicationId },
    ) as { groupCount: number };
  },
});

export const regroupAndOrder = internalAction({
  args: { applicationId: v.id("applications") },
  returns: v.object({ groupCount: v.number() }),
  handler: async (ctx, args): Promise<{ groupCount: number }> => {
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

    const model = getModel("application_authoring");

    // ── Pass -1: prune non-digitizable questions ──
    // Signature fields, broker-only attestations, "date" stamps on a sign-off
    // page etc. shouldn't be digitized. Classify and delete.
    const PRUNE_CHUNK = 40;
    const prunedIds = new Set<string>();
    for (let i = 0; i < questionRows.length; i += PRUNE_CHUNK) {
      const chunk = questionRows.slice(i, i + PRUNE_CHUNK);
      const { output: pruneOutput } = await generateText({
        model,
        maxOutputTokens: 4000,
        output: Output.object({
          schema: z.object({
            verdicts: z.array(
              z.object({
                id: z.string(),
                keep: z.boolean(),
              }),
            ),
          }),
        }),
        prompt: `You are cleaning up an insurance application form so a small-business owner can fill it out digitally. For EACH question, decide whether to keep it.

DROP (keep=false) questions that don't make sense to digitize:
- Signature / "signed by" / initials fields
- Questions asking for the BROKER's name, address, position, or signature (broker details are captured elsewhere)
- Attestation/declaration checkboxes like "Do you declare that all statements are true" or "Do you certify the facts are complete" — these are signature-adjacent legal boilerplate, not real data
- Stand-alone "Date" fields next to a signature area
- "Applicant" as a single field meant for a signature line (not the applicant's name)

KEEP (keep=true) real data-gathering questions about the business, premises, operations, losses, coverage, etc.

QUESTIONS (JSON):
${JSON.stringify(
  chunk.map((q) => ({ id: q._id, prompt: q.prompt, answerType: q.answerType })),
  null,
  2,
)}`,
      });
      for (const v of (pruneOutput!.verdicts as Array<{ id: string; keep: boolean }>)) {
        if (!v.keep) prunedIds.add(String(v.id));
      }
    }

    // Don't prune answered questions — they're already trusted data
    for (const q of questionRows) {
      if (q.existingAnswerId) prunedIds.delete(String(q._id));
    }

    for (const id of prunedIds) {
      await ctx.runMutation((internal as any).applicationQuestionsInternal.deleteQuestion, {
        questionId: id,
      });
    }
    console.log(`regroupAndOrder: pruned ${prunedIds.size} non-digitizable questions`);

    // Filter local working set so downstream passes ignore pruned questions
    const liveQuestionRows = questionRows.filter((q) => !prunedIds.has(String(q._id)));
    if (liveQuestionRows.length === 0) {
      throw new Error("All questions were pruned — nothing left to group");
    }

    // ── Pass 0: rewrite ──
    // Clean up raw extracted prompts into standalone, underwriter-ready questions.
    // Skip rows that already have a rawPrompt (already rewritten) or are answered.
    const REWRITE_CHUNK = 30;
    const toRewrite = liveQuestionRows.filter(
      (q) => !q.existingAnswerId && !(q as any).rawPrompt,
    );
    const rewrites: Record<string, string> = {};
    for (let i = 0; i < toRewrite.length; i += REWRITE_CHUNK) {
      const chunk = toRewrite.slice(i, i + REWRITE_CHUNK).map((q) => ({
        id: q._id,
        prompt: q.prompt,
        answerType: q.answerType,
      }));
      const { output: rewriteOutput } = await generateText({
        model,
        maxOutputTokens: 6000,
        output: Output.object({
          schema: z.object({
            rewrites: z.array(
              z.object({ id: z.string(), prompt: z.string() }),
            ),
          }),
        }),
        prompt: `Rewrite each insurance application question so it reads clearly on its own — no references to earlier questions ("if yes", "same as above"), no abbreviations, and concise. Preserve the original meaning and answer type. Do not combine questions.

QUESTIONS (JSON):
${JSON.stringify(chunk, null, 2)}`,
      });
      for (const r of (rewriteOutput!.rewrites as Array<{ id: string; prompt: string }>)) {
        const trimmed = r.prompt.trim();
        if (trimmed) rewrites[r.id] = trimmed;
      }
    }

    for (const [id, prompt] of Object.entries(rewrites)) {
      await ctx.runMutation((internal as any).applicationQuestionsInternal.rewritePrompt, {
        questionId: id,
        prompt,
      });
    }

    // Apply rewrites locally so downstream passes see the new prompts
    const effectivePrompt = (q: (typeof liveQuestionRows)[number]): string =>
      rewrites[String(q._id)] ?? q.prompt;

    const questionSummary = liveQuestionRows.map((q) => ({
      id: q._id,
      intentKey: q.intentKey,
      prompt: effectivePrompt(q),
      answerType: q.answerType,
      answered: !!q.existingAnswerId,
    }));

    console.log(
      `regroupAndOrder: rewrote ${Object.keys(rewrites).length}/${toRewrite.length} prompts`,
    );

    // ── Pass 1: taxonomy ──
    // Derive 3–7 group titles from just the prompts. Small output, cheap.
    const taxonomyPromptList = liveQuestionRows
      .map((q, i) => `${i + 1}. ${effectivePrompt(q)}`)
      .join("\n");

    const { output: taxonomyOutput } = await generateText({
      model,
      maxOutputTokens: 2000,
      output: Output.object({
        schema: z.object({
          groups: z.array(
            z.object({
              title: z.string(),
              description: z.string().nullable(),
              order: z.number(),
            }),
          ),
        }),
      }),
      prompt: `You are grouping insurance application questions for a SMALL BUSINESS OWNER to fill out — NOT for an underwriter. The client has never seen an insurance form before.

RULES:
- Titles MUST be plain English, friendly, and self-explanatory. Examples of GOOD titles: "About your business", "Where you operate", "What you do day-to-day", "Your team", "Past claims and losses", "Coverage you need", "Vehicles and equipment".
- Examples of BAD titles (do NOT use): "Integration-backed", "Applicant identity", "Passport-backed", "Manual entry", "Risk exposures", "Underwriting factors".
- NEVER mention data sources, integrations, passports, or confidence — the client does not know what those are.
- Group by what the QUESTIONS are about from the client's point of view.
- Order from easiest-to-answer (basic facts about the business) to hardest (detailed history, specifics).
- 3–7 groups total. Titles are 2–5 words.
- Descriptions are a short friendly 1-line explanation of what the client will answer in this section (or null).

Return ONLY the group taxonomy. Do NOT assign questions yet — that happens in a later step.

QUESTIONS:
${taxonomyPromptList}`,
    });

    const taxonomy = (taxonomyOutput!.groups as Array<{ title: string; description: string | null; order: number }>)
      .map((g) => ({ title: g.title, description: g.description ?? undefined, order: g.order }))
      .sort((a, b) => a.order - b.order);

    console.log(
      `regroupAndOrder: taxonomy pass returned ${taxonomy.length} groups for ${liveQuestionRows.length} questions`,
    );
    if (taxonomy.length === 0) {
      throw new Error("Taxonomy pass returned no groups");
    }

    const taxonomySummary = taxonomy
      .map((g) => `- ${g.title}${g.description ? ` — ${g.description}` : ""}`)
      .join("\n");

    // ── Pass 2: assignment (chunked) ──
    // Assign each question to one of the taxonomy titles. Short string output per
    // question keeps payloads small and makes 100+ item sets reliable.
    const CHUNK_SIZE = 40;
    const assignments: Record<string, string> = {};

    for (let i = 0; i < questionSummary.length; i += CHUNK_SIZE) {
      const chunk = questionSummary.slice(i, i + CHUNK_SIZE);
      const { output: assignOutput } = await generateText({
        model,
        maxOutputTokens: 8000,
        output: Output.object({
          schema: z.object({
            assignments: z.array(
              z.object({
                id: z.string(),
                groupTitle: z.string(),
              }),
            ),
          }),
        }),
        prompt: `Assign each question to exactly one group title from the taxonomy. Use the title verbatim.

TAXONOMY:
${taxonomySummary}

QUESTIONS (JSON):
${JSON.stringify(chunk, null, 2)}

Return one assignment per question.`,
      });

      for (const a of (assignOutput!.assignments as Array<{ id: string; groupTitle: string }>)) {
        assignments[a.id] = a.groupTitle;
      }
    }

    // Build GroupingOutput from taxonomy + assignments
    const validTitles = new Set(taxonomy.map((g) => g.title));
    const fallbackTitle = taxonomy[0].title;
    const byTitle = new Map<string, string[]>();
    for (const t of taxonomy) byTitle.set(t.title, []);
    for (const q of liveQuestionRows) {
      const raw = assignments[String(q._id)];
      const title = raw && validTitles.has(raw) ? raw : fallbackTitle;
      byTitle.get(title)!.push(String(q._id));
    }

    const normalizedOutput = {
      groups: taxonomy.map((g) => ({
        title: g.title,
        description: g.description as string | undefined,
        questionIds: byTitle.get(g.title) ?? [],
        order: g.order,
      })),
    };
    const applyResult = applyGroupingOutput(liveQuestionRows as any, normalizedOutput, { existingGroupIdByTitle: existingGroupIdByTitle as any });

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

    console.log(
      `regroupAndOrder: patched ${resolvedPatches.length} questions into ${taxonomy.length} groups (${applyResult.groupInserts.length} new)`,
    );
    return { groupCount: taxonomy.length };
  },
});
