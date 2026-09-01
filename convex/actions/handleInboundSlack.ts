"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { formatSlackAnswerText } from "../lib/slackBlocks";
import { isApprovedOperatorSlackChannel } from "../lib/operatorSlackConfig";
import {
  handleOperatorChannelConfirmation,
  waitForOperatorAgentRun,
} from "../lib/operatorAgentChannel";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
  normalizeAgentAttachmentFilename,
} from "../lib/agentAttachmentLimits";
import { isSafeOperatorSlackConversation } from "../lib/operatorSlackConfig";

const WORKER_TIMEOUT_MS = 30_000;
const internalApi = internal as any;

type OperatorAuthorizedEvent = {
  event: Doc<"slackInboundEvents">;
  operatorUserId: Id<"users">;
};

async function operatorChannelIsSafe(event: Doc<"slackInboundEvents">) {
  if (event.isDirectMessage) {
    return isSafeOperatorSlackConversation({ isDirectMessage: true });
  }
  if (!isApprovedOperatorSlackChannel(event.channelId)) return false;
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ teamId: event.teamId }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const result = (await response.json().catch(() => ({}))) as {
    channels?: Array<{
      id: string;
      isMember: boolean;
      isPrivate: boolean;
      isShared: boolean;
    }>;
  };
  if (!response.ok) return false;
  const channel = result.channels?.find(({ id }) => id === event.channelId);
  return isSafeOperatorSlackConversation({
    isDirectMessage: false,
    isMember: channel?.isMember,
    isPrivate: channel?.isPrivate,
    isShared: channel?.isShared,
  });
}

function operatorSlackContent(event: Doc<"slackInboundEvents">) {
  const withoutMention = event.mentionedBotUserId
    ? event.content.replace(
        new RegExp(`<@${event.mentionedBotUserId}>`, "gi"),
        "",
      )
    : event.content;
  const trimmed = withoutMention.trim();
  if (trimmed) return trimmed;
  const filenames = (
    event.attachments ?? (event.attachment ? [event.attachment] : [])
  ).map(({ filename }) => filename);
  return filenames.length > 0
    ? `[Attached ${filenames.join(", ")}]`
    : "Please help with this.";
}

async function sendOperatorSlackResponse(
  ctx: ActionCtx,
  args: {
    event: Doc<"slackInboundEvents">;
    runId: Id<"operatorAgentRuns">;
    response: {
      content?: string;
      attachments?: Array<{
        fileId?: Id<"_storage">;
        filename: string;
        contentType: string;
      }>;
    };
  },
) {
  const attachments = await Promise.all(
    (args.response.attachments ?? [])
      .flatMap((attachment) => (attachment.fileId ? [attachment] : []))
      .map(async (attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        url: await ctx.storage.getUrl(attachment.fileId!),
      })),
  );
  const availableAttachments = attachments.flatMap((attachment) =>
    attachment.url ? [{ ...attachment, url: attachment.url }] : [],
  );
  if (availableAttachments.length !== attachments.length) {
    throw new Error("An operator Slack attachment URL is unavailable");
  }
  const content =
    args.response.content?.trim() ||
    (availableAttachments.length > 0
      ? ""
      : "I couldn't complete that request.");
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientMessageId: `operator-agent:${args.runId}:${args.event.eventKey}`,
      teamId: args.event.teamId,
      channelId: args.event.channelId,
      threadTs: args.event.isDirectMessage
        ? args.event.replyThreadTs
        : args.event.threadTs,
      mrkdwnText: formatSlackAnswerText(content),
      attachments: availableAttachments,
    }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    sending?: boolean;
    attachmentFailures?: Array<{ filename: string; error: string }>;
  };
  if (!response.ok) {
    throw new Error(result.error ?? `Slack worker returned ${response.status}`);
  }
  if (response.status === 202 || result.sending) {
    throw new Error("Slack worker is still processing this send");
  }
  if (result.attachmentFailures?.length) {
    throw new Error(
      result.attachmentFailures
        .map(({ filename, error }) => `${filename}: ${error}`)
        .join("; "),
    );
  }
}

async function processOperatorBatch(
  ctx: ActionCtx,
  batch: Array<Doc<"slackInboundEvents">>,
) {
  const eventIds = batch.map(({ _id }) => _id);
  await Promise.all(batch.map((event) => enrichActor(ctx, event)));
  const unsafeEventIds = (
    await Promise.all(
      batch.map(async (event) => ({
        eventId: event._id,
        safe: await operatorChannelIsSafe(event),
      })),
    )
  ).flatMap(({ eventId, safe }) => (safe ? [] : [eventId]));
  if (unsafeEventIds.length > 0) {
    await ctx.runMutation(internalApi.operatorSlack.ignoreEvents, {
      eventIds: unsafeEventIds,
    });
  }
  const authorized = (await ctx.runMutation(
    internalApi.operatorSlack.authorizeBatch,
    { eventIds },
  )) as OperatorAuthorizedEvent[];
  for (const { event, operatorUserId } of authorized) {
    let refreshedEvent = (await ctx.runQuery(
      internalApi.slack.getInboundEvent,
      { eventId: event._id },
    )) as Doc<"slackInboundEvents"> | null;
    if (!refreshedEvent) continue;
    const threadId = await ctx.runMutation(
      internalApi.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId,
        channel: "slack",
        conversationKey: [
          refreshedEvent.teamId,
          refreshedEvent.channelId,
          refreshedEvent.threadTs,
        ].join(":"),
        title: refreshedEvent.isDirectMessage
          ? `Slack DM · ${refreshedEvent.senderDisplayName ?? refreshedEvent.senderUserId}`
          : `Slack · ${refreshedEvent.channelId}`,
        shared: !refreshedEvent.isDirectMessage,
      },
    );
    const content = operatorSlackContent(refreshedEvent);
    const confirmation = await handleOperatorChannelConfirmation(ctx, {
      operatorUserId,
      threadId,
      channel: "slack",
      content,
    });
    if (confirmation) {
      await sendOperatorSlackResponse(ctx, {
        event: refreshedEvent,
        runId: confirmation.runId,
        response: confirmation.response ?? { content: confirmation.content },
      });
      await ctx.runMutation(internalApi.operatorSlack.completeEvent, {
        eventId: refreshedEvent._id,
      });
      continue;
    }
    await fetchAttachment(ctx, refreshedEvent);
    refreshedEvent = (await ctx.runQuery(internalApi.slack.getInboundEvent, {
      eventId: refreshedEvent._id,
    })) as Doc<"slackInboundEvents"> | null;
    if (!refreshedEvent) continue;
    const inboundAttachments =
      refreshedEvent.attachments ??
      (refreshedEvent.attachment ? [refreshedEvent.attachment] : []);
    const queued = await ctx.runMutation(
      internalApi.operatorAgent.enqueueMessageInternal,
      {
        operatorUserId,
        threadId,
        channel: "slack",
        content,
        dedupeKey: refreshedEvent.canonicalEventKey ?? refreshedEvent.eventKey,
        attachments: inboundAttachments.flatMap((attachment) =>
          attachment.fileId
            ? [
                {
                  fileId: attachment.fileId,
                  filename: attachment.filename,
                  contentType: attachment.contentType,
                  size: attachment.size ?? 0,
                },
              ]
            : [],
        ),
      },
    );
    const result = await waitForOperatorAgentRun(
      ctx,
      operatorUserId,
      queued.runId,
    );
    await sendOperatorSlackResponse(ctx, {
      event: refreshedEvent,
      runId: queued.runId,
      response: result.response ?? {},
    });
    await ctx.runMutation(internalApi.operatorSlack.completeEvent, {
      eventId: refreshedEvent._id,
    });
  }
}

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
  const attachments =
    event.attachments ?? (event.attachment ? [event.attachment] : []);
  if (attachments.length > MAX_AGENT_ATTACHMENT_FILES) {
    throw new Error(
      `Slack messages may include at most ${MAX_AGENT_ATTACHMENT_FILES} attachments`,
    );
  }
  for (const attachment of attachments) {
    normalizeAgentAttachmentFilename(attachment.filename);
  }
  const declaredBytes = attachments.reduce((total, attachment) => {
    if (attachment.size === undefined) return total;
    if (attachment.size < 0 || attachment.size > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new Error("Slack attachment exceeds the 25 MB ingestion limit");
    }
    return total + attachment.size;
  }, 0);
  if (declaredBytes > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
    throw new Error(
      "Slack attachments exceed the 50 MB aggregate ingestion limit",
    );
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
    if (bytes.byteLength > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new Error("Slack attachment exceeds the 25 MB ingestion limit");
    }
    downloadedBytes += bytes.byteLength;
    if (downloadedBytes > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error(
        "Slack attachments exceed the 50 MB aggregate ingestion limit",
      );
    }
    downloaded.push({ attachment, bytes });
  }
  for (const { attachment, bytes } of downloaded) {
    const fileId = await ctx.storage.store(
      new Blob([bytes], { type: attachment.contentType }),
    );
    try {
      await ctx.runMutation(internalApi.slack.attachInboundFile, {
        eventId: event._id,
        providerFileId: attachment.providerFileId,
        fileId,
      });
    } catch (error) {
      await ctx.storage.delete(fileId);
      throw error;
    }
  }
}

async function enrichActor(ctx: ActionCtx, event: Doc<"slackInboundEvents">) {
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
    if (!batch[0]?.connectionId) {
      try {
        await processOperatorBatch(ctx, batch);
      } catch (error) {
        await ctx.runMutation(internalApi.slack.failEvents, {
          eventIds: batch.map(({ _id }) => _id),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      return;
    }
    const eventIds = batch.map((event: Doc<"slackInboundEvents">) => event._id);
    let presentationMessageId: Id<"threadMessages"> | undefined;
    try {
      await Promise.all(
        batch.map((event: Doc<"slackInboundEvents">) =>
          enrichActor(ctx, event),
        ),
      );
      const authorized = (await ctx.runMutation(
        internalApi.slack.authorizeBatch,
        { eventIds },
      )) as Array<Doc<"slackInboundEvents">>;
      if (authorized.length === 0) return;
      await Promise.all(authorized.map((event) => fetchAttachment(ctx, event)));
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
        console.warn(
          "[slack] Could not start rich response presentation",
          error,
        );
      }

      await ctx.runAction(internal.actions.processThreadChat.run, {
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
          ? [
              {
                fileId: attachment.fileId,
                filename: attachment.filename,
                contentType: attachment.contentType,
              },
            ]
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
          console.warn(
            "[slack] Could not recover rich response presentation",
            error,
          );
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
        console.warn(
          "[slack] Rich response failed; sending plaintext fallback",
          error,
        );
      }
      if (!deliveredRichResponse) {
        const fallback = await ctx.runAction(
          internalApi.actions.sendSlack.send,
          {
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
          },
        );
        if (fallback?.status !== "sent") {
          throw new Error(
            fallback?.error ?? "Slack plaintext fallback is retrying",
          );
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
