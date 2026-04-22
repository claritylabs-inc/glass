"use node";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "../lib/models";
import { makeEmbedText } from "../lib/sdkCallbacks";

type PassportBundle = {
  passport: Record<string, unknown> | null;
  locations: Array<Record<string, unknown>>;
  subsidiaries: Array<Record<string, unknown>>;
  priorCarriers: Array<Record<string, unknown>>;
  losses: Array<Record<string, unknown>>;
  additionalInterests: Array<Record<string, unknown>>;
};

// Flatten the passport bundle into a labeled fact list the LLM can read directly.
function serializePassport(bundle: PassportBundle): string {
  const lines: string[] = [];
  const p = bundle.passport ?? {};
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "object") {
      const rendered = Object.entries(value)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (rendered) lines.push(`- ${label}: ${rendered}`);
    } else {
      lines.push(`- ${label}: ${value}`);
    }
  };
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith("_") || ["clientOrgId", "lastEditedAt", "lastEditedBy", "coreCompletedAt"].includes(k)) continue;
    push(k, v);
  }
  bundle.locations.forEach((loc, i) =>
    push(`location_${i + 1}`, loc),
  );
  bundle.subsidiaries.forEach((s, i) => push(`subsidiary_${i + 1}`, s));
  bundle.priorCarriers.forEach((c, i) => push(`prior_carrier_${i + 1}`, c));
  bundle.losses.forEach((l, i) => push(`loss_${i + 1}`, l));
  bundle.additionalInterests.forEach((a, i) => push(`additional_interest_${i + 1}`, a));
  return lines.join("\n");
}

export const prefillFromIntelligence = action({
  args: { applicationId: v.id("applications") },
  returns: v.object({ filledCount: v.number(), skippedCount: v.number() }),
  handler: async (ctx, args): Promise<{ filledCount: number; skippedCount: number }> => {
    await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId: args.applicationId },
    );

    const data = await ctx.runQuery((api as any).applications.get, {
      applicationId: args.applicationId,
    }) as {
      app: { clientOrgId: string };
      questions: Array<{ _id: string; prompt: string; answerType: string }>;
      answers: Array<{ questionId: string; source: string }>;
    };

    const manuallyAnsweredIds = new Set(
      data.answers.filter((a) => a.source === "manual").map((a) => String(a.questionId)),
    );
    const targets = data.questions.filter((q) => !manuallyAnsweredIds.has(String(q._id)));
    if (targets.length === 0) return { filledCount: 0, skippedCount: 0 };

    const passportBundle = await ctx.runQuery(
      (internal as any).clientPassport.getFullInternal,
      { clientOrgId: data.app.clientOrgId },
    ) as PassportBundle;
    const passportFacts = serializePassport(passportBundle);

    const embed = makeEmbedText();
    const model = getModel("application_authoring");

    let filledCount = 0;
    let skippedCount = 0;

    const CHUNK = 10;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);

      // Per-question vector search against orgIntelligence
      const questionContexts = await Promise.all(
        chunk.map(async (q) => {
          const vec = await embed(q.prompt);
          const matches = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: vec,
            limit: 5,
            filter: (f) => f.eq("orgId", data.app.clientOrgId as any),
          });
          const ids = matches.map((m) => m._id);
          const hydrated = ids.length
            ? (await ctx.runQuery((internal as any).intelligence.hydrateSearchResults, {
                ids,
              })) as Array<{ category: string; content: string; sourceLabel?: string }>
            : [];
          const facts = hydrated
            .map((e) => `- [${e.category}] ${e.content}${e.sourceLabel ? ` (source: ${e.sourceLabel})` : ""}`)
            .join("\n");
          return { q, facts };
        }),
      );

      const { output } = await generateText({
        model,
        maxOutputTokens: 4000,
        output: Output.object({
          schema: z.object({
            answers: z.array(
              z.object({
                id: z.string(),
                value: z.string().nullable(),
                confidence: z.enum(["high", "medium", "low"]),
                sourceLabel: z.string().nullable(),
              }),
            ),
          }),
        }),
        prompt: `You are prefilling an insurance application from known company facts. Be HELPFUL — if the facts reasonably support an answer, provide it. Only return null when the facts truly say nothing relevant. A human broker will review every prefill, so a reasonable-but-imperfect answer is much more useful than a null.

RULES:
- Prefer passport facts over intelligence snippets when both are available.
- Return ONLY the raw value (no commentary, no "According to…").
- For yes/no questions, return "yes" or "no" when the facts clearly lean one way. If the facts don't mention the risk at all, a "no" is often appropriate for questions about unusual exposures (foreign ops, hazardous materials, etc.) — use judgment.
- For numbers or currency, return the number as a string (no units unless the question asks).
- confidence: "high" = directly stated in facts; "medium" = reasonable inference; "low" = weak but plausible guess.
- Return null ONLY when you truly cannot answer.
- sourceLabel is a short human-readable pointer (e.g. "passport: legalName", or an intelligence category).

PASSPORT FACTS:
${passportFacts || "(none)"}

QUESTIONS:
${questionContexts
  .map(
    ({ q, facts }) =>
      `ID: ${q._id}\nType: ${q.answerType}\nQ: ${q.prompt}\nRelevant intelligence:\n${facts || "(none)"}`,
  )
  .join("\n\n")}`,
      });

      for (const a of (output!.answers as Array<{ id: string; value: string | null; confidence: string; sourceLabel: string | null }>)) {
        if (!a.value) {
          skippedCount++;
          continue;
        }
        await ctx.runMutation(
          (internal as any).applicationAnswers.upsertPrefill,
          {
            applicationId: args.applicationId,
            questionId: a.id,
            value: a.value,
            sourceRef: a.sourceLabel ?? undefined,
          },
        );
        filledCount++;
      }
    }

    return { filledCount, skippedCount };
  },
});
