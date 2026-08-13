"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildSlackClassicFinalBlocks,
  buildSlackFinalBlocks,
  buildSlackProgressBlocks,
  slackProgressTasks,
  type SlackBlock,
} from "../lib/slackBlocks";

const internalApi = internal as any;
const WORKER_TIMEOUT_MS = 30_000;

function workerConfig() {
  const url = process.env.SLACK_WORKER_URL?.trim();
  const secret = process.env.SLACK_WORKER_SECRET?.trim();
  if (!url || !secret) throw new Error("Slack worker is not configured");
  return { url: url.replace(/\/$/, ""), secret };
}

async function workerRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const worker = workerConfig();
  const response = await fetch(`${worker.url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Slack worker returned ${response.status}`);
  }
  return payload;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fallbackEligible(error: unknown): boolean {
  const value = error instanceof Error ? error.message : String(error);
  return /invalid_blocks|msg_blocks_too_(?:long|many)|unsupported|unknown_type/i.test(value);
}

async function bestEffortStatus(args: {
  teamId: string;
  channelId: string;
  threadTs?: string;
  status: string;
}) {
  if (!args.threadTs) return;
  try {
    await workerRequest("/thread/status", {
      teamId: args.teamId,
      channelId: args.channelId,
      threadTs: args.threadTs,
      status: args.status,
    });
  } catch (error) {
    console.warn("[slack] Could not update assistant status", error);
  }
}

async function policyCards(
  ctx: ActionCtx,
  message: Doc<"threadMessages">,
): Promise<Doc<"policies">[]> {
  const policies = await Promise.all(
    (message.referencedPolicyIds ?? []).slice(0, 3).map(async (id) =>
      await ctx.runQuery(internalApi.policies.getInternal, { id }),
    ),
  );
  return policies.filter(
    (policy): policy is Doc<"policies"> =>
      Boolean(policy && !policy.deletedAt && policy.orgId === message.orgId),
  );
}

async function currentPresentation(
  ctx: ActionCtx,
  threadMessageId: Id<"threadMessages">,
) {
  return await ctx.runQuery(internalApi.slackPresentation.get, {
    threadMessageId,
  }) as Doc<"slackMessagePresentations"> | null;
}

async function appendAttachments(
  ctx: ActionCtx,
  presentation: Doc<"slackMessagePresentations">,
  message: Doc<"threadMessages">,
) {
  const attachments = (message.attachments ?? []).flatMap((attachment) =>
    attachment.fileId
      ? [{
          fileId: attachment.fileId,
          filename: attachment.filename,
          contentType: attachment.contentType,
        }]
      : [],
  );
  if (!attachments.length) return { status: "sent" as const };
  const result = await ctx.runAction(internalApi.actions.sendSlack.send, {
    idempotencyKey: `agent:${message._id}:attachments`,
    orgId: presentation.orgId,
    threadId: presentation.threadId,
    threadMessageId: message._id,
    connectionId: presentation.connectionId,
    channelId: presentation.channelId,
    threadTs: presentation.threadTs,
    keepAttachmentsTopLevel: presentation.threadTs === undefined,
    content: "",
    attachments,
  });
  return result;
}

export const start = internalAction({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    threadMessageId: v.id("threadMessages"),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
    recipientUserId: v.string(),
    recipientTeamId: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internalApi.slackOutbound.getSendTarget, {
      connectionId: args.connectionId,
      channelId: args.channelId,
    });
    if (!target?.connection || target.connection.clientOrgId !== args.orgId) {
      throw new Error("Slack presentation target is unavailable");
    }
    let mode: "stream" | "message" = args.threadTs ? "stream" : "message";
    const created = await ctx.runMutation(internalApi.slackPresentation.create, {
      orgId: args.orgId,
      threadId: args.threadId,
      threadMessageId: args.threadMessageId,
      connectionId: args.connectionId,
      teamId: target.teamId,
      channelId: args.channelId,
      threadTs: args.threadTs,
      mode,
    });
    const presentation = created.presentation as Doc<"slackMessagePresentations">;
    if (presentation.providerMessageId) {
      return { ...presentation, actionToken: created.actionToken };
    }

    try {
      let messageId: string;
      if (mode === "stream") {
        await bestEffortStatus({
          teamId: target.teamId,
          channelId: args.channelId,
          threadTs: args.threadTs,
          status: "is reviewing your request…",
        });
        try {
          const started = await workerRequest<{ messageId: string }>("/stream/start", {
            teamId: target.teamId,
            channelId: args.channelId,
            threadTs: args.threadTs,
            recipientUserId: args.recipientUserId,
            recipientTeamId: args.recipientTeamId,
            status: "Reviewing your request…",
          });
          messageId = started.messageId;
        } catch (error) {
          // Streaming can be unavailable in a Slack surface even when Block Kit
          // messaging is supported. Degrade this response in place, never by a
          // cohort or feature flag.
          console.warn("[slack] Stream unavailable; using a mutable message", error);
          mode = "message";
          const sent = await workerRequest<{ messageId: string }>("/send", {
            clientMessageId: `agent:${args.threadMessageId}:activity`,
            teamId: target.teamId,
            channelId: args.channelId,
            threadTs: args.threadTs,
            text: "Glass is reviewing your request.",
            blocks: buildSlackProgressBlocks({
              threadMessageId: args.threadMessageId,
              revision: 1,
            }),
          });
          messageId = sent.messageId;
        }
      } else {
        const blocks = buildSlackProgressBlocks({
          threadMessageId: args.threadMessageId,
          revision: 1,
        });
        const sent = await workerRequest<{ messageId: string }>("/send", {
          clientMessageId: `agent:${args.threadMessageId}:activity`,
          teamId: target.teamId,
          channelId: args.channelId,
          text: "Glass is reviewing your request.",
          blocks,
        });
        messageId = sent.messageId;
      }
      await ctx.runMutation(internalApi.slackPresentation.markActive, {
        id: presentation._id,
        providerMessageId: messageId,
        mode,
      });
      return { ...(await currentPresentation(ctx, args.threadMessageId)), actionToken: created.actionToken };
    } catch (error) {
      await ctx.runMutation(internalApi.slackPresentation.markFailed, {
        id: presentation._id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const projectProgress = internalAction({
  args: { threadMessageId: v.id("threadMessages") },
  handler: async (ctx, args) => {
    const [presentation, message] = await Promise.all([
      currentPresentation(ctx, args.threadMessageId),
      ctx.runQuery(internalApi.slack.getMessage, { messageId: args.threadMessageId }),
    ]);
    if (!presentation?.providerMessageId || presentation.phase !== "active" || !message) return;
    const tools = (message.agentSteps ?? []).filter(
      (step: { type: string }) => step.type === "tool",
    ) as Array<{ type: "tool"; name: string; completed?: boolean }>;
    const progressTasks = slackProgressTasks(message.agentSteps);
    const payload = presentation.mode === "stream"
      ? progressTasks
      : buildSlackProgressBlocks({
          threadMessageId: message._id,
          revision: presentation.revision + 1,
          tools,
        });
    const payloadHash = hashPayload(payload);
    if (payloadHash === presentation.lastPayloadHash) return;
    const activeTask = [...progressTasks]
      .reverse()
      .find((task) => task.status === "in_progress");
    await bestEffortStatus({
      teamId: presentation.teamId,
      channelId: presentation.channelId,
      threadTs: presentation.threadTs,
      status: activeTask
        ? `is working: ${activeTask.title}`
        : "is finalizing your answer…",
    });
    try {
      if (presentation.mode === "stream") {
        await workerRequest("/stream/append", {
          teamId: presentation.teamId,
          channelId: presentation.channelId,
          messageTs: presentation.providerMessageId,
          tasks: payload,
        });
      } else {
        await workerRequest("/message/update", {
          teamId: presentation.teamId,
          channelId: presentation.channelId,
          messageTs: presentation.providerMessageId,
          text: "Glass is reviewing your request.",
          blocks: payload,
        });
      }
      await ctx.runMutation(internalApi.slackPresentation.markActive, {
        id: presentation._id,
        providerMessageId: presentation.providerMessageId,
        lastPayloadHash: payloadHash,
      });
    } catch (error) {
      // Progress is advisory. A failed intermediate update must not fail the
      // agent run or make finalization abandon an otherwise valid message.
      console.warn("[slack] Could not project this progress revision", error);
    }
  },
});

export const finish = internalAction({
  args: {
    threadMessageId: v.id("threadMessages"),
    actionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [presentation, message] = await Promise.all([
      currentPresentation(ctx, args.threadMessageId),
      ctx.runQuery(internalApi.slack.getMessage, { messageId: args.threadMessageId }),
    ]);
    if (!presentation || !message?.content.trim()) return null;
    if (presentation.phase === "final") return presentation;
    const policies = await policyCards(ctx, message);
    const token = args.actionToken;
    const revision = presentation.revision + 1;
    const includeAnswer = presentation.mode !== "stream";
    const richBlocks = token
      ? buildSlackFinalBlocks({
          message,
          policies,
          actionToken: token,
          revision,
          showHandoff: presentation.threadTs !== undefined,
          includeAnswer,
        })
      : (includeAnswer ? [
          {
            type: "section",
            block_id: `glass-answer-${message._id}-${revision}`,
            text: { type: "mrkdwn", text: message.content.slice(0, 3000) },
          },
        ] : [] satisfies SlackBlock[]);
    const classicBlocks = token
      ? buildSlackClassicFinalBlocks({
          message,
          policies,
          actionToken: token,
          revision,
          showHandoff: presentation.threadTs !== undefined,
          includeAnswer,
        })
      : richBlocks;
    let finalBlocks = richBlocks;
    let payloadHash = hashPayload(finalBlocks);

    const deliver = async (blocks: SlackBlock[]) => {
      let providerMessageId = presentation.providerMessageId;
      if (providerMessageId && presentation.mode === "stream") {
        await workerRequest("/stream/stop", {
          teamId: presentation.teamId,
          channelId: presentation.channelId,
          messageTs: providerMessageId,
          text: message.content,
          blocks,
          tasks: [{
            id: "glass-review",
            title: "Reviewed your request",
            status: "complete",
          }],
        });
      } else if (providerMessageId) {
        await workerRequest("/message/update", {
          teamId: presentation.teamId,
          channelId: presentation.channelId,
          messageTs: providerMessageId,
          text: message.content,
          blocks,
        });
      } else {
        const sent = await workerRequest<{ messageId: string }>("/send", {
          clientMessageId: `agent:${message._id}:final`,
          teamId: presentation.teamId,
          channelId: presentation.channelId,
          threadTs: presentation.threadTs,
          text: message.content,
          blocks,
        });
        providerMessageId = sent.messageId;
      }
      if (!providerMessageId) throw new Error("Slack did not return a final message timestamp");
      return providerMessageId;
    };

    try {
      let providerMessageId: string;
      try {
        providerMessageId = await deliver(richBlocks);
      } catch (error) {
        if (classicBlocks === richBlocks || !fallbackEligible(error)) throw error;
        console.warn("[slack] Rich block types were rejected; retrying classic Block Kit", error);
        finalBlocks = classicBlocks;
        payloadHash = hashPayload(finalBlocks);
        providerMessageId = await deliver(finalBlocks);
      }
      await ctx.runMutation(internalApi.slackPresentation.markFinal, {
        id: presentation._id,
        providerMessageId,
        lastPayloadHash: payloadHash,
      });
      const attachmentDelivery = await appendAttachments(ctx, presentation, message);
      if (attachmentDelivery?.status !== "sent") {
        console.warn(
          "[slack] Final response was delivered but an attachment is still retrying",
          attachmentDelivery?.error,
        );
      }
      return await currentPresentation(ctx, message._id);
    } catch (error) {
      await ctx.runMutation(internalApi.slackPresentation.markFailed, {
        id: presentation._id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const processInteraction = internalAction({
  args: {
    interactionId: v.id("slackInteractionEvents"),
    feedbackModalOpened: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(
      internalApi.slackPresentation.getInteractionContext,
      { id: args.interactionId },
    );
    if (!context || context.interaction.status !== "processing") return;
    const { interaction, presentation, actor } = context;
    let confirmation = "Done.";
    try {
      if (interaction.actionId.startsWith("glass_response_feedback")) {
        const rating = interaction.value === "negative" ? "negative" : "positive";
        await ctx.runMutation(internalApi.slackPresentation.upsertFeedback, {
          presentationId: presentation._id,
          slackActorId: actor._id,
          rating,
        });
        if (rating === "negative" && args.feedbackModalOpened) {
          await ctx.runMutation(internalApi.slackPresentation.completeInteraction, {
            id: interaction._id,
            status: "completed",
          });
          return;
        }
        confirmation = rating === "positive"
          ? "Thanks — your feedback was recorded."
          : "Thanks — I recorded that this response needs work.";
      } else if (interaction.actionId === "glass_request_human") {
        const result = await ctx.runMutation(internalApi.slack.requestHandoffFromAgent, {
          threadId: presentation.threadId,
          slackActorId: actor._id,
        });
        confirmation = result.status === "continue_in_primary_channel"
          ? "Please ask for a human in your shared Glass support channel."
          : "A Glass service team member has been requested.";
      } else if (interaction.actionId.startsWith("glass_open_")) {
        await ctx.runMutation(internalApi.slackPresentation.completeInteraction, {
          id: interaction._id,
          status: "completed",
        });
        return;
      } else {
        await ctx.runMutation(internalApi.slackPresentation.completeInteraction, {
          id: interaction._id,
          status: "ignored",
        });
        return;
      }
      await workerRequest("/ephemeral", {
        teamId: presentation.teamId,
        channelId: presentation.channelId,
        userId: actor.slackUserId,
        threadTs: presentation.threadTs,
        text: confirmation,
      });
      await ctx.runMutation(internalApi.slackPresentation.completeInteraction, {
        id: interaction._id,
        status: "completed",
      });
    } catch (error) {
      await ctx.runMutation(internalApi.slackPresentation.completeInteraction, {
        id: interaction._id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
