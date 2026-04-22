"use node";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModel } from "../lib/models";
import { generateText, Output } from "ai";
import { z } from "zod";
import { runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { ApplicationExtractionState } from "./applicationExtraction";

// ── generateQuestionSet ──

export const generateQuestionSet = action({
  args: {
    prompt: v.string(),
    clientOrgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const intents = await ctx.runQuery((internal as any).questionIntents.listAll, {}) as Array<{ intentKey: string; label: string; answerType: string }>;

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

// ── regroupAndOrderPublic ──
//
// Public wrapper that re-runs the regroup slice (phases prune → order) from
// scratch using cl-pipelines. Delegates to the same phase array as
// startExtractionFromPdf so logic stays in one place.
//
// Returns { groupCount: 0 } at fire time — actual count is unknown until the
// pipeline completes. Callers that display groupCount should read from live
// query data instead.

// Internal: schedules the regroup slice. Called by `applications.send` mutation
// (which has already auth-checked the broker) and by the public wrapper below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runRegroupPipeline(ctx: any, applicationId: string): Promise<void> {
  const mutations = {
    getJob: internal.applicationsInternal.getJob,
    setStatus: internal.applicationsInternal.setStatus,
    setCheckpoint: internal.applicationsInternal.setCheckpoint,
    appendLog: internal.applicationsInternal.appendLog,
    clearLog: internal.applicationsInternal.clearLog,
  };
  const storage = createConvexStorageAdapter<ApplicationExtractionState>({
    ctx: ctx as any,
    mutations,
  });
  const scheduler = createConvexSchedulerAdapter({
    ctx: ctx as any,
    advanceAction: internal.actions.applicationExtraction.advance,
  });
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

  const { makePhases } = await import("./applicationExtraction");
  const phases = makePhases(ctx);

  await runPipeline<ApplicationExtractionState>({
    jobId: String(applicationId),
    phases,
    storage,
    scheduler,
    initialPhase: "prune",
    retryMode: "full",
    initialState: {
      sourceKind: app.pipelineCheckpoint?.state?.sourceKind ?? "prompt",
      brokerOrgId: String(app.brokerOrgId),
      clientOrgId: String(app.clientOrgId),
      uploadedByUserId: String(app.createdByUserId),
    },
  });
}

export const regroupAndOrderPublic = action({
  args: { applicationId: v.id("applications") },
  returns: v.object({ groupCount: v.number() }),
  handler: async (ctx, args): Promise<{ groupCount: number }> => {
    await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId: args.applicationId },
    );
    await runRegroupPipeline(ctx, String(args.applicationId));
    return { groupCount: 0 };
  },
});

