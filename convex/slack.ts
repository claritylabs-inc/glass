import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const internalApi = internal as any;
const DEBOUNCE_MS = 1_500;
const MAX_BATCH_SIZE = 50;

export const getActiveConnection = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("by_clientOrgId_and_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .first(),
});

const attachmentValidator = v.object({
  providerFileId: v.string(),
  filename: v.string(),
  contentType: v.string(),
  size: v.optional(v.number()),
});

type SlackClassification = Doc<"slackActors">["classification"];

async function resolveActor(
  ctx: MutationCtx,
  connection: Doc<"slackWorkspaceConnections">,
  event: Doc<"slackInboundEvents">,
) {
  const senderTeamId = event.senderTeamId;
  if (!senderTeamId) {
    throw new Error("Slack actor workspace has not been resolved");
  }
  const existing = await ctx.db
    .query("slackActors")
    .withIndex("by_connectionId_and_teamId_and_slackUserId", (q) =>
      q
        .eq("connectionId", connection._id)
        .eq("teamId", senderTeamId)
        .eq("slackUserId", event.senderUserId),
    )
    .first();
  const operator = await ctx.db
    .query("operatorProfiles")
    .withIndex("by_slackTeamId_and_slackUserId", (q) =>
      q
        .eq("slackTeamId", senderTeamId)
        .eq("slackUserId", event.senderUserId),
    )
    .first();
  const classification: SlackClassification =
    event.senderIsBot === true || event.senderUserId === connection.botUserId
      ? "bot"
      : operator?.status === "active"
        ? "glass_operator"
        : senderTeamId === connection.teamId
          ? "customer_member"
          : "external";
  const now = dayjs().valueOf();
  if (existing) {
    await ctx.db.patch(existing._id, {
      classification,
      operatorUserId: operator?.userId,
      displayName: event.senderDisplayName,
      updatedAt: now,
    });
    return { ...existing, classification, operatorUserId: operator?.userId };
  }
  const actorId = await ctx.db.insert("slackActors", {
    connectionId: connection._id,
    clientOrgId: connection.clientOrgId,
    teamId: senderTeamId,
    slackUserId: event.senderUserId,
    classification,
    operatorUserId: operator?.userId,
    displayName: event.senderDisplayName,
    createdAt: now,
    updatedAt: now,
  });
  const actor = await ctx.db.get(actorId);
  if (!actor) throw new Error("Could not create Slack actor");
  return actor;
}

function withoutMention(content: string, botUserId: string | undefined) {
  if (!botUserId) return content.trim();
  return content.replace(new RegExp(`<@${botUserId}>`, "gi"), "").trim();
}

function isResolveCommand(content: string, botUserId: string | undefined) {
  return /^(resolve|resolved|close|closed)[.!]?$/i.test(
    withoutMention(content, botUserId),
  );
}

function isHumanRequest(content: string, botUserId: string | undefined) {
  return /^(human|person|operator|handoff|human help|talk to (a )?human)[.!]?$/i.test(
    withoutMention(content, botUserId),
  );
}

async function primaryBinding(
  ctx: MutationCtx,
  connectionId: Id<"slackWorkspaceConnections">,
) {
  return await ctx.db
    .query("slackChannelBindings")
    .withIndex("by_connectionId_and_status", (q) =>
      q.eq("connectionId", connectionId).eq("status", "active"),
    )
    .first();
}

function canonicalEventKey(
  connectionId: Id<"slackWorkspaceConnections">,
  args: {
    eventKey: string;
    providerEventId?: string;
    teamId: string;
    channelId: string;
    messageTs: string;
    eventType: "message" | "edit";
  },
) {
  const editPrefix = `${args.teamId}:${args.channelId}:${args.messageTs}:edit:`;
  const revisionKey = args.eventType === "edit"
    ? args.eventKey.startsWith(editPrefix)
      ? args.eventKey.slice(editPrefix.length)
      : args.providerEventId ?? args.eventKey
    : "";
  return `${connectionId}:${args.messageTs}:${args.eventType}:${revisionKey}`;
}

async function createHandoff(
  ctx: MutationCtx,
  args: {
    connection: Doc<"slackWorkspaceConnections">;
    actorId: Id<"slackActors">;
    sourceChannelId: string;
    sourceThreadTs: string;
    sourceThreadId: Id<"threads">;
  },
) {
  const existing = await ctx.db
    .query("slackHandoffs")
    .withIndex("by_connectionId_and_sourceChannelId_and_sourceThreadTs", (q) =>
      q
        .eq("connectionId", args.connection._id)
        .eq("sourceChannelId", args.sourceChannelId)
        .eq("sourceThreadTs", args.sourceThreadTs),
    )
    .first();
  if (existing?.status === "open") return existing._id;

  const binding = await primaryBinding(ctx, args.connection._id);
  if (!binding) throw new Error("Primary Slack service channel is not configured");
  const now = dayjs().valueOf();
  const handoffId = await ctx.db.insert("slackHandoffs", {
    clientOrgId: args.connection.clientOrgId,
    connectionId: args.connection._id,
    sourceChannelId: args.sourceChannelId,
    sourceThreadTs: args.sourceThreadTs,
    primaryChannelId: binding.customerChannelId ?? binding.hostChannelId,
    sourceThreadId: args.sourceThreadId,
    createdByActorId: args.actorId,
    status: "open",
    createdAt: now,
  });
  const sourceLink = `https://slack.com/archives/${args.sourceChannelId}/p${args.sourceThreadTs.replace(".", "")}`;
  await ctx.scheduler.runAfter(0, internalApi.actions.sendSlack.send, {
    idempotencyKey: `handoff:${handoffId}`,
    orgId: args.connection.clientOrgId,
    connectionId: args.connection._id,
    channelId: binding.customerChannelId ?? binding.hostChannelId,
    content: `Human service requested in another Slack channel. <${sourceLink}|Open the request>.`,
  });
  return handoffId;
}

export const claimInbound = internalMutation({
  args: {
    eventKey: v.string(),
    providerEventId: v.optional(v.string()),
    spectrumMessageId: v.optional(v.string()),
    teamId: v.string(),
    channelId: v.string(),
    threadTs: v.string(),
    messageTs: v.string(),
    senderTeamId: v.optional(v.string()),
    senderUserId: v.string(),
    senderDisplayName: v.optional(v.string()),
    content: v.string(),
    attachment: v.optional(attachmentValidator),
    attachments: v.optional(v.array(attachmentValidator)),
    eventType: v.union(v.literal("message"), v.literal("edit")),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const duplicate = await ctx.db
      .query("slackInboundEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", args.eventKey))
      .first();
    if (duplicate) return { duplicate: true, status: duplicate.status };

    let connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("by_teamId_and_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    if (!connection) {
      const hostBinding = await ctx.db
        .query("slackChannelBindings")
        .withIndex("by_hostTeamId_and_hostChannelId", (q) =>
          q.eq("hostTeamId", args.teamId).eq("hostChannelId", args.channelId),
        )
        .first();
      if (hostBinding?.status === "active" && hostBinding.connectionId) {
        const boundConnection = await ctx.db.get(hostBinding.connectionId);
        if (boundConnection?.status === "active") connection = boundConnection;
      }
    }
    if (!connection) return { duplicate: false, status: "unknown_workspace" as const };
    const logicalEventKey = canonicalEventKey(connection._id, args);
    const mirroredDuplicate = await ctx.db
      .query("slackInboundEvents")
      .withIndex("by_canonicalEventKey", (q) =>
        q.eq("canonicalEventKey", logicalEventKey),
      )
      .first();
    if (mirroredDuplicate) {
      return { duplicate: true, status: mirroredDuplicate.status };
    }
    const settings = await ctx.db
      .query("agentChannelSettings")
      .withIndex("by_clientOrgId", (q) =>
        q.eq("clientOrgId", connection.clientOrgId),
      )
      .first();
    if (settings?.slackEnabled !== true) {
      return { duplicate: false, status: "disabled" as const };
    }
    const binding = await primaryBinding(ctx, connection._id);
    const mentionsGlass = connection.botUserId
      ? args.content.includes(`<@${connection.botUserId}>`)
      : false;
    const completesPrimaryBinding = Boolean(
      binding &&
        !binding.customerChannelId &&
        mentionsGlass &&
        args.senderTeamId === connection.teamId,
    );
    if (binding && completesPrimaryBinding) {
      await ctx.db.patch(binding._id, {
        customerChannelId: args.channelId,
        updatedAt: args.receivedAt,
      });
    }
    const isPrimaryChannel = Boolean(
      binding &&
        (binding.hostChannelId === args.channelId ||
          binding.customerChannelId === args.channelId ||
          completesPrimaryBinding),
    );
    const scheduledFor = dayjs(args.receivedAt).add(DEBOUNCE_MS, "millisecond").valueOf();
    const queued = await ctx.db
      .query("slackInboundEvents")
      .withIndex("by_connectionId_and_channelId_and_threadTs", (q) =>
        q
          .eq("connectionId", connection._id)
          .eq("channelId", args.channelId)
          .eq("threadTs", args.threadTs),
      )
      .take(MAX_BATCH_SIZE);
    for (const event of queued) {
      if (event.status === "queued") {
        await ctx.db.patch(event._id, { scheduledFor, updatedAt: args.receivedAt });
      }
    }
    const eventId = await ctx.db.insert("slackInboundEvents", {
      ...args,
      canonicalEventKey: logicalEventKey,
      connectionId: connection._id,
      isPrimaryChannel,
      mentionsGlass,
      mentionedBotUserId: mentionsGlass ? connection.botUserId : undefined,
      status: "queued",
      attemptCount: 0,
      scheduledFor,
      updatedAt: args.receivedAt,
    });
    await ctx.scheduler.runAt(
      scheduledFor,
      internal.actions.handleInboundSlack.processDebounced,
      { eventId },
    );
    return { duplicate: false, status: "queued" as const, eventId };
  },
});

export const claimBatch = internalMutation({
  args: { eventId: v.id("slackInboundEvents") },
  handler: async (ctx, args) => {
    const scheduledEvent = await ctx.db.get(args.eventId);
    const now = dayjs().valueOf();
    if (
      !scheduledEvent ||
      scheduledEvent.status !== "queued" ||
      scheduledEvent.scheduledFor > now ||
      !scheduledEvent.connectionId
    ) {
      return [];
    }
    const connectionId = scheduledEvent.connectionId;
    const queued = await ctx.db
      .query("slackInboundEvents")
      .withIndex("by_connectionId_and_channelId_and_threadTs", (q) =>
        q
          .eq("connectionId", connectionId)
          .eq("channelId", scheduledEvent.channelId)
          .eq("threadTs", scheduledEvent.threadTs),
      )
      .take(MAX_BATCH_SIZE);
    const batch = queued
      .filter((event) => event.status === "queued" && event.scheduledFor <= now)
      .sort((left, right) => left.receivedAt - right.receivedAt);
    for (const event of batch) {
      await ctx.db.patch(event._id, {
        status: "processing",
        attemptCount: event.attemptCount + 1,
        updatedAt: now,
      });
    }
    return batch;
  },
});

export const attachInboundFile = internalMutation({
  args: {
    eventId: v.id("slackInboundEvents"),
    providerFileId: v.string(),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    if (event.attachments?.length) {
      await ctx.db.patch(event._id, {
        attachments: event.attachments.map((attachment) =>
          attachment.providerFileId === args.providerFileId
            ? { ...attachment, fileId: args.fileId }
            : attachment,
        ),
        updatedAt: dayjs().valueOf(),
      });
      return;
    }
    if (event.attachment?.providerFileId === args.providerFileId) {
      await ctx.db.patch(event._id, {
        attachment: { ...event.attachment, fileId: args.fileId },
        updatedAt: dayjs().valueOf(),
      });
    }
  },
});

export const enrichInboundActor = internalMutation({
  args: {
    eventId: v.id("slackInboundEvents"),
    senderTeamId: v.string(),
    senderDisplayName: v.optional(v.string()),
    senderIsBot: v.boolean(),
    installationBotUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.status !== "processing") return;
    await ctx.db.patch(event._id, {
      senderTeamId: args.senderTeamId,
      ...(args.senderDisplayName
        ? { senderDisplayName: args.senderDisplayName }
        : {}),
      senderIsBot: args.senderIsBot,
      mentionsGlass:
        event.mentionsGlass ||
        Boolean(
          args.installationBotUserId &&
            event.content.includes(`<@${args.installationBotUserId}>`),
        ),
      mentionedBotUserId:
        args.installationBotUserId &&
        event.content.includes(`<@${args.installationBotUserId}>`)
          ? args.installationBotUserId
          : event.mentionedBotUserId,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const prepareBatch = internalMutation({
  args: { eventIds: v.array(v.id("slackInboundEvents")) },
  handler: async (ctx, args) => {
    const events = (
      await Promise.all(args.eventIds.map((eventId) => ctx.db.get(eventId)))
    ).filter((event): event is Doc<"slackInboundEvents"> => Boolean(event));
    const first = events[0];
    if (!first?.connectionId) return null;
    const connection = await ctx.db.get(first.connectionId);
    if (!connection || connection.status !== "active") return null;
    const binding = await primaryBinding(ctx, connection._id);

    let trigger:
      | {
          threadId: Id<"threads">;
          userMessageId: Id<"threadMessages">;
          agentMessageId: Id<"threadMessages">;
          actorId: Id<"slackActors">;
        }
      | undefined;
    const now = dayjs().valueOf();

    for (const event of events) {
      if (!event.senderTeamId) {
        throw new Error("Slack actor workspace has not been resolved");
      }
      const actor = await resolveActor(ctx, connection, event);
      if (actor.classification === "bot") {
        await ctx.db.patch(event._id, { status: "ignored", updatedAt: now });
        continue;
      }

      const threadChannelId = event.isPrimaryChannel && binding
        ? binding.customerChannelId ?? binding.hostChannelId
        : event.channelId;
      const existingThread = await ctx.db
        .query("threads")
        .withIndex(
          "by_slackConnectionId_and_slackChannelId_and_slackThreadTs",
          (q) =>
            q
              .eq("slackConnectionId", connection._id)
              .eq("slackChannelId", threadChannelId)
              .eq("slackThreadTs", event.threadTs),
        )
        .first();

      if (event.eventType === "edit") {
        const message = await ctx.db
          .query("threadMessages")
          .withIndex("by_slackTeamId_and_slackMessageTs", (q) =>
            q
              .eq("slackTeamId", event.teamId)
              .eq("slackMessageTs", event.messageTs),
          )
          .first();
        if (message && message.content !== event.content) {
          await ctx.db.insert("slackMessageRevisions", {
            threadMessageId: message._id,
            slackTeamId: event.teamId,
            slackMessageTs: event.messageTs,
            previousContent: message.content,
            revisedContent: event.content,
            editedAt: event.receivedAt,
          });
          await ctx.db.patch(message._id, {
            content: event.content,
            slackEditedAt: event.receivedAt,
          });
        }
        await ctx.db.patch(event._id, { status: "completed", updatedAt: now });
        continue;
      }

      const authorizedCustomer = actor.classification === "customer_member";
      const operator = actor.classification === "glass_operator";
      const mentionedBotUserId =
        event.mentionedBotUserId ?? connection.botUserId;
      const shouldRecord = event.isPrimaryChannel
        ? true
        : event.mentionsGlass || existingThread?.slackState === "active";
      if (!shouldRecord) {
        await ctx.db.patch(event._id, { status: "ignored", updatedAt: now });
        continue;
      }

      let thread = existingThread;
      if (!thread) {
        const threadId = await ctx.db.insert("threads", {
          orgId: connection.clientOrgId,
          title: `Slack - ${event.senderDisplayName ?? event.channelId}`,
          createdBy: connection.serviceUserId,
          lastMessageAt: event.receivedAt,
          originChannel: "slack",
          slackConnectionId: connection._id,
          slackChannelId: threadChannelId,
          slackThreadTs: event.threadTs,
          slackState:
            (actor.classification === "customer_member" ||
              (!event.isPrimaryChannel && operator)) &&
            event.mentionsGlass
              ? "active"
              : "resolved",
        });
        thread = await ctx.db.get(threadId);
        if (!thread) throw new Error("Could not create Slack thread");
      }

      const inboundAttachments = event.attachments ??
        (event.attachment ? [event.attachment] : []);
      const attachments = inboundAttachments.flatMap((attachment) =>
        attachment.fileId
          ? [{
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size ?? 0,
              fileId: attachment.fileId,
            }]
          : [],
      );
      const messageId = await ctx.db.insert("threadMessages", {
        threadId: thread._id,
        orgId: connection.clientOrgId,
        channel: "slack",
        role: "user",
        userId: connection.serviceUserId,
        userName: actor.displayName,
        slackActorId: actor._id,
        slackTeamId: event.teamId,
        slackUserId: event.senderUserId,
        slackMessageTs: event.messageTs,
        content:
          event.content ||
          `[Attached ${inboundAttachments.map((attachment) => attachment.filename).join(", ") || "file"}]`,
        attachments: attachments.length ? attachments : undefined,
      });
      await ctx.db.patch(thread._id, { lastMessageAt: event.receivedAt });

      if (operator && (event.isPrimaryChannel || !event.mentionsGlass)) {
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        trigger = undefined;
        await ctx.db.patch(thread._id, { slackState: "human_paused" });
      } else if (
        authorizedCustomer &&
        event.mentionsGlass &&
        isResolveCommand(event.content, mentionedBotUserId)
      ) {
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        trigger = undefined;
        await ctx.db.patch(thread._id, { slackState: "resolved" });
      } else if (authorizedCustomer && isHumanRequest(event.content, mentionedBotUserId)) {
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        trigger = undefined;
        await ctx.db.patch(thread._id, { slackState: "human_paused" });
        if (!event.isPrimaryChannel) {
          await createHandoff(ctx, {
            connection,
            actorId: actor._id,
            sourceChannelId: event.channelId,
            sourceThreadTs: event.threadTs,
            sourceThreadId: thread._id,
          });
        }
      } else if (
        (authorizedCustomer || operator) &&
        (event.mentionsGlass || thread.slackState === "active")
      ) {
        await ctx.db.patch(thread._id, { slackState: "active" });
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        const agentMessageId = await ctx.db.insert("threadMessages", {
          threadId: thread._id,
          orgId: connection.clientOrgId,
          channel: "slack",
          role: "agent",
          content: "",
          status: "processing",
          replyToMessageId: messageId,
        });
        trigger = {
          threadId: thread._id,
          userMessageId: messageId,
          agentMessageId,
          actorId: actor._id,
        };
      }
      await ctx.db.patch(event._id, { status: "completed", updatedAt: now });
    }

    return trigger
      ? {
          ...trigger,
          orgId: connection.clientOrgId,
          serviceUserId: connection.serviceUserId,
          connectionId: connection._id,
          channelId: first.channelId,
          threadTs: first.threadTs,
        }
      : null;
  },
});

export const getMessage = internalQuery({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => await ctx.db.get(args.messageId),
});

export const failEvents = internalMutation({
  args: { eventIds: v.array(v.id("slackInboundEvents")), error: v.string() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      if (event?.status === "processing") {
        const shouldRetry = event.attemptCount < 3;
        const scheduledFor = shouldRetry
          ? dayjs()
              .add(2 ** event.attemptCount, "second")
              .valueOf()
          : event.scheduledFor;
        await ctx.db.patch(eventId, {
          status: shouldRetry ? "queued" : "error",
          error: args.error,
          scheduledFor,
          updatedAt: now,
        });
        if (shouldRetry) {
          await ctx.scheduler.runAt(
            scheduledFor,
            internalApi.actions.handleInboundSlack.processDebounced,
            { eventId },
          );
        }
      }
    }
  },
});

export const recordAgentActions = internalMutation({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    threadMessageId: v.id("threadMessages"),
    slackActorId: v.id("slackActors"),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const call of args.toolCalls) {
      await ctx.db.insert("agentActionAuditEvents", {
        orgId: args.orgId,
        threadId: args.threadId,
        threadMessageId: args.threadMessageId,
        actorKind: "slack",
        slackActorId: args.slackActorId,
        authorizationKind: "slack_workspace",
        action: call.name,
        input: call.input,
        output: call.output,
        status: "succeeded",
        createdAt: dayjs().valueOf(),
      });
    }
  },
});

export const requestHandoffFromAgent = internalMutation({
  args: {
    threadId: v.id("threads"),
    slackActorId: v.id("slackActors"),
  },
  handler: async (ctx, args) => {
    const [thread, actor] = await Promise.all([
      ctx.db.get(args.threadId),
      ctx.db.get(args.slackActorId),
    ]);
    if (
      !thread?.slackConnectionId ||
      !thread.slackChannelId ||
      !thread.slackThreadTs ||
      !actor ||
      actor.connectionId !== thread.slackConnectionId
    ) {
      throw new Error("Slack handoff context is unavailable");
    }
    const connection = await ctx.db.get(thread.slackConnectionId);
    if (!connection) throw new Error("Slack connection not found");
    await ctx.db.patch(thread._id, { slackState: "human_paused" });
    const binding = await primaryBinding(ctx, connection._id);
    const isPrimary = Boolean(
      binding &&
        (binding.hostChannelId === thread.slackChannelId ||
          binding.customerChannelId === thread.slackChannelId),
    );
    if (isPrimary) return { status: "paused" as const };
    const handoffId = await createHandoff(ctx, {
      connection,
      actorId: actor._id,
      sourceChannelId: thread.slackChannelId,
      sourceThreadTs: thread.slackThreadTs,
      sourceThreadId: thread._id,
    });
    return { status: "handed_off" as const, handoffId };
  },
});

export const createDeliveryRecord = internalMutation({
  args: {
    orgId: v.id("organizations"),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    threadTs: v.string(),
    content: v.string(),
    attachment: v.object({
      fileId: v.id("_storage"),
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
    }),
    policyId: v.id("policies"),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.clientOrgId !== args.orgId) {
      throw new Error("Slack connection not found");
    }
    const existing = await ctx.db
      .query("threads")
      .withIndex(
        "by_slackConnectionId_and_slackChannelId_and_slackThreadTs",
        (q) =>
          q
            .eq("slackConnectionId", args.connectionId)
            .eq("slackChannelId", args.channelId)
            .eq("slackThreadTs", args.threadTs),
      )
      .first();
    if (existing) return existing._id;
    const now = dayjs().valueOf();
    const threadId = await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: "Slack policy delivery",
      createdBy: connection.serviceUserId,
      lastMessageAt: now,
      originChannel: "slack",
      slackConnectionId: connection._id,
      slackChannelId: args.channelId,
      slackThreadTs: args.threadTs,
      slackState: "active",
    });
    await ctx.db.insert("threadMessages", {
      threadId,
      orgId: args.orgId,
      channel: "slack",
      role: "agent",
      content: args.content,
      responseMessageId: `${args.idempotencyKey}:slack`,
      slackTeamId: connection.teamId,
      slackUserId: connection.botUserId,
      slackMessageTs: args.threadTs,
      attachments: [args.attachment],
      referencedPolicyIds: [args.policyId],
    });
    return threadId;
  },
});

export const markRevoked = internalMutation({
  args: { teamId: v.string() },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internalApi.agentChannels.revokeByTeamId, args);
  },
});
