"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { formatSlackAnswerText } from "../lib/slackBlocks";

const internalApi = internal as any;
const WORKER_TIMEOUT_MS = 30_000;

function workerConfig() {
  const url = process.env.SLACK_WORKER_URL?.trim();
  const secret = process.env.SLACK_WORKER_SECRET?.trim();
  if (!url || !secret) throw new Error("Slack worker is not configured");
  return { url: url.replace(/\/$/, ""), secret };
}

export const sendInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    recipientEmail: v.string(),
    content: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, {
      userId: args.operatorUserId,
    });
    const recipient = await ctx.runQuery(
      internalApi.agentChannels.getOperatorSlackRecipientForAction,
      { recipientEmail: args.recipientEmail },
    );
    const claim = await ctx.runMutation(
      internalApi.slackOutbound.claimOperatorDirectMessage,
      {
        idempotencyKey: args.idempotencyKey,
        senderOperatorUserId: args.operatorUserId,
        recipientOperatorUserId: recipient.operatorUserId,
        teamId: recipient.teamId,
        recipientSlackUserId: recipient.slackUserId,
        recipientEmail: recipient.email,
        content: args.content,
      },
    );
    if (!claim.send) {
      if (claim.row.status === "sent") {
        return {
          status: "sent" as const,
          recipientEmail: claim.row.recipientEmail,
          recipientName: recipient.name,
          providerMessageId: claim.row.providerMessageId,
          idempotent: true,
        };
      }
      throw new Error(
        claim.row.status === "sending"
          ? "Slack message delivery is already in progress"
          : claim.row.error || "Slack message delivery failed",
      );
    }

    const worker = workerConfig();
    let providerErrorCode: string | undefined;
    try {
      const response = await fetch(`${worker.url}/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${worker.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientMessageId: `operator-agent:${claim.row._id}`,
          teamId: recipient.teamId,
          channelId: recipient.slackUserId,
          mrkdwnText: formatSlackAnswerText(args.content),
        }),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      });
      const result = (await response.json().catch(() => ({}))) as {
        messageId?: string;
        error?: string;
        providerErrorCode?: string;
        sending?: boolean;
      };
      if (!response.ok || response.status === 202 || result.sending) {
        providerErrorCode = result.providerErrorCode;
        const error =
          result.error ||
          (response.status === 202
            ? "Slack worker is still processing this send"
            : `Slack worker returned ${response.status}`);
        throw new Error(error);
      }
      if (!result.messageId) {
        throw new Error("Slack did not return a message timestamp");
      }
      await ctx.runMutation(
        internalApi.slackOutbound.markOperatorDirectMessageSent,
        { id: claim.row._id, providerMessageId: result.messageId },
      );
      return {
        status: "sent" as const,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        providerMessageId: result.messageId,
        idempotent: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internalApi.slackOutbound.markOperatorDirectMessageFailed,
        { id: claim.row._id, error: message, providerErrorCode },
      );
      throw error;
    }
  },
});
