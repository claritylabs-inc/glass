"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { sendClRouterFeedback } from "../lib/clRouterClient";

const internalApi = internal as any;
const ratingValidator = v.union(v.literal("positive"), v.literal("negative"));

type RouterFeedbackRecord = Pick<
  Doc<"agentResponseFeedback">,
  | "threadMessageId"
  | "userId"
  | "slackActorId"
  | "imessageSenderAddress"
  | "source"
  | "rating"
  | "routerRequestId"
>;

function feedbackActorKey(feedback: RouterFeedbackRecord) {
  if (feedback.imessageSenderAddress) {
    return createHash("sha256")
      .update(feedback.imessageSenderAddress)
      .digest("hex");
  }
  return String(
    feedback.userId ??
      feedback.slackActorId ??
      "unknown",
  );
}

async function forwardRouterSignal(
  feedback: RouterFeedbackRecord,
) {
  if (!feedback.routerRequestId) return;
  await sendClRouterFeedback({
    requestId: feedback.routerRequestId,
    idempotencyKey: `agent-response:${feedback.threadMessageId}:${feedbackActorKey(feedback)}`,
    source: feedback.source,
    signals: { rating: feedback.rating === "positive" ? "up" : "down" },
    trace: {
      traceId: String(feedback.threadMessageId),
      channel: feedback.source,
      taskKind: "query_reason",
    },
  });
}

export const submit = action({
  args: {
    messageId: v.id("threadMessages"),
    rating: ratingValidator,
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(
      internalApi.agentResponseFeedback.getContextInternal,
      { messageId: args.messageId },
    );
    const feedback = await ctx.runMutation(
      internalApi.agentResponseFeedback.recordWebInternal,
      {
        ...args,
        userId: context.userId,
      },
    );
    if (feedback.shouldSubmit && feedback.routerRequestId) {
      try {
        await forwardRouterSignal({
          threadMessageId: args.messageId,
          userId: context.userId,
          source: "web",
          rating: feedback.rating,
          routerRequestId: feedback.routerRequestId,
        });
        await ctx.runMutation(
          internalApi.agentResponseFeedback.markRouterSignalInternal,
          { feedbackId: feedback.id, status: "submitted" },
        );
      } catch (error) {
        console.warn("Could not submit response rating to cl-router", error);
        await ctx.runMutation(
          internalApi.agentResponseFeedback.markRouterSignalInternal,
          {
            feedbackId: feedback.id,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    return { recorded: true, rating: feedback.rating };
  },
});

export const retryPending = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const feedback = (await ctx.runQuery(
      internalApi.agentResponseFeedback.listPendingRouterSignalsInternal,
      { limit: args.limit },
    )) as Doc<"agentResponseFeedback">[];
    let submitted = 0;
    let failed = 0;
    for (const item of feedback) {
      try {
        await forwardRouterSignal(item);
        await ctx.runMutation(
          internalApi.agentResponseFeedback.markRouterSignalInternal,
          { feedbackId: item._id, status: "submitted" },
        );
        submitted += 1;
      } catch (error) {
        await ctx.runMutation(
          internalApi.agentResponseFeedback.markRouterSignalInternal,
          {
            feedbackId: item._id,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        );
        failed += 1;
      }
    }
    return { attempted: feedback.length, submitted, failed };
  },
});
