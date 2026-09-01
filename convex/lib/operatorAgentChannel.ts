import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const internalApi = internal as any;

export function operatorConfirmationDecision(
  content: string,
): "approve" | "reject" | undefined {
  const normalized = content.trim().toLowerCase();
  if (normalized === "approve") return "approve";
  if (normalized === "reject") return "reject";
  return undefined;
}

export async function handleOperatorChannelConfirmation(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    channel: "slack" | "imessage";
    content: string;
  },
) {
  const decision = operatorConfirmationDecision(args.content);
  if (!decision) return null;
  const confirmation = await ctx.runQuery(
    internalApi.operatorAgent.getPendingConfirmationInternal,
    {
      operatorUserId: args.operatorUserId,
      threadId: args.threadId,
    },
  );
  if (!confirmation) return null;
  return await ctx.runMutation(
    internalApi.operatorAgent.confirmActionInternal,
    {
      operatorUserId: args.operatorUserId,
      channel: args.channel,
      threadId: args.threadId,
      confirmationId: confirmation._id,
      decision,
    },
  );
}

export async function waitForOperatorAgentRun(
  ctx: ActionCtx,
  operatorUserId: Id<"users">,
  runId: Id<"operatorAgentRuns">,
) {
  const deadline = dayjs().add(4, "minute").valueOf();
  while (dayjs().valueOf() < deadline) {
    const result = await ctx.runQuery(
      internalApi.operatorAgent.getRunResultForOperatorInternal,
      { operatorUserId, runId },
    );
    if (
      result?.run?.status === "completed" ||
      result?.run?.status === "waiting_confirmation"
    ) {
      return result;
    }
    if (
      result?.run?.status === "failed" ||
      result?.run?.status === "cancelled"
    ) {
      throw new Error(
        result.run.lastError ?? `Operator agent run ${result.run.status}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Operator agent run timed out");
}
