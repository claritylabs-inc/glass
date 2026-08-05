"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const attachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
});
const WORKER_TIMEOUT_MS = 30_000;
const internalApi = internal as any;

type SlackAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
};

type SlackSendArgs = {
  idempotencyKey: string;
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  threadMessageId?: Id<"threadMessages">;
  connectionId: Id<"slackWorkspaceConnections">;
  channelId: string;
  threadTs?: string;
  content: string;
  attachments?: SlackAttachment[];
};

const sendArgs = {
  idempotencyKey: v.string(),
  orgId: v.id("organizations"),
  threadId: v.optional(v.id("threads")),
  threadMessageId: v.optional(v.id("threadMessages")),
  connectionId: v.id("slackWorkspaceConnections"),
  channelId: v.string(),
  threadTs: v.optional(v.string()),
  content: v.string(),
  attachments: v.optional(v.array(attachmentValidator)),
};

function workerConfig() {
  const url = process.env.SLACK_WORKER_URL?.trim();
  const secret = process.env.SLACK_WORKER_SECRET?.trim();
  if (!url || !secret) throw new Error("Slack worker is not configured");
  return { url: url.replace(/\/$/, ""), secret };
}

async function performSend(
  ctx: ActionCtx,
  args: {
    ledgerId: Id<"slackOutboundSends">;
    idempotencyKey: string;
    connectionId: Id<"slackWorkspaceConnections">;
    channelId: string;
    threadTs?: string;
    content: string;
    attachments?: SlackAttachment[];
  },
) {
  const target = await ctx.runQuery(internalApi.slackOutbound.getSendTarget, {
    connectionId: args.connectionId,
    channelId: args.channelId,
  });
  if (!target || target.connection.status !== "active") {
    throw new Error("Slack connection is not active");
  }
  const attachments = await Promise.all(
    (args.attachments ?? []).map(async (attachment) => ({
      ...attachment,
      url: await ctx.storage.getUrl(attachment.fileId),
    })),
  );
  if (attachments.some((attachment) => !attachment.url)) {
    throw new Error("A Slack attachment URL is unavailable");
  }
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientMessageId: args.idempotencyKey,
      teamId: target.teamId,
      channelId: args.channelId,
      threadTs: args.threadTs,
      text: args.content,
      attachments: attachments.map(({ filename, contentType, url }) => ({
        filename,
        contentType,
        url,
      })),
    }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const result = (await response.json().catch(() => ({}))) as {
    messageId?: string;
    error?: string;
    sending?: boolean;
    attachmentFailures?: Array<{ filename: string; error: string }>;
  };
  if (!response.ok) {
    throw new Error(result.error || `Slack worker returned ${response.status}`);
  }
  if (result.attachmentFailures?.length) {
    throw new Error(
      result.attachmentFailures
        .map((failure) => `${failure.filename}: ${failure.error}`)
        .join("; "),
    );
  }
  if (response.status === 202 || result.sending) {
    throw new Error("Slack worker is still processing this send");
  }
  await ctx.runMutation(internalApi.slackOutbound.markSent, {
    id: args.ledgerId,
    providerMessageId: result.messageId,
  });
}

async function sendSingle(ctx: ActionCtx, args: SlackSendArgs) {
  const claim = await ctx.runMutation(internalApi.slackOutbound.claim, args);
  if (!claim.send) return claim.row;
  try {
    await performSend(ctx, {
      ledgerId: claim.row._id,
      idempotencyKey: claim.row.idempotencyKey,
      connectionId: claim.row.connectionId,
      channelId: claim.row.channelId,
      threadTs: claim.row.threadTs,
      content: claim.row.content,
      attachments: claim.row.attachments,
    });
  } catch (error) {
    const nextAttemptAt = await ctx.runMutation(
      internalApi.slackOutbound.markFailed,
      {
        id: claim.row._id,
        error: error instanceof Error ? error.message : String(error),
        retry: true,
      },
    );
    if (nextAttemptAt) {
      await ctx.scheduler.runAt(nextAttemptAt, internalApi.actions.sendSlack.retry, {
        ledgerId: claim.row._id,
      });
    }
  }
  return await ctx.runQuery(internalApi.slackOutbound.get, {
    id: claim.row._id,
  });
}

export const send = internalAction({
  args: sendArgs,
  handler: async (ctx, args) => {
    const attachments = args.attachments ?? [];
    if (attachments.length === 0) return await sendSingle(ctx, args);
    if (!args.content.trim() && attachments.length === 1) {
      return await sendSingle(ctx, args);
    }

    const parts = [];
    if (args.content.trim()) {
      parts.push(
        await sendSingle(ctx, {
          ...args,
          idempotencyKey: `${args.idempotencyKey}:text`,
          attachments: undefined,
        }),
      );
    }
    for (const attachment of attachments) {
      parts.push(
        await sendSingle(ctx, {
          ...args,
          idempotencyKey: `${args.idempotencyKey}:file:${attachment.fileId}`,
          content: "",
          attachments: [attachment],
        }),
      );
    }
    const failed = parts.find((part) => part?.status !== "sent");
    return {
      status: failed ? "failed" as const : "sent" as const,
      providerMessageId: parts[0]?.providerMessageId,
      error: failed?.error,
      parts: parts.map((part) => part?._id),
    };
  },
});

export const retry = internalAction({
  args: { ledgerId: v.id("slackOutboundSends") },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internalApi.slackOutbound.get, {
      id: args.ledgerId,
    });
    if (!row || row.status !== "failed") return;
    await ctx.runAction(internalApi.actions.sendSlack.send, {
      idempotencyKey: row.idempotencyKey,
      orgId: row.orgId,
      threadId: row.threadId,
      threadMessageId: row.threadMessageId,
      connectionId: row.connectionId,
      channelId: row.channelId,
      threadTs: row.threadTs,
      content: row.content,
      attachments: row.attachments,
    });
  },
});
