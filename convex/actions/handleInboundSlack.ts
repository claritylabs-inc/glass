"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { runChannelAgent } from "../lib/channelAgentRunner";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_AGGREGATE_BYTES = 50 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 30_000;
const internalApi = internal as any;

function workerConfig() {
  const url = process.env.SLACK_WORKER_URL?.trim();
  const secret = process.env.SLACK_WORKER_SECRET?.trim();
  if (!url || !secret) throw new Error("Slack worker is not configured");
  return { url: url.replace(/\/$/, ""), secret };
}

async function fetchAttachment(
  ctx: ActionCtx,
  event: Doc<"slackInboundEvents">,
) {
  const attachments = event.attachments ??
    (event.attachment ? [event.attachment] : []);
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(
      `Slack messages may include at most ${MAX_ATTACHMENT_COUNT} attachments`,
    );
  }
  const declaredBytes = attachments.reduce((total, attachment) => {
    if (attachment.size === undefined) return total;
    if (attachment.size < 0 || attachment.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Slack attachment exceeds the 25 MB ingestion limit");
    }
    return total + attachment.size;
  }, 0);
  if (declaredBytes > MAX_ATTACHMENT_AGGREGATE_BYTES) {
    throw new Error("Slack attachments exceed the 50 MB aggregate ingestion limit");
  }
  const pending = attachments.filter((attachment) => !attachment.fileId);
  if (pending.length === 0) return;
  const worker = workerConfig();
  const downloaded: Array<{
    attachment: (typeof pending)[number];
    bytes: ArrayBuffer;
  }> = [];
  let downloadedBytes = 0;
  for (const attachment of pending) {
    const response = await fetch(`${worker.url}/attachment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${worker.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        teamId: event.teamId,
        fileId: attachment.providerFileId,
      }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Slack attachment retrieval failed (${response.status})`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("Slack attachment exceeds the 25 MB ingestion limit");
    }
    downloadedBytes += bytes.byteLength;
    if (downloadedBytes > MAX_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error("Slack attachments exceed the 50 MB aggregate ingestion limit");
    }
    downloaded.push({ attachment, bytes });
  }
  for (const { attachment, bytes } of downloaded) {
    const fileId = await ctx.storage.store(
      new Blob([bytes], { type: attachment.contentType }),
    );
    await ctx.runMutation(internalApi.slack.attachInboundFile, {
      eventId: event._id,
      providerFileId: attachment.providerFileId,
      fileId,
    });
  }
}

async function enrichActor(
  ctx: ActionCtx,
  event: Doc<"slackInboundEvents">,
) {
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/actor`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      teamId: event.teamId,
      userId: event.senderUserId,
    }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const actor = (await response.json()) as {
    teamId?: string;
    userId?: string;
    displayName?: string;
    email?: string;
    isBot?: boolean;
    botUserId?: string;
    error?: string;
  };
  if (
    !response.ok ||
    !actor.teamId ||
    actor.userId !== event.senderUserId ||
    typeof actor.isBot !== "boolean"
  ) {
    throw new Error(
      actor.error ?? `Slack actor resolution failed (${response.status})`,
    );
  }
  await ctx.runMutation(internalApi.slack.enrichInboundActor, {
    eventId: event._id,
    senderTeamId: actor.teamId,
    senderDisplayName: actor.displayName,
    senderEmail: actor.email,
    senderIsBot: actor.isBot,
    installationBotUserId: actor.botUserId,
  });
}

export const processDebounced = internalAction({
  args: { eventId: v.id("slackInboundEvents") },
  handler: async (ctx, args) => {
    const batch = (await ctx.runMutation(
      internalApi.slack.claimBatch,
      args,
    )) as Array<Doc<"slackInboundEvents">>;
    if (batch.length === 0) return;
    const eventIds = batch.map((event: Doc<"slackInboundEvents">) => event._id);
    let presentationMessageId: Id<"threadMessages"> | undefined;
    try {
      await Promise.all(
        batch.map((event: Doc<"slackInboundEvents">) => enrichActor(ctx, event)),
      );
      const authorized = (await ctx.runMutation(
        internalApi.slack.authorizeBatch,
        { eventIds },
      )) as Array<Doc<"slackInboundEvents">>;
      if (authorized.length === 0) return;
      await Promise.all(
        authorized.map((event) => fetchAttachment(ctx, event)),
      );
      const prepared = await ctx.runMutation(internalApi.slack.prepareBatch, {
        eventIds: authorized.map((event) => event._id),
      });
      if (!prepared) return;
      presentationMessageId = prepared.agentMessageId;

      let actionToken: string | undefined;
      try {
        const presentation = await ctx.runAction(
          internalApi.actions.slackPresentation.start,
          {
            orgId: prepared.orgId,
            threadId: prepared.threadId,
            threadMessageId: prepared.agentMessageId,
            connectionId: prepared.connectionId,
            channelId: prepared.channelId,
            threadTs: prepared.threadTs,
          },
        );
        actionToken = presentation?.actionToken;
      } catch (error) {
        console.warn("[slack] Could not start rich response presentation", error);
      }

      await runChannelAgent(ctx, {
        execution: "thread",
        surface: "slack",
        threadId: prepared.threadId,
        orgId: prepared.orgId,
        userId: prepared.serviceUserId,
        userMessageId: prepared.userMessageId,
        agentMessageId: prepared.agentMessageId,
        slackActorId: prepared.actorId,
      });
      const response = (await ctx.runQuery(internalApi.slack.getMessage, {
        messageId: prepared.agentMessageId,
      })) as Doc<"threadMessages"> | null;
      if (!response?.content.trim()) return;
      if (response.toolCalls?.length) {
        await ctx.runMutation(internalApi.slack.recordAgentActions, {
          orgId: prepared.orgId,
          threadId: prepared.threadId,
          threadMessageId: response._id,
          slackActorId: prepared.actorId,
          toolCalls: response.toolCalls,
        });
      }
      const attachments = (response.attachments ?? []).flatMap((attachment) =>
        attachment.fileId
          ? [{
              fileId: attachment.fileId,
              filename: attachment.filename,
              contentType: attachment.contentType,
            }]
          : [],
      );
      if (!actionToken) {
        try {
          const presentation = await ctx.runAction(
            internalApi.actions.slackPresentation.start,
            {
              orgId: prepared.orgId,
              threadId: prepared.threadId,
              threadMessageId: prepared.agentMessageId,
              connectionId: prepared.connectionId,
              channelId: prepared.channelId,
              threadTs: prepared.threadTs,
            },
          );
          actionToken = presentation?.actionToken;
        } catch (error) {
          console.warn("[slack] Could not recover rich response presentation", error);
        }
      }
      let deliveredRichResponse = false;
      try {
        const finished = await ctx.runAction(
          internalApi.actions.slackPresentation.finish,
          { threadMessageId: response._id, actionToken },
        );
        deliveredRichResponse = finished?.phase === "final";
      } catch (error) {
        console.warn("[slack] Rich response failed; sending plaintext fallback", error);
      }
      if (!deliveredRichResponse) {
        const fallback = await ctx.runAction(internalApi.actions.sendSlack.send, {
          idempotencyKey: `agent:${response._id}:fallback`,
          orgId: prepared.orgId,
          threadId: prepared.threadId,
          threadMessageId: response._id,
          connectionId: prepared.connectionId,
          channelId: prepared.channelId,
          threadTs: prepared.threadTs,
          keepAttachmentsTopLevel: prepared.threadTs === undefined,
          content: response.content,
          attachments,
        });
        if (fallback?.status !== "sent") {
          throw new Error(fallback?.error ?? "Slack plaintext fallback is retrying");
        }
        const presentation = await ctx.runQuery(
          internalApi.slackPresentation.get,
          { threadMessageId: response._id },
        );
        if (presentation) {
          await ctx.runMutation(
            internalApi.slackPresentation.markPlaintextFallback,
            {
              id: presentation._id,
              providerMessageId: fallback.providerMessageId,
            },
          );
        }
      }
    } catch (error) {
      await ctx.runMutation(internalApi.slack.failEvents, {
        eventIds,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (presentationMessageId) {
        try {
          await ctx.runAction(
            internalApi.actions.slackPresentation.clearReaction,
            { threadMessageId: presentationMessageId },
          );
        } catch (error) {
          console.warn("[slack] Could not clear processing reaction", error);
        }
      }
    }
  },
});
