"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal } from "../_generated/api";
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
import { haikuModel } from "../lib/ai";
import {
  APPLICATION_CLASSIFY_PROMPT,
  buildFieldExtractionPrompt,
} from "../lib/applicationPrompts";
import { getAcroFormFields } from "../lib/pdfFiller";
import { PDFDocument } from "pdf-lib";
import {
  mapExtractedFieldsToQuestions,
} from "../lib/applicationPdfExtraction";
import type { IntentStub } from "../lib/applicationPdfExtraction";
import { applyGroupingOutput } from "../lib/applicationGrouping";
import type { ActionCtx } from "../_generated/server";

// ─── State Type ────────────────────────────────────────────────────────────────

export type ApplicationExtractionState = {
  sourceKind: "pdf" | "prompt";
  fileId?: string; // pdf source
  prompt?: string; // prompt source
  brokerOrgId: string;
  clientOrgId: string;
  uploadedByUserId: string;
  // Ephemeral carryover — consumed by next phase
  pendingRawFields?: Array<{
    intentKey: string | null;
    prompt: string;
    answerType: string;
    pdfFieldName?: string;
  }>;
  pruneChunkIndex?: number; // mid-prune resume
  rewriteChunkIndex?: number; // mid-rewrite resume
  taxonomy?: Array<{
    title: string;
    description?: string;
    order: number;
  }>;
  assignments?: Record<string, string>;
};

// ─── Repeat inference schema ───────────────────────────────────────────────────

const repeatInferenceSchema = z.object({
  repeatGroups: z.array(
    z.object({
      memberQuestionIds: z.array(z.string()),
      prompt: z.string(),
      collectionKey: z.string(),
      itemLabel: z.string(),
      dependsOnQuestionId: z.string().nullable(),
      minItems: z.number().nullable(),
      maxItems: z.number().nullable(),
    }),
  ),
});

// ─── Helper: prune heuristic ───────────────────────────────────────────────────

function shouldPruneNonDigitizableQuestion(
  prompt: string,
  answerType: string,
): boolean {
  const p = prompt.toLowerCase();
  const has = (re: RegExp) => re.test(p);
  const signatureLike =
    has(/\bsign(?:ature|ed)?\b/) ||
    has(/\binitials?\b/) ||
    has(/\bsigned by\b/) ||
    has(/\bapplicant signature\b/) ||
    has(/\bauthorized representative\b/);
  const brokerOnly =
    has(/\bbroker\b/) &&
    has(/\b(name|address|phone|signature|producer)\b/);
  const attestationLike =
    has(/\bdeclare\b/) ||
    has(/\bcertif(?:y|ication)\b/) ||
    has(/\btrue and complete\b/) ||
    has(/\battest(?:ation)?\b/);
  const standaloneDate =
    answerType === "date" && (has(/\bdate\b/) || has(/\bdated\b/));
  return signatureLike || brokerOnly || attestationLike || standaloneDate;
}

// ─── Helper: batch ─────────────────────────────────────────────────────────────

async function batch<T>(
  items: T[],
  size: number,
  fn: (chunk: T[]) => Promise<void>,
) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

// ─── Convex mutations ref builder ──────────────────────────────────────────────

function makeMutations() {
  return {
    getJob: internal.applicationsInternal.getJob,
    setStatus: internal.applicationsInternal.setStatus,
    setCheckpoint: internal.applicationsInternal.setCheckpoint,
    appendLog: internal.applicationsInternal.appendLog,
    clearLog: internal.applicationsInternal.clearLog,
  };
}

// ─── Phase factory (requires Convex ctx for runQuery/runMutation) ──────────────

export function makePhases(convexCtx: ActionCtx): Phase<ApplicationExtractionState>[] {
  // ── Phase 1: extract_fields ───────────────────────────────────────────────────
  const extractFieldsPhase: Phase<ApplicationExtractionState> = {
    name: "extract_fields",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      if (state.sourceKind !== "pdf" || !state.fileId) {
        return {
          kind: "error",
          error: "extract_fields: missing fileId for pdf source",
        };
      }

      await pCtx.log("Classifying PDF…");

      // 1. Fetch PDF URL
      const pdfUrl = await convexCtx.storage.getUrl(state.fileId as any);
      if (!pdfUrl) return { kind: "error", error: "File not found in storage" };

      // 2. Classify — confirm this looks like an application form
      const classifyResp = await generateText({
        model: haikuModel,
        maxOutputTokens: 64,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: APPLICATION_CLASSIFY_PROMPT },
              {
                type: "file",
                data: new URL(pdfUrl),
                mediaType: "application/pdf",
              },
            ],
          },
        ],
      });
      const classifyText = classifyResp.text.trim().toLowerCase();
      if (!classifyText.includes("application")) {
        return {
          kind: "error",
          error: `PDF does not appear to be an application form (classifier: ${classifyText})`,
        };
      }

      await pCtx.log("Extracting form fields…");

      // 3. Extract AcroForm fields (fillable PDF widgets)
      const pdfResponse = await fetch(pdfUrl);
      const pdfBytes = await pdfResponse.arrayBuffer();
      const pdfDoc = await PDFDocument.load(pdfBytes, {
        ignoreEncryption: true,
      });
      const acroFields = getAcroFormFields(pdfDoc);

      // 4. If no AcroForm fields, run LLM field extraction
      let rawFields: Array<{
        pdfFieldName: string;
        label: string;
        widgetType: string;
      }>;
      if (acroFields.length > 0) {
        rawFields = acroFields.map((f: { name: string; type?: string }) => ({
          pdfFieldName: f.name,
          label: f.name
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          widgetType: f.type ?? "text",
        }));
      } else {
        // Flat PDF — use LLM with structured output
        const fieldSchema = z.object({
          fields: z.array(
            z.object({
              name: z.string(),
              label: z.string(),
              type: z.string().nullable(),
            }),
          ),
        });
        const { experimental_output: object } = await generateText({
          model: getModel("extraction"),
          maxOutputTokens: 16384,
          experimental_output: Output.object({ schema: fieldSchema }),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: buildFieldExtractionPrompt() },
                {
                  type: "file",
                  data: new URL(pdfUrl),
                  mediaType: "application/pdf",
                },
              ],
            },
          ],
        });
        rawFields = object!.fields.map((f) => ({
          pdfFieldName: f.name,
          label: f.label,
          widgetType: f.type ?? "text",
        }));
      }

      // 5. Load questionIntents for matching
      const intents: IntentStub[] = await convexCtx.runQuery(
        (internal as any).questionIntents.listAll,
        {},
      );

      // 6. Map extracted fields to MappedQuestion[]
      const pendingRawFields = mapExtractedFieldsToQuestions(rawFields, intents);

      await pCtx.log(`Extracted ${pendingRawFields.length} raw fields`);

      return {
        kind: "next",
        nextPhase: "insert_questions",
        state: { ...state, pendingRawFields },
      };
    },
  };

  // ── Phase 2: insert_questions ─────────────────────────────────────────────────
  const insertQuestionsPhase: Phase<ApplicationExtractionState> = {
    name: "insert_questions",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const applicationId = pCtx.jobId;

      let mappedQuestions: Array<{
        intentKey: string | null;
        prompt: string;
        answerType: string;
        pdfFieldName?: string;
      }>;

      if (state.sourceKind === "pdf") {
        // Use pendingRawFields from extract_fields phase
        mappedQuestions = state.pendingRawFields ?? [];
      } else {
        // Generate questions from prompt via LLM
        await pCtx.log("Generating questions from prompt…");
        const intents = (await convexCtx.runQuery(
          (internal as any).questionIntents.listAll,
          {},
        )) as Array<{
          intentKey: string;
          label: string;
          answerType: string;
        }>;

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
                    "text",
                    "long_text",
                    "number",
                    "currency",
                    "percent",
                    "date",
                    "yes_no",
                    "select",
                    "multi_select",
                    "address",
                    "location_list",
                    "subsidiary_list",
                    "loss_list",
                    "file_upload",
                  ]),
                  required: z.boolean(),
                }),
              ),
            }),
          }),
          prompt: `You are an insurance application designer. Generate a question set for the following application request.
Use intent keys from the catalog when possible. Add custom questions only when the catalog lacks coverage.

BROKER REQUEST:
${state.prompt ?? ""}

INTENT CATALOG (intentKey — answerType):
${intentSummary}

Return a list of questions. Prefer intentKey references. For custom questions, set customPrompt and answerType but leave intentKey empty.
Keep to 15-30 questions. Focus on what underwriters need for this line of business.`,
        });

        mappedQuestions = (output!.questions as any[]).map((q) => ({
          intentKey: q.intentKey ?? null,
          prompt: q.customPrompt ?? q.intentKey ?? "Question",
          answerType: q.answerType,
        }));
      }

      if (mappedQuestions.length === 0) {
        return { kind: "error", error: "No questions could be extracted" };
      }

      await pCtx.log(`Inserting ${mappedQuestions.length} questions…`);

      await convexCtx.runMutation(
        (internal as any).applicationQuestionsInternal.bulkInsert,
        { applicationId, questions: mappedQuestions },
      );

      // Clear pendingRawFields from state
      const { pendingRawFields: _dropped, ...restState } = state;

      await pCtx.log("Questions inserted");

      return {
        kind: "next",
        nextPhase: "infer_meta",
        state: restState,
      };
    },
  };

  // ── Phase 3: infer_meta ───────────────────────────────────────────────────────
  const inferMetaPhase: Phase<ApplicationExtractionState> = {
    name: "infer_meta",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const applicationId = pCtx.jobId;

      await pCtx.log("Inferring application title and line of business…");

      try {
        const questions = (await convexCtx.runQuery(
          (internal as any).applicationQuestionsInternal.listByApplication,
          { applicationId },
        )) as Array<{ prompt: string }>;

        if (questions.length > 0) {
          const sample = questions
            .slice(0, 60)
            .map((q, i) => `${i + 1}. ${q.prompt}`)
            .join("\n");
          const { output } = await generateText({
            model: getModel("application_authoring"),
            maxOutputTokens: 300,
            output: Output.object({
              schema: z.object({
                title: z.string().nullable(),
                lineOfBusiness: z.string().nullable(),
              }),
            }),
            prompt: `Read the question prompts from an insurance application form and infer:
- title: a short human-readable title the broker will see (e.g. "Commercial General Liability Application", "Workers Comp Renewal"). Keep under 60 chars.
- lineOfBusiness: a short label like "CGL", "Commercial Property", "Workers Comp", "Commercial Auto", "Umbrella", etc.
Return null for either field if the prompts don't clearly indicate it.

QUESTIONS:
${sample}`,
          });
          const out = output as {
            title: string | null;
            lineOfBusiness: string | null;
          };
          const title = out.title?.trim() || null;
          const lineOfBusiness = out.lineOfBusiness?.trim() || null;

          if (title || lineOfBusiness) {
            await convexCtx.runMutation(
              (internal as any).applicationsInternal.patchDraftMetaInternal,
              {
                applicationId,
                title: title ?? undefined,
                lineOfBusiness: lineOfBusiness ?? undefined,
              },
            );
          }
        }
      } catch (err) {
        await pCtx.log(`inferMeta failed (non-critical): ${String(err)}`, "warn");
      }

      return {
        kind: "next",
        nextPhase: "prune",
        state,
      };
    },
  };

  // ── Phase 4: prune (with mid-phase checkpointing) ─────────────────────────────
  const prunePhase: Phase<ApplicationExtractionState> = {
    name: "prune",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const applicationId = pCtx.jobId;

      await pCtx.log("Pruning non-digitizable questions…");

      const data = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        questions: Array<{
          _id: string;
          prompt: string;
          answerType: string;
        }>;
        answers: Array<{ questionId: string }>;
      } | null;

      if (!data) return { kind: "error", error: "Application not found" };

      const { questions, answers } = data;
      const answeredQuestionIds = new Set(answers.map((a) => String(a.questionId)));

      const prunedIds = new Set<string>();
      for (const q of questions) {
        if (
          shouldPruneNonDigitizableQuestion(q.prompt, q.answerType) &&
          !answeredQuestionIds.has(String(q._id))
        ) {
          prunedIds.add(String(q._id));
        }
      }

      const pruneChunkIndex = state.pruneChunkIndex ?? 0;
      const toPrune = Array.from(prunedIds);

      for (let i = pruneChunkIndex; i < toPrune.length; i += 100) {
        const chunk = toPrune.slice(i, i + 100);
        await convexCtx.runMutation(
          (internal as any).applicationQuestionsInternal.deleteQuestions,
          { questionIds: chunk as any },
        );
        // Mid-phase checkpoint
        await pCtx.saveState({ ...state, pruneChunkIndex: i + 100 });
      }

      await pCtx.log(`Pruned ${prunedIds.size} non-digitizable questions`);

      return {
        kind: "next",
        nextPhase: "rewrite",
        state: { ...state, pruneChunkIndex: undefined },
      };
    },
  };

  // ── Phase 5: rewrite (with mid-phase checkpointing) ──────────────────────────
  const rewritePhase: Phase<ApplicationExtractionState> = {
    name: "rewrite",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const applicationId = pCtx.jobId;

      await pCtx.log("Rewriting question prompts…");

      const data = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        questions: Array<{
          _id: string;
          prompt: string;
          answerType: string;
          rawPrompt?: string;
        }>;
        answers: Array<{ questionId: string }>;
      } | null;

      if (!data) return { kind: "error", error: "Application not found" };

      const { questions, answers } = data;
      const answeredQuestionIds = new Set(answers.map((a) => String(a.questionId)));
      const model = getModel("application_authoring");

      const toRewrite = questions.filter(
        (q) => !answeredQuestionIds.has(String(q._id)) && !(q as any).rawPrompt,
      );

      const REWRITE_CHUNK = 30;
      const rewriteChunkIndex = state.rewriteChunkIndex ?? 0;
      const rewrites: Record<string, string> = {};

      for (let i = rewriteChunkIndex; i < toRewrite.length; i += REWRITE_CHUNK) {
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
        for (const r of (rewriteOutput!.rewrites as Array<{
          id: string;
          prompt: string;
        }>)) {
          const trimmed = r.prompt.trim();
          if (trimmed) rewrites[r.id] = trimmed;
        }
        // Mid-phase checkpoint after each chunk
        await pCtx.saveState({ ...state, rewriteChunkIndex: i + REWRITE_CHUNK });
      }

      const rewriteEntries = Object.entries(rewrites).map(
        ([questionId, prompt]) => ({ questionId, prompt }),
      );
      await batch(rewriteEntries, 120, async (chunk) => {
        await convexCtx.runMutation(
          (internal as any).applicationQuestionsInternal.rewritePrompts,
          { rewrites: chunk as any },
        );
      });

      await pCtx.log(
        `Rewrote ${Object.keys(rewrites).length}/${toRewrite.length} prompts`,
      );

      // ── Pass 0.5: infer repeatable/dependent intents (LLM-assisted) ──
      await pCtx.log("Inferring repeatable question groups…");

      // Fetch the now-rewritten questions
      const refreshedData = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        questions: Array<{
          _id: string;
          prompt: string;
          answerType: string;
          intentKey?: string;
        }>;
        answers: Array<{ questionId: string }>;
      } | null;

      const effectiveQuestions = refreshedData?.questions ?? questions;
      const effectiveAnsweredIds = new Set(
        (refreshedData?.answers ?? answers).map((a) => String(a.questionId)),
      );

      const repeatCandidates = effectiveQuestions.map((q) => ({
        id: q._id,
        prompt: rewrites[String(q._id)] ?? q.prompt,
        answerType: q.answerType,
        answered: effectiveAnsweredIds.has(String(q._id)),
      }));

      let repeatInferenceOutput:
        | { repeatGroups: Array<{
            memberQuestionIds: string[];
            prompt: string;
            collectionKey: string;
            itemLabel: string;
            dependsOnQuestionId: string | null;
            minItems: number | null;
            maxItems: number | null;
          }> }
        | undefined;
      try {
        const repeatResp = await generateText({
          model,
          maxOutputTokens: 2200,
          output: Output.object({ schema: repeatInferenceSchema }),
          prompt: `You are converting a paper insurance application into a digital-first form.

Detect repeated question templates that should become ONE repeatable question with multiple rows.

Examples:
- "What is the FEIN for the first insured?" + "...second insured?" -> one prompt asked for each insured
- "Name of first location" + "Name of second location" -> one prompt asked for each location

Return only repeat groups that are high-confidence and have at least 2 memberQuestionIds.

Rules:
- keep prompt concise and natural for end users (for each X)
- collectionKey must be lowercase snake_case and stable (insured, location, vehicle, owner)
- itemLabel should be singular plain English (insured, location, vehicle, owner)
- dependsOnQuestionId should point to a question that asks for count/list size, if one exists
- minItems should be at least observed repeated count
- maxItems can be null if unknown

QUESTIONS (JSON):
${JSON.stringify(repeatCandidates, null, 2)}`,
        });
        repeatInferenceOutput = repeatResp.output as typeof repeatInferenceOutput;
      } catch (err) {
        await pCtx.log(
          `repeat inference skipped (non-critical): ${String(err)}`,
          "warn",
        );
      }

      const byId = new Map(effectiveQuestions.map((q) => [String(q._id), q]));
      const foldedQuestionIds = new Set<string>();
      const repeatGroups = repeatInferenceOutput?.repeatGroups ?? [];
      type EQ = (typeof effectiveQuestions)[number];

      const repeatPatches: Array<{
        questionId: string;
        prompt: string;
        repeating: {
          collectionKey: string;
          itemLabel: string;
          dependsOnQuestionId?: string;
          minItems: number;
          maxItems: number;
        };
      }> = [];

      for (const group of repeatGroups) {
        const members = group.memberQuestionIds
          .map((id) => byId.get(String(id)))
          .filter(Boolean) as EQ[];
        if (members.length < 2) continue;

        const answerTypeSet = new Set(members.map((m) => m.answerType));
        if (answerTypeSet.size !== 1) continue;

        const keep =
          members.find((m) => !effectiveAnsweredIds.has(String(m._id))) ??
          members[0];
        // Start every repeating collection at 0 — users add rows as needed.
        const minItems = 0;
        const maxItems = group.maxItems
          ? Math.max(minItems, group.maxItems)
          : 50;
        const collectionKey = (
          group.collectionKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") ||
          "item"
        );
        const itemLabel = group.itemLabel.trim().toLowerCase() || "item";
        const dependsOnQuestionId =
          group.dependsOnQuestionId && byId.has(group.dependsOnQuestionId)
            ? group.dependsOnQuestionId
            : undefined;

        repeatPatches.push({
          questionId: keep._id,
          prompt:
            group.prompt.trim() ||
            (rewrites[String(keep._id)] ?? keep.prompt),
          repeating: {
            collectionKey,
            itemLabel,
            dependsOnQuestionId: dependsOnQuestionId as any,
            minItems,
            maxItems,
          },
        });

        for (const member of members) {
          if (String(member._id) === String(keep._id)) continue;
          if (effectiveAnsweredIds.has(String(member._id))) continue;
          foldedQuestionIds.add(String(member._id));
        }
      }

      await batch(repeatPatches, 100, async (chunk) => {
        await convexCtx.runMutation(
          (internal as any).applicationQuestionsInternal.patchMany,
          { patches: chunk as any },
        );
      });
      await batch(Array.from(foldedQuestionIds), 100, async (chunk) => {
        await convexCtx.runMutation(
          (internal as any).applicationQuestionsInternal.deleteQuestions,
          { questionIds: chunk as any },
        );
      });

      await pCtx.log(
        `Folded ${foldedQuestionIds.size} repeated questions into digital repeatables`,
      );

      // ── Pass 0.6: typed-field recognition & intra-collection dedup ──
      // Refetch after the fold so we see the settled state.
      const afterFold = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        questions: Array<{
          _id: string;
          prompt: string;
          answerType: string;
        }>;
      } | null;

      if (afterFold) {
        const ADDRESS_RE =
          /\b(address|street address|premises address|mailing address|physical location|location address|enter (each|the) location)\b/i;
        const retypePatches: Array<{ questionId: string; answerType: string; prompt?: string }> =
          [];
        for (const q of afterFold.questions) {
          if (q.answerType !== "text" && q.answerType !== "long_text") continue;
          if (ADDRESS_RE.test(q.prompt)) {
            retypePatches.push({ questionId: q._id, answerType: "address" });
          }
        }
        if (retypePatches.length > 0) {
          await batch(retypePatches, 100, async (chunk) => {
            await convexCtx.runMutation(
              (internal as any).applicationQuestionsInternal.patchMany,
              { patches: chunk as any },
            );
          });
          await pCtx.log(
            `Retyped ${retypePatches.length} address-like prompts to answerType=address`,
          );
        }

        // Dedup: within a repeating collection, if multiple surviving questions
        // have the same normalized prompt, keep the first and delete the rest.
        const refetched = (await convexCtx.runQuery(
          internal.applicationsInternal.getFullForPipeline,
          { applicationId: applicationId as Id<"applications"> },
        )) as {
          questions: Array<{
            _id: string;
            prompt: string;
            repeating?: { collectionKey: string };
          }>;
        } | null;
        if (refetched) {
          const norm = (s: string) =>
            s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "");
          const seen = new Map<string, string>(); // key -> first questionId
          const toDelete: string[] = [];
          for (const q of refetched.questions) {
            const ck = (q as any).repeating?.collectionKey;
            if (!ck) continue;
            const key = `${ck}::${norm(q.prompt)}`;
            const first = seen.get(key);
            if (first && first !== q._id) toDelete.push(q._id);
            else seen.set(key, q._id);
          }
          if (toDelete.length > 0) {
            await batch(toDelete, 100, async (chunk) => {
              await convexCtx.runMutation(
                (internal as any).applicationQuestionsInternal.deleteQuestions,
                { questionIds: chunk as any },
              );
            });
            await pCtx.log(
              `Removed ${toDelete.length} duplicate prompts within repeating collections`,
            );
          }
        }
      }

      return {
        kind: "next",
        nextPhase: "taxonomy",
        state: { ...state, rewriteChunkIndex: undefined },
      };
    },
  };

  // ── Phase 6: taxonomy ─────────────────────────────────────────────────────────
  const taxonomyPhase: Phase<ApplicationExtractionState> = {
    name: "taxonomy",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const applicationId = pCtx.jobId;

      await pCtx.log("Deriving question group taxonomy…");

      const model = getModel("application_authoring");

      const data = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        questions: Array<{ _id: string; prompt: string }>;
      } | null;

      if (!data) return { kind: "error", error: "Application not found" };

      const taxonomyPromptList = data.questions
        .map((q, i) => `${i + 1}. ${q.prompt}`)
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

      const taxonomy = (
        taxonomyOutput!.groups as Array<{
          title: string;
          description: string | null;
          order: number;
        }>
      )
        .map((g) => ({
          title: g.title,
          description: g.description ?? undefined,
          order: g.order,
        }))
        .sort((a, b) => a.order - b.order);

      if (taxonomy.length === 0) {
        return { kind: "error", error: "Taxonomy pass returned no groups" };
      }

      await pCtx.log(`Taxonomy: ${taxonomy.length} groups`);

      return {
        kind: "next",
        nextPhase: "assign",
        state: { ...state, taxonomy },
      };
    },
  };

  // ── Phase 7: assign ───────────────────────────────────────────────────────────
  const assignPhase: Phase<ApplicationExtractionState> = {
    name: "assign",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const applicationId = pCtx.jobId;
      const taxonomy = state.taxonomy;

      if (!taxonomy || taxonomy.length === 0) {
        return { kind: "error", error: "assign: no taxonomy in state" };
      }

      await pCtx.log("Assigning questions to groups…");

      const model = getModel("application_authoring");

      const data = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        questions: Array<{
          _id: string;
          prompt: string;
          answerType: string;
          intentKey?: string;
        }>;
        answers: Array<{ questionId: string }>;
      } | null;

      if (!data) return { kind: "error", error: "Application not found" };

      const answeredQuestionIds = new Set(
        data.answers.map((a) => String(a.questionId)),
      );
      const questionSummary = data.questions.map((q) => ({
        id: q._id,
        intentKey: q.intentKey,
        prompt: q.prompt,
        answerType: q.answerType,
        answered: answeredQuestionIds.has(String(q._id)),
      }));

      const taxonomySummary = taxonomy
        .map(
          (g) =>
            `- ${g.title}${g.description ? ` — ${g.description}` : ""}`,
        )
        .join("\n");

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

        for (const a of (assignOutput!.assignments as Array<{
          id: string;
          groupTitle: string;
        }>)) {
          assignments[a.id] = a.groupTitle;
        }
      }

      await pCtx.log(
        `Assigned ${Object.keys(assignments).length} questions`,
      );

      return {
        kind: "next",
        nextPhase: "order",
        state: { ...state, assignments },
      };
    },
  };

  // ── Phase 8: order (terminal) ─────────────────────────────────────────────────
  const orderPhase: Phase<ApplicationExtractionState> = {
    name: "order",
    run: async (pCtx): Promise<PhaseResult<ApplicationExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const applicationId = pCtx.jobId;
      const taxonomy = state.taxonomy;
      const assignments = state.assignments;

      if (!taxonomy || !assignments) {
        return {
          kind: "error",
          error: "order: missing taxonomy or assignments in state",
        };
      }

      await pCtx.log("Applying group ordering…");

      const data = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        groups: Array<{ _id: string; title: string }>;
        questions: Array<{
          _id: string;
          groupId: string;
          intentKey?: string;
          prompt: string;
          answerType: string;
          required: boolean;
          createdAt: number;
          order: number;
          applicationId: string;
        }>;
        answers: Array<{ questionId: string }>;
      } | null;

      if (!data) return { kind: "error", error: "Application not found" };

      const { groups, questions } = data;
      const existingGroupIdByTitle = Object.fromEntries(
        groups.map((g) => [g.title, g._id]),
      );

      const validTitles = new Set(taxonomy.map((g) => g.title));
      const fallbackTitle = taxonomy[0].title;
      const byTitle = new Map<string, string[]>();
      for (const t of taxonomy) byTitle.set(t.title, []);
      for (const q of questions) {
        const raw = assignments[String(q._id)];
        const title = raw && validTitles.has(raw) ? raw : fallbackTitle;
        byTitle.get(title)!.push(String(q._id));
      }

      // Reorder within each group so that:
      //   • questions sharing a repeating.collectionKey are contiguous
      //   • conditional questions follow their parent question immediately
      // This keeps related blocks visually bunched in the form.
      const questionById = new Map<string, (typeof questions)[number]>();
      for (const q of questions) questionById.set(String(q._id), q);

      const conditionalChildren = new Map<string, string[]>();
      for (const q of questions) {
        const parent = (q as any).conditional?.questionId as string | undefined;
        if (!parent) continue;
        const arr = conditionalChildren.get(String(parent)) ?? [];
        arr.push(String(q._id));
        conditionalChildren.set(String(parent), arr);
      }

      function reorderGroup(ids: string[]): string[] {
        const placed = new Set<string>();
        const out: string[] = [];

        const emit = (id: string) => {
          if (placed.has(id)) return;
          placed.add(id);
          out.push(id);
          for (const childId of conditionalChildren.get(id) ?? []) {
            if (!ids.includes(childId)) continue;
            emitBlock(childId);
          }
        };

        const emitBlock = (id: string) => {
          const q = questionById.get(id);
          const collectionKey = (q as any)?.repeating?.collectionKey as
            | string
            | undefined;
          if (!collectionKey) {
            emit(id);
            return;
          }
          for (const sibId of ids) {
            const sib = questionById.get(sibId);
            if ((sib as any)?.repeating?.collectionKey === collectionKey) {
              emit(sibId);
            }
          }
        };

        for (const id of ids) {
          if (placed.has(id)) continue;
          // Skip conditional children at top level — they are emitted under their parent
          const parent = (questionById.get(id) as any)?.conditional?.questionId as
            | string
            | undefined;
          if (parent && ids.includes(String(parent))) continue;
          emitBlock(id);
        }

        // Safety net: append any stragglers (e.g. cycles, missing parents)
        for (const id of ids) if (!placed.has(id)) emit(id);
        return out;
      }

      const normalizedOutput = {
        groups: taxonomy.map((g) => ({
          title: g.title,
          description: g.description as string | undefined,
          questionIds: reorderGroup(byTitle.get(g.title) ?? []),
          order: g.order,
        })),
      };

      const applyResult = applyGroupingOutput(
        questions as any,
        normalizedOutput,
        { existingGroupIdByTitle: existingGroupIdByTitle as any },
      );

      // Insert new groups and collect their IDs
      const newGroupIdByTitle: Record<string, string> = {};
      for (const g of applyResult.groupInserts) {
        const newId: string = await convexCtx.runMutation(
          (internal as any).applicationGroupsMutationsInternal.insert,
          {
            applicationId,
            title: g.title,
            description: g.description,
            order: g.order,
          },
        );
        newGroupIdByTitle[g.title] = newId;
      }

      // Resolve sentinel IDs
      const resolvedPatches = applyResult.questionPatches.map((p) => {
        const groupId = String(p.groupId).startsWith("new:")
          ? newGroupIdByTitle[String(p.groupId).slice(4)]
          : p.groupId;
        return { id: p.id, groupId, order: p.order };
      });

      await batch(resolvedPatches, 150, async (chunk) => {
        await convexCtx.runMutation(
          (internal as any).applicationQuestionsInternal.patchMany,
          {
            patches: chunk.map((patch) => ({
              questionId: patch.id,
              groupId: patch.groupId,
              order: patch.order,
            })) as any,
          },
        );
      });

      // Cleanup empty groups
      const refreshedGroups = (await convexCtx.runQuery(
        internal.applicationsInternal.getFullForPipeline,
        { applicationId: applicationId as Id<"applications"> },
      )) as {
        groups: Array<{ _id: string }>;
        questions: Array<{ groupId: string }>;
      } | null;

      if (refreshedGroups) {
        const usedGroupIds = new Set(
          refreshedGroups.questions.map((q) => String(q.groupId)),
        );
        const emptyGroupIds = refreshedGroups.groups
          .map((g) => String(g._id))
          .filter((groupId) => !usedGroupIds.has(groupId));
        if (emptyGroupIds.length > 0) {
          await convexCtx.runMutation(
            (internal as any).applicationGroupsMutationsInternal.deleteMany,
            { groupIds: emptyGroupIds as any },
          );
        }
      }

      await pCtx.log("Grouping complete");

      return { kind: "done" };
    },
  };

  return [
    extractFieldsPhase,
    insertQuestionsPhase,
    inferMetaPhase,
    prunePhase,
    rewritePhase,
    taxonomyPhase,
    assignPhase,
    orderPhase,
  ];
}

// ─── advance internal action ───────────────────────────────────────────────────

export const advance = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<ApplicationExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.applicationExtraction.advance,
    });
    const phases = makePhases(ctx);
    await advancePhase({ jobId, phases, storage, scheduler });
  },
});

// ─── Public entry points ───────────────────────────────────────────────────────

export const startExtractionFromPdf = action({
  args: {
    applicationId: v.id("applications"),
    fileId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, { applicationId, fileId }) => {
    const access = await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId },
    );
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<ApplicationExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.applicationExtraction.advance,
    });
    await ctx.runMutation(internal.applicationsInternal.clearLog, {
      jobId: String(applicationId),
    });
    const phases = makePhases(ctx);
    await runPipeline<ApplicationExtractionState>({
      jobId: String(applicationId),
      phases,
      storage,
      scheduler,
      initialState: {
        sourceKind: "pdf",
        fileId: String(fileId),
        brokerOrgId: String(access.brokerOrgId),
        clientOrgId: String(access.clientOrgId),
        uploadedByUserId: String(access.userId),
      },
    });
    return null;
  },
});

export const startGenerationFromPrompt = action({
  args: {
    applicationId: v.id("applications"),
    generationPrompt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { applicationId, generationPrompt }) => {
    const access = await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId },
    );
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<ApplicationExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.applicationExtraction.advance,
    });
    await ctx.runMutation(internal.applicationsInternal.clearLog, {
      jobId: String(applicationId),
    });
    const phases = makePhases(ctx);
    await runPipeline<ApplicationExtractionState>({
      jobId: String(applicationId),
      phases,
      storage,
      scheduler,
      initialPhase: "insert_questions",
      initialState: {
        sourceKind: "prompt",
        prompt: generationPrompt,
        brokerOrgId: String(access.brokerOrgId),
        clientOrgId: String(access.clientOrgId),
        uploadedByUserId: String(access.userId),
      },
    });
    return null;
  },
});

export const retryExtraction = action({
  args: {
    applicationId: v.id("applications"),
    mode: v.union(v.literal("resume"), v.literal("full")),
  },
  handler: async (ctx, { applicationId, mode }) => {
    await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId },
    );

    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<ApplicationExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.applicationExtraction.advance,
    });

    // For "full", clear log so the banner starts fresh
    if (mode === "full") {
      await ctx.runMutation(internal.applicationsInternal.clearLog, {
        jobId: String(applicationId),
      });
    }

    // Fetch actual org IDs from existing application doc (needed for "full" restart)
    const app = (await ctx.runQuery(
      (internal as any).applicationsInternal.getInternal,
      { applicationId },
    )) as {
      brokerOrgId: string;
      clientOrgId: string;
      createdByUserId: string;
      pipelineCheckpoint?: { state?: ApplicationExtractionState };
    } | null;
    if (!app) throw new Error("Application not found");

    const phases = makePhases(ctx);
    await runPipeline<ApplicationExtractionState>({
      jobId: String(applicationId),
      phases,
      storage,
      scheduler,
      retryMode: mode,
      initialState: {
        sourceKind:
          app.pipelineCheckpoint?.state?.sourceKind ?? "pdf",
        brokerOrgId: String(app.brokerOrgId),
        clientOrgId: String(app.clientOrgId),
        uploadedByUserId: String(app.createdByUserId),
      },
    });
  },
});
