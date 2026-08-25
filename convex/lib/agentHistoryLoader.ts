"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  AGENT_HISTORY_MAX_SCANNED_MESSAGES,
  AGENT_HISTORY_PAGE_SIZE,
  THREAD_SUMMARY_VERSION,
  selectBoundedAgentHistory,
  type AgentToolSurface,
} from "./agentMessageHistory";

export async function loadBoundedAgentHistory(
  ctx: ActionCtx,
  args: {
    threadId: Id<"threads">;
    currentMessageId: Id<"threadMessages">;
    surface: AgentToolSurface;
  },
) {
  const state = await ctx.runMutation(internal.agentHistory.prepareForTurn, {
    threadId: args.threadId,
    currentMessageId: args.currentMessageId,
    surface: args.surface,
  });
  if (!state) throw new Error("Thread context state was not created");

  const rows: Doc<"threadMessages">[] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone && rows.length < AGENT_HISTORY_MAX_SCANNED_MESSAGES) {
    const page: {
      page: Doc<"threadMessages">[];
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.agentHistory.getMessagePage, {
      threadId: args.threadId,
      taskStartedAt:
        state.continuityMode === "task_scoped"
          ? state.taskStartedAt
          : undefined,
      paginationOpts: {
        cursor,
        numItems: Math.min(
          AGENT_HISTORY_PAGE_SIZE,
          AGENT_HISTORY_MAX_SCANNED_MESSAGES - rows.length,
        ),
      },
    });
    rows.push(...page.page);
    cursor = page.continueCursor;
    isDone = page.isDone;
  }

  const selected = selectBoundedAgentHistory([...rows].reverse(), {
    currentMessageId: String(args.currentMessageId),
    taskStartedAt:
      state.continuityMode === "task_scoped" ? state.taskStartedAt : undefined,
  });
  const summary =
    state.summaryVersion === THREAD_SUMMARY_VERSION ? state.summary : undefined;

  console.log("[agent-history] Context selected", {
    threadId: args.threadId,
    surface: args.surface,
    continuityMode: state.continuityMode,
    scannedMessages: rows.length,
    selectedMessages: selected.messages.length,
    selectedUserTurns: selected.userTurnCount,
    estimatedPriorTokens: selected.estimatedTokenCount,
    summaryAvailable: Boolean(summary),
    summaryStatus: state.status,
    summaryAttemptCount: state.attemptCount,
    summaryLagMs:
      state.summarizedThroughCreatedAt !== undefined &&
      state.lastUserMessageAt !== undefined
        ? Math.max(
            0,
            state.lastUserMessageAt - state.summarizedThroughCreatedAt,
          )
        : undefined,
  });

  return {
    ...selected,
    summary,
    state,
  };
}

export async function scheduleThreadHistoryCompaction(
  ctx: ActionCtx,
  threadId: Id<"threads">,
) {
  await ctx.runMutation(internal.agentHistory.scheduleCompaction, {
    threadId,
  });
}
