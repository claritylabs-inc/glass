import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateAgentTextForOrg } from "./models";

type ThreadChannelAgentRequest = {
  execution: "thread";
  threadId: Id<"threads">;
  orgId: Id<"organizations">;
  userId: Id<"users">;
  userMessageId: Id<"threadMessages">;
  agentMessageId?: Id<"threadMessages">;
} & (
  | { surface: "web"; slackActorId?: never }
  | { surface: "slack"; slackActorId: Id<"slackActors"> }
);

type DirectChannelAgentRequest = {
  execution: "direct";
  surface: "imessage";
  orgId: Id<"organizations">;
  task: Parameters<typeof generateAgentTextForOrg>[2];
  options: Parameters<typeof generateAgentTextForOrg>[3];
  run: Parameters<typeof generateAgentTextForOrg>[4];
};

export function runChannelAgent(
  ctx: ActionCtx,
  args: ThreadChannelAgentRequest,
): Promise<void>;
export function runChannelAgent(
  ctx: ActionCtx,
  args: DirectChannelAgentRequest,
): ReturnType<typeof generateAgentTextForOrg>;
export async function runChannelAgent(
  ctx: ActionCtx,
  args: ThreadChannelAgentRequest | DirectChannelAgentRequest,
): Promise<void | Awaited<ReturnType<typeof generateAgentTextForOrg>>> {
  if (args.execution === "direct") {
    return await generateAgentTextForOrg(
      ctx,
      args.orgId,
      args.task,
      args.options,
      {
        ...args.run,
        trace: { ...args.run.trace, channel: args.surface },
      },
    );
  }
  const { execution: _, ...request } = args;
  await ctx.runAction(internal.actions.processThreadChat.run, request);
}
