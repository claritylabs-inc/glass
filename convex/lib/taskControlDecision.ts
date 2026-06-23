"use node";

import { generateObject } from "ai";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  getModelForOrg,
  getProviderOptionsForTask,
} from "./models";
import {
  rankTaskControlCandidates,
  type TaskControlIntent,
  type TaskControlRanking,
  type TaskControlResponseIntent,
} from "./taskControlIntent";

export type TaskControlDecision = {
  intent: TaskControlResponseIntent;
  source: "retrieval" | "model";
  confidence: number;
  ranking: TaskControlRanking;
  rationale?: string;
  targetWorkflowKind?: string;
};

const ModelTaskControlDecisionSchema = z.object({
  intent: z.enum([
    "cancel_task",
    "reset_task",
    "continue_current_task",
    "unclear",
  ]),
  confidence: z.number().min(0).max(1),
  shouldAskConfirmation: z.boolean(),
  targetWorkflowKind: z.string().optional(),
  rationale: z.string().max(240),
});

function decisionFromModelOutput(args: {
  output: z.infer<typeof ModelTaskControlDecisionSchema>;
  ranking: TaskControlRanking;
}): TaskControlDecision | null {
  const { output, ranking } = args;
  if (output.shouldAskConfirmation && output.confidence >= 0.55) {
    return {
      intent: "ask_confirmation",
      source: "model",
      confidence: output.confidence,
      ranking,
      rationale: output.rationale,
      targetWorkflowKind: output.targetWorkflowKind,
    };
  }
  if (
    (output.intent === "cancel_task" || output.intent === "reset_task") &&
    output.confidence >= 0.74
  ) {
    return {
      intent: output.intent,
      source: "model",
      confidence: output.confidence,
      ranking,
      rationale: output.rationale,
      targetWorkflowKind: output.targetWorkflowKind,
    };
  }
  return null;
}

export async function resolveTaskControlDecision(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    messageText: string;
    recentContext?: string;
    channel: "web" | "imessage" | "email" | "mcp";
  },
): Promise<TaskControlDecision | null> {
  const ranking = rankTaskControlCandidates(args.messageText);
  const topCandidate = ranking.topCandidate;
  if (!topCandidate || ranking.domainConflict) return null;

  if (ranking.highConfidence) {
    return {
      intent: topCandidate.intent,
      source: "retrieval",
      confidence: topCandidate.score,
      ranking,
    };
  }

  if (!ranking.shouldUseModel) return null;

  try {
    const result = await generateObject({
      model: await getModelForOrg(ctx, args.orgId, "classification"),
      providerOptions: getProviderOptionsForTask("classification"),
      schema: ModelTaskControlDecisionSchema,
      maxOutputTokens: 512,
      system: `You classify whether a short Glass user message is trying to control the current task state.

Allowed task-control meanings:
- cancel_task: the user wants to abandon, leave, drop, scratch, stop, or cancel the active assistant task.
- reset_task: the user wants to start over or clear the active task and begin fresh.
- continue_current_task: the user is still asking about the task, policy, certificate, email, document, or insurance content.
- unclear: there is not enough evidence.

Important:
- Do not classify insurance-domain requests as task control. Examples: "cancel this policy", "send the cancellation notice", "attach the cancellation email", "what does cancellation mean".
- Do classify contextual abandon commands as task control. Examples: "leave it", "nevermind", "scratch this", "drop it", "not now".
- If the words could mean either abandoning the task or editing insurance/email content, set shouldAskConfirmation true instead of guessing.
- Return only the structured object.`,
      prompt: JSON.stringify({
        channel: args.channel,
        userMessage: args.messageText,
        recentContext: args.recentContext?.slice(-1200),
        rankedCandidates: ranking.candidates.map((candidate) => ({
          intent: candidate.intent,
          example: candidate.example,
          score: Number(candidate.score.toFixed(3)),
          matchedTokens: candidate.matchedTokens,
          fuzzyMatches: candidate.fuzzyMatches,
        })),
      }),
    });
    return decisionFromModelOutput({ output: result.object, ranking });
  } catch (err) {
    console.warn("[task-control] model arbitration failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return topCandidate.score >= 0.7
      ? {
          intent: topCandidate.intent as TaskControlIntent,
          source: "retrieval",
          confidence: topCandidate.score,
          ranking,
        }
      : null;
  }
}
