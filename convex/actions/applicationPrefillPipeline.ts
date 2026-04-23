"use node";

/**
 * Application Prefill Pipeline
 *
 * Runs as a cl-pipelines phase-runner against the applications table using the
 * "prefill*" field prefix (prefillStatus, prefillCheckpoint, prefillLog, prefillError).
 *
 * Single-phase design: one "prefill" phase that loops question chunks with
 * chunkIndex checkpointing so it can resume after interruption.
 */

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { advancePhase, runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { Phase, PhaseResult } from "@claritylabs/cl-pipelines";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "../lib/models";
import { makeEmbedText } from "../lib/sdkCallbacks";
import type { ActionCtx } from "../_generated/server";

// ─── Passport serialisation (same logic as applicationPrefill.ts) ──────────────

type PassportBundle = {
  passport: Record<string, unknown> | null;
  locations: Array<Record<string, unknown>>;
  subsidiaries: Array<Record<string, unknown>>;
  priorCarriers: Array<Record<string, unknown>>;
  losses: Array<Record<string, unknown>>;
  additionalInterests: Array<Record<string, unknown>>;
};

function serializePassport(bundle: PassportBundle): string {
  const lines: string[] = [];
  const p = bundle.passport ?? {};
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "object") {
      const rendered = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (rendered) lines.push(`- ${label}: ${rendered}`);
    } else {
      lines.push(`- ${label}: ${value}`);
    }
  };
  for (const [k, v] of Object.entries(p)) {
    if (
      k.startsWith("_") ||
      ["clientOrgId", "lastEditedAt", "lastEditedBy", "coreCompletedAt"].includes(k)
    )
      continue;
    push(k, v);
  }
  bundle.locations.forEach((loc, i) => push(`location_${i + 1}`, loc));
  bundle.subsidiaries.forEach((s, i) => push(`subsidiary_${i + 1}`, s));
  bundle.priorCarriers.forEach((c, i) => push(`prior_carrier_${i + 1}`, c));
  bundle.losses.forEach((l, i) => push(`loss_${i + 1}`, l));
  bundle.additionalInterests.forEach((a, i) =>
    push(`additional_interest_${i + 1}`, a),
  );
  return lines.join("\n");
}

// ─── State type ────────────────────────────────────────────────────────────────

export type ApplicationPrefillState = {
  applicationId: string;
  orgId: string;
  // Snapshot of question IDs + data at prepare time
  questionIds: string[];
  questions: Array<{ _id: string; prompt: string; answerType: string }>;
  passportFacts: string;
  // Preserved through chunks
  embeddings: number[][];
  // Next chunk index to process
  chunkIndex: number;
  filledCount: number;
  skippedCount: number;
};

// ─── Mutations ref ─────────────────────────────────────────────────────────────

function makePrefillMutations() {
  return {
    getJob: internal.applicationsInternal.prefillGetJob,
    setStatus: internal.applicationsInternal.prefillSetStatus,
    setCheckpoint: internal.applicationsInternal.prefillSetCheckpoint,
    appendLog: internal.applicationsInternal.prefillAppendLog,
    clearLog: internal.applicationsInternal.prefillClearLog,
  };
}

// ─── Phase ─────────────────────────────────────────────────────────────────────

const CHUNK = 10;

function makePhases(convexCtx: ActionCtx): Phase<ApplicationPrefillState>[] {
  const prefillPhase: Phase<ApplicationPrefillState> = {
    name: "prefill",
    run: async (pCtx): Promise<PhaseResult<ApplicationPrefillState>> => {
      const { state } = pCtx.checkpoint;
      const { applicationId, orgId, questions, passportFacts } = state;
      let { embeddings, chunkIndex, filledCount, skippedCount } = state;

      const embed = makeEmbedText();

      // ── Prepare: embed all questions up front on first entry ─────────────────
      if (embeddings.length === 0) {
        await pCtx.log(`Preparing ${questions.length} questions…`);
        embeddings = await Promise.all(questions.map((q) => embed(q.prompt)));
        await pCtx.log(`Embedded ${questions.length} questions`);
      }

      // ── Process chunks ───────────────────────────────────────────────────────
      const model = getModel("application_authoring");

      while (chunkIndex * CHUNK < questions.length) {
        const start = chunkIndex * CHUNK;
        const chunk = questions.slice(start, start + CHUNK);
        const chunkEmbeddings = embeddings.slice(start, start + CHUNK);

        await pCtx.log(`Prefilling chunk ${chunkIndex + 1} (questions ${start + 1}–${start + chunk.length})…`);

        // Vector search for each question in parallel
        const questionContexts = await Promise.all(
          chunk.map(async (q, i) => {
            const vec = chunkEmbeddings[i];
            const matches = await convexCtx.vectorSearch(
              "orgIntelligence",
              "by_embedding",
              {
                vector: vec,
                limit: 5,
                filter: (f) => f.eq("orgId", orgId as any),
              },
            );
            const ids = matches.map((m) => m._id);
            const hydrated = ids.length
              ? ((await convexCtx.runQuery(
                  (internal as any).intelligence.hydrateSearchResults,
                  { ids },
                )) as Array<{
                  category: string;
                  content: string;
                  sourceLabel?: string;
                }>)
              : [];
            const facts = hydrated
              .map(
                (e) =>
                  `- [${e.category}] ${e.content}${e.sourceLabel ? ` (source: ${e.sourceLabel})` : ""}`,
              )
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

        for (const a of (output!.answers as Array<{
          id: string;
          value: string | null;
          confidence: string;
          sourceLabel: string | null;
        }>)) {
          if (!a.value) {
            skippedCount++;
            continue;
          }
          await convexCtx.runMutation(
            (internal as any).applicationAnswers.upsertPrefill,
            {
              applicationId,
              questionId: a.id,
              value: a.value,
              sourceRef: a.sourceLabel ?? undefined,
            },
          );
          filledCount++;
        }

        chunkIndex++;
        // Save checkpoint after each chunk so we can resume
        await pCtx.saveState({
          ...state,
          embeddings,
          chunkIndex,
          filledCount,
          skippedCount,
        });
      }

      await pCtx.log(
        `Done — filled ${filledCount}, skipped ${skippedCount}`,
      );

      return { kind: "done" };
    },
  };

  return [prefillPhase];
}

// ─── advance internal action ───────────────────────────────────────────────────

export const advance = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const mutations = makePrefillMutations();
    const storage = createConvexStorageAdapter<ApplicationPrefillState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.applicationPrefillPipeline.advance,
    });
    const phases = makePhases(ctx);
    await advancePhase({ jobId, phases, storage, scheduler });
  },
});

// ─── Public entry points ───────────────────────────────────────────────────────

export const startApplicationPrefill = action({
  args: { applicationId: v.id("applications") },
  returns: v.null(),
  handler: async (ctx, { applicationId }) => {
    const access = await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId },
    );

    const data = (await ctx.runQuery((api as any).applications.get, {
      applicationId,
    })) as {
      app: { clientOrgId: string };
      questions: Array<{ _id: string; prompt: string; answerType: string }>;
      answers: Array<{ questionId: string; source: string }>;
    };

    const manuallyAnsweredIds = new Set(
      data.answers
        .filter((a) => a.source === "manual")
        .map((a) => String(a.questionId)),
    );
    const targets = data.questions.filter(
      (q) => !manuallyAnsweredIds.has(String(q._id)),
    );

    // Clear prefill log before starting
    await ctx.runMutation(internal.applicationsInternal.prefillClearLog, {
      jobId: String(applicationId),
    });

    const passportBundle = (await ctx.runQuery(
      (internal as any).clientPassport.getFullInternal,
      { clientOrgId: data.app.clientOrgId },
    )) as PassportBundle;
    const passportFacts = serializePassport(passportBundle);

    const mutations = makePrefillMutations();
    const storage = createConvexStorageAdapter<ApplicationPrefillState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.applicationPrefillPipeline.advance,
    });
    const phases = makePhases(ctx);

    await runPipeline<ApplicationPrefillState>({
      jobId: String(applicationId),
      phases,
      storage,
      scheduler,
      initialState: {
        applicationId: String(applicationId),
        orgId: data.app.clientOrgId,
        questionIds: targets.map((q) => q._id),
        questions: targets,
        passportFacts,
        embeddings: [],
        chunkIndex: 0,
        filledCount: 0,
        skippedCount: 0,
      },
    });

    return null;
  },
});

export const retryApplicationPrefill = action({
  args: {
    applicationId: v.id("applications"),
    mode: v.union(v.literal("resume"), v.literal("full")),
  },
  returns: v.null(),
  handler: async (ctx, { applicationId, mode }) => {
    await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId },
    );

    if (mode === "full") {
      await ctx.runMutation(internal.applicationsInternal.prefillClearLog, {
        jobId: String(applicationId),
      });
    }

    const mutations = makePrefillMutations();
    const storage = createConvexStorageAdapter<ApplicationPrefillState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.applicationPrefillPipeline.advance,
    });

    if (mode === "full") {
      // Rebuild initial state from current application data
      const data = (await ctx.runQuery((api as any).applications.get, {
        applicationId,
      })) as {
        app: { clientOrgId: string };
        questions: Array<{ _id: string; prompt: string; answerType: string }>;
        answers: Array<{ questionId: string; source: string }>;
      };

      const manuallyAnsweredIds = new Set(
        data.answers
          .filter((a) => a.source === "manual")
          .map((a) => String(a.questionId)),
      );
      const targets = data.questions.filter(
        (q) => !manuallyAnsweredIds.has(String(q._id)),
      );

      const passportBundle = (await ctx.runQuery(
        (internal as any).clientPassport.getFullInternal,
        { clientOrgId: data.app.clientOrgId },
      )) as PassportBundle;
      const passportFacts = serializePassport(passportBundle);

      const phases = makePhases(ctx);
      await runPipeline<ApplicationPrefillState>({
        jobId: String(applicationId),
        phases,
        storage,
        scheduler,
        initialState: {
          applicationId: String(applicationId),
          orgId: data.app.clientOrgId,
          questionIds: targets.map((q) => q._id),
          questions: targets,
          passportFacts,
          embeddings: [],
          chunkIndex: 0,
          filledCount: 0,
          skippedCount: 0,
        },
      });
    } else {
      // Resume from existing checkpoint
      const phases = makePhases(ctx);
      await advancePhase({
        jobId: String(applicationId),
        phases,
        storage,
        scheduler,
      });
    }

    return null;
  },
});
