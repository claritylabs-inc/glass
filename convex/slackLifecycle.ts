import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const internalApi = internal as any;
const MAX_LIFECYCLE_ATTEMPTS = 3;
const OUTBOUND_SUSPEND_BATCH = 100;
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1_000;
const RECONCILIATION_TRANSIENT_BASE_MS = 60 * 1_000;

const lifecycleSourceValidator = v.union(
  v.literal("slack"),
  v.literal("reconciliation"),
  v.literal("provider"),
);

const lifecycleArgs = {
  source: lifecycleSourceValidator,
  eventKey: v.string(),
  providerEventId: v.optional(v.string()),
  eventType: v.string(),
  teamId: v.optional(v.string()),
  authorizationTeamId: v.optional(v.string()),
  apiAppId: v.optional(v.string()),
  botUserIds: v.optional(v.array(v.string())),
  channelId: v.optional(v.string()),
  oldChannelId: v.optional(v.string()),
  newChannelId: v.optional(v.string()),
  channelName: v.optional(v.string()),
  connectedTeamId: v.optional(v.string()),
  previouslyConnectedTeamId: v.optional(v.string()),
  isExtShared: v.optional(v.boolean()),
  payloadHash: v.optional(v.string()),
  eventAt: v.number(),
  receivedAt: v.number(),
};

type LifecycleEvent = Doc<"slackLifecycleEvents">;
type Connection = Doc<"slackWorkspaceConnections">;
type Binding = Doc<"slackChannelBindings">;

function connectionIsHealthy(connection: Connection | null | undefined) {
  return (
    connection?.status === "active" && connection.healthStatus !== "degraded"
  );
}

async function connectionByTeam(ctx: QueryCtx | MutationCtx, teamId: string) {
  for (const status of ["active", "revoked", "disconnected"] as const) {
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("team_status", (q) =>
        q.eq("teamId", teamId).eq("status", status),
      )
      .order("desc")
      .first();
    if (connection) return connection;
  }
  return null;
}

async function bindingForConnection(
  ctx: QueryCtx | MutationCtx,
  connectionId: Id<"slackWorkspaceConnections">,
) {
  for (const status of ["active", "unavailable"] as const) {
    const binding = await ctx.db
      .query("slackChannelBindings")
      .withIndex("connection_status", (q) =>
        q.eq("connectionId", connectionId).eq("status", status),
      )
      .order("desc")
      .first();
    if (binding) return binding;
  }
  return null;
}

async function bindingForEvent(
  ctx: MutationCtx,
  event: LifecycleEvent,
): Promise<{
  binding: Binding;
  connection: Connection | null;
  side: "host" | "customer";
} | null> {
  const teamId = event.authorizationTeamId ?? event.teamId;
  const channelId = event.oldChannelId ?? event.channelId;
  if (!teamId || !channelId) return null;

  const hostBinding = await ctx.db
    .query("slackChannelBindings")
    .withIndex("host_channel", (q) =>
      q.eq("hostTeamId", teamId).eq("hostChannelId", channelId),
    )
    .order("desc")
    .first();
  if (hostBinding && hostBinding.status !== "archived") {
    return {
      binding: hostBinding,
      connection: hostBinding.connectionId
        ? await ctx.db.get(hostBinding.connectionId)
        : null,
      side: "host",
    };
  }

  const connection = await connectionByTeam(ctx, teamId);
  if (!connection) return null;
  const binding = await bindingForConnection(ctx, connection._id);
  if (
    !binding ||
    (binding.customerChannelId !== channelId &&
      binding.previousCustomerChannelId !== channelId)
  ) {
    return null;
  }
  return { binding, connection, side: "customer" };
}

function eventPredatesAuthorization(
  event: LifecycleEvent,
  connection: Connection,
) {
  return Boolean(
    connection.authorizationUpdatedAt &&
    dayjs(event.eventAt).isBefore(dayjs(connection.authorizationUpdatedAt)),
  );
}

function eventPredatesBinding(event: LifecycleEvent, binding: Binding) {
  return Boolean(binding.boundAt && event.eventAt <= binding.boundAt);
}

async function terminalizeOutboundRows(
  ctx: MutationCtx,
  connectionId: Id<"slackWorkspaceConnections">,
  reason: string,
  providerErrorCode?: string,
) {
  let foundFullBatch = false;
  for (const status of ["sending", "failed"] as const) {
    const rows = await ctx.db
      .query("slackOutboundSends")
      .withIndex("retry_schedule", (q) => {
        const indexed = q.eq("connectionId", connectionId).eq("status", status);
        return status === "failed" ? indexed.gt("nextAttemptAt", 0) : indexed;
      })
      .take(OUTBOUND_SUSPEND_BATCH);
    foundFullBatch ||= rows.length === OUTBOUND_SUSPEND_BATCH;
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        status: "blocked",
        error: reason,
        providerErrorCode,
        failureReason: "connection_unavailable",
        retryable: false,
        nextAttemptAt: undefined,
        updatedAt: dayjs().valueOf(),
      });
      if (row.threadMessageId) {
        const message = await ctx.db.get(row.threadMessageId);
        if (message?.channel === "slack") {
          await ctx.db.patch(message._id, {
            slackDeliveryStatus: "failed",
            slackDeliveryError: reason,
          });
        }
      }
    }
  }
  if (foundFullBatch) {
    await ctx.scheduler.runAfter(
      0,
      internalApi.slackLifecycle.suspendOutbound,
      {
        connectionId,
        reason,
        providerErrorCode,
      },
    );
  }
}

export const suspendOutbound = internalMutation({
  args: {
    connectionId: v.id("slackWorkspaceConnections"),
    reason: v.string(),
    providerErrorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await terminalizeOutboundRows(
      ctx,
      args.connectionId,
      args.reason,
      args.providerErrorCode,
    );
  },
});

async function revokeConnection(
  ctx: MutationCtx,
  connection: Connection,
  args: {
    reason: string;
    source: "slack" | "reconciliation" | "provider";
    sourceEventKey: string;
    occurredAt: number;
    providerErrorCode?: string;
    providerErrorSummary?: string;
  },
) {
  if (connection.status === "disconnected") return false;
  if (connection.status === "revoked") return false;
  if (connection.nativeInstallationId) {
    const installation = await ctx.db.get(connection.nativeInstallationId);
    if (installation && installation.status !== "disconnected") {
      await ctx.db.patch(installation._id, {
        status: "revoked",
        encryptedBotToken: undefined,
        encryptedRefreshToken: undefined,
        botTokenExpiresAt: undefined,
        updatedAt: dayjs().valueOf(),
      });
    }
  }
  const now = dayjs().valueOf();
  await ctx.db.patch(connection._id, {
    status: "revoked",
    healthStatus: "degraded",
    healthReason: args.reason,
    healthSource: args.source,
    healthSourceEventKey: args.sourceEventKey,
    providerErrorCode: args.providerErrorCode,
    providerErrorSummary: args.providerErrorSummary,
    lastLifecycleEventAt: args.occurredAt,
    lastVerifiedAt: now,
    reconciliationFailureCount: 0,
    nextReconciliationAt: undefined,
    disconnectedAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internalApi.slackLifecycle.suspendOutbound, {
    connectionId: connection._id,
    reason: args.providerErrorSummary ?? args.reason,
    providerErrorCode: args.providerErrorCode,
  });
  return true;
}

async function processInstallationEvent(
  ctx: MutationCtx,
  event: LifecycleEvent,
) {
  const teamId = event.teamId ?? event.authorizationTeamId;
  if (!teamId)
    return {
      status: "ignored" as const,
      summary: "Missing workspace identity",
    };
  const installation = await ctx.db
    .query("slackInstallations")
    .withIndex("team_status", (q) =>
      q.eq("teamId", teamId).eq("status", "active"),
    )
    .first();
  const connection = await connectionByTeam(ctx, teamId);
  const targetBotUserId = connection?.botUserId ?? installation?.botUserId;
  if (
    event.eventType === "tokens_revoked" &&
    (!targetBotUserId || !event.botUserIds?.includes(targetBotUserId))
  ) {
    return {
      status: "ignored" as const,
      connection,
      summary: "Revoked tokens did not include the Glass bot identity",
    };
  }
  if (
    event.apiAppId &&
    (connection?.appId ?? installation?.appId) &&
    event.apiAppId !== (connection?.appId ?? installation?.appId)
  ) {
    return {
      status: "ignored" as const,
      connection,
      summary: "Event app identity did not match the installation",
    };
  }
  if (connection?.status === "disconnected") {
    return {
      status: "ignored" as const,
      connection,
      summary: "Operator-requested disconnect remains authoritative",
    };
  }
  if (connection && eventPredatesAuthorization(event, connection)) {
    return {
      status: "ignored" as const,
      connection,
      summary: "Event predates the current Slack authorization",
    };
  }

  const reason =
    event.eventType === "app_uninstalled"
      ? "app_uninstalled"
      : "bot_token_revoked";
  if (connection) {
    const changed = await revokeConnection(ctx, connection, {
      reason,
      source: "slack",
      sourceEventKey: event.eventKey,
      occurredAt: event.eventAt,
    });
    return {
      status: "succeeded" as const,
      connection,
      summary: changed
        ? `Slack connection revoked: ${reason}`
        : "Connection already unavailable",
    };
  }
  if (!installation) {
    return { status: "ignored" as const, summary: "No matching installation" };
  }

  await ctx.db.patch(installation._id, {
    status: "revoked",
    encryptedBotToken: undefined,
    encryptedRefreshToken: undefined,
    botTokenExpiresAt: undefined,
    updatedAt: dayjs().valueOf(),
  });
  const bindings = await ctx.db
    .query("slackChannelBindings")
    .withIndex("host_channel", (q) =>
      q.eq("hostTeamId", teamId),
    )
    .take(100);
  for (const binding of bindings) {
    if (binding.status === "archived") continue;
    await ctx.db.patch(binding._id, {
      status: "unavailable",
      unavailableReason: "host_installation_revoked",
      healthStatus: "degraded",
      healthSource: "slack",
      healthSourceEventKey: event.eventKey,
      lastLifecycleEventAt: event.eventAt,
      updatedAt: dayjs().valueOf(),
    });
    if (binding.connectionId) {
      await ctx.scheduler.runAfter(
        0,
        internalApi.slackLifecycle.suspendOutbound,
        {
          connectionId: binding.connectionId,
          reason: "The Clarity Slack host installation is unavailable",
        },
      );
    }
  }
  return {
    status: "succeeded" as const,
    summary: `Slack host installation revoked; ${bindings.length} bindings suspended`,
  };
}

function normalizedChannelEventType(eventType: string) {
  return eventType.startsWith("group_")
    ? `channel_${eventType.slice("group_".length)}`
    : eventType;
}

async function remapCustomerChannel(
  ctx: MutationCtx,
  connection: Connection | null,
  binding: Binding,
  oldChannelId: string,
  newChannelId: string,
) {
  if (!connection) return;
  const oldMembership = await ctx.db
    .query("slackChannelMemberships")
    .withIndex("connection_channel", (q) =>
      q.eq("connectionId", connection._id).eq("channelId", oldChannelId),
    )
    .first();
  const newMembership = await ctx.db
    .query("slackChannelMemberships")
    .withIndex("connection_channel", (q) =>
      q.eq("connectionId", connection._id).eq("channelId", newChannelId),
    )
    .first();
  if (oldMembership && !newMembership) {
    await ctx.db.patch(oldMembership._id, {
      channelId: newChannelId,
      lastSyncedAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
  } else if (oldMembership && newMembership) {
    await ctx.db.patch(oldMembership._id, {
      status: "removed",
      lastSyncedAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
  }
  if (connection.automaticChannelId === oldChannelId) {
    await ctx.db.patch(connection._id, {
      automaticChannelId: newChannelId,
      updatedAt: dayjs().valueOf(),
    });
  }
  await ctx.db.patch(binding._id, {
    previousCustomerChannelId: oldChannelId,
    customerChannelId: newChannelId,
  });
}

async function processChannelEvent(ctx: MutationCtx, event: LifecycleEvent) {
  const target = await bindingForEvent(ctx, event);
  if (!target) {
    return {
      status: "ignored" as const,
      summary: "No selected primary binding matched the event",
    };
  }
  const { binding, connection, side } = target;
  if (eventPredatesBinding(event, binding)) {
    return {
      status: "ignored" as const,
      binding,
      connection,
      summary: "Event predates the current primary-channel binding",
    };
  }
  const eventType = normalizedChannelEventType(event.eventType);
  const now = dayjs().valueOf();
  const basePatch = {
    healthSource: "slack" as const,
    healthSourceEventKey: event.eventKey,
    lastLifecycleEventAt: event.eventAt,
    updatedAt: now,
  };

  if (eventType === "channel_rename") {
    if (!event.channelName) {
      return {
        status: "ignored" as const,
        binding,
        connection,
        summary: "Rename omitted the new channel name",
      };
    }
    await ctx.db.patch(binding._id, {
      ...basePatch,
      channelName: event.channelName,
    });
    return {
      status: "succeeded" as const,
      binding,
      connection,
      summary: `Primary channel renamed to #${event.channelName}`,
    };
  }

  if (eventType === "channel_id_changed") {
    if (!event.oldChannelId || !event.newChannelId) {
      return {
        status: "ignored" as const,
        binding,
        connection,
        summary: "Channel ID change omitted old or new identity",
      };
    }
    if (side === "host") {
      await ctx.db.patch(binding._id, {
        ...basePatch,
        previousHostChannelId: event.oldChannelId,
        hostChannelId: event.newChannelId,
      });
    } else {
      await remapCustomerChannel(
        ctx,
        connection,
        binding,
        event.oldChannelId,
        event.newChannelId,
      );
      await ctx.db.patch(binding._id, basePatch);
    }
    return {
      status: "succeeded" as const,
      binding,
      connection,
      summary: `Primary ${side} channel ID updated`,
    };
  }

  if (
    eventType === "channel_archive" ||
    eventType === "channel_deleted" ||
    eventType === "channel_unshared"
  ) {
    const channelReason =
      eventType === "channel_archive"
        ? "channel_archived"
        : eventType === "channel_deleted"
          ? "channel_deleted"
          : "channel_unshared";
    const unavailableReason =
      side === "host" ? `host_${channelReason}` : channelReason;
    await ctx.db.patch(binding._id, {
      ...basePatch,
      status: "unavailable",
      healthStatus: "degraded",
      unavailableReason,
      providerErrorCode: undefined,
      providerErrorSummary: undefined,
    });
    if (connection) {
      await ctx.scheduler.runAfter(
        0,
        internalApi.slackLifecycle.suspendOutbound,
        {
          connectionId: connection._id,
          reason: unavailableReason,
        },
      );
    }
    return {
      status: "succeeded" as const,
      binding,
      connection,
      summary: `Primary ${side} channel unavailable: ${unavailableReason}`,
    };
  }

  if (eventType === "channel_unarchive") {
    if (
      binding.status !== "unavailable" ||
      binding.unavailableReason !==
        (side === "host" ? "host_channel_archived" : "channel_archived") ||
      !connectionIsHealthy(connection)
    ) {
      return {
        status: "ignored" as const,
        binding,
        connection,
        summary: "Unarchive did not satisfy safe reactivation conditions",
      };
    }
    await ctx.db.patch(binding._id, {
      ...basePatch,
      status: "active",
      healthStatus: "healthy",
      unavailableReason: undefined,
      lastHealthyAt: now,
    });
    return {
      status: "succeeded" as const,
      binding,
      connection,
      summary: "Primary channel reactivated after unarchive",
    };
  }

  if (eventType === "channel_shared") {
    const counterpart =
      side === "host" ? connection?.teamId : binding.hostTeamId;
    if (
      event.connectedTeamId &&
      counterpart &&
      event.connectedTeamId !== counterpart
    ) {
      return {
        status: "ignored" as const,
        binding,
        connection,
        summary: "Share event involved a different workspace",
      };
    }
    const mayReactivate =
      binding.status === "unavailable" &&
      binding.unavailableReason ===
        (side === "host" ? "host_channel_unshared" : "channel_unshared") &&
      connectionIsHealthy(connection);
    await ctx.db.patch(binding._id, {
      ...basePatch,
      ...(event.channelName ? { channelName: event.channelName } : {}),
      ...(mayReactivate
        ? {
            status: "active" as const,
            healthStatus: "healthy" as const,
            unavailableReason: undefined,
            lastHealthyAt: now,
          }
        : {}),
    });
    return {
      status: "succeeded" as const,
      binding,
      connection,
      summary: mayReactivate
        ? "Primary channel re-share restored reachability"
        : "Primary channel share metadata refreshed",
    };
  }

  return {
    status: "ignored" as const,
    binding,
    connection,
    summary: `Unsupported lifecycle event: ${event.eventType}`,
  };
}

async function applyLifecycleEvent(ctx: MutationCtx, event: LifecycleEvent) {
  if (
    event.eventType === "app_uninstalled" ||
    event.eventType === "tokens_revoked"
  ) {
    return await processInstallationEvent(ctx, event);
  }
  return await processChannelEvent(ctx, event);
}

export const claim = internalMutation({
  args: lifecycleArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slackLifecycleEvents")
      .withIndex("event", (q) => q.eq("eventKey", args.eventKey))
      .first();
    if (existing) {
      return {
        duplicate: true as const,
        eventId: existing._id,
        status: existing.status,
      };
    }
    const eventId = await ctx.db.insert("slackLifecycleEvents", {
      ...args,
      status: "claimed",
      attempts: 0,
    });
    await ctx.scheduler.runAfter(0, internalApi.slackLifecycle.process, {
      eventId,
    });
    return { duplicate: false as const, eventId, status: "claimed" as const };
  },
});

export const process = internalMutation({
  args: { eventId: v.id("slackLifecycleEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (
      !event ||
      event.status === "succeeded" ||
      event.status === "ignored" ||
      event.attempts >= MAX_LIFECYCLE_ATTEMPTS
    ) {
      return null;
    }
    const attempts = event.attempts + 1;
    await ctx.db.patch(event._id, {
      status: "processing",
      attempts,
      lastError: undefined,
    });
    try {
      const result = await applyLifecycleEvent(ctx, { ...event, attempts });
      const resultConnection =
        "connection" in result ? result.connection : undefined;
      const resultBinding = "binding" in result ? result.binding : undefined;
      await ctx.db.patch(event._id, {
        status: result.status,
        connectionId: resultConnection?._id,
        bindingId: resultBinding?._id,
        clientOrgId:
          resultConnection?.clientOrgId ?? resultBinding?.clientOrgId,
        resultSummary: result.summary,
        processedAt: dayjs().valueOf(),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.db.patch(event._id, {
        status: "failed",
        lastError: message.slice(0, 500),
        processedAt: dayjs().valueOf(),
      });
      if (attempts < MAX_LIFECYCLE_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          attempts * 30_000,
          internalApi.slackLifecycle.process,
          { eventId: event._id },
        );
      }
      return null;
    }
  },
});

export const listRecentForClient = internalQuery({
  args: { clientOrgId: v.id("organizations"), limit: v.number() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("slackLifecycleEvents")
      .withIndex("client_received", (q) =>
        q.eq("clientOrgId", args.clientOrgId),
      )
      .order("desc")
      .take(Math.max(1, Math.min(25, Math.floor(args.limit)))),
});

export const getHealthSummary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const activeConnections = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("reconcile_schedule", (q) =>
        q.eq("status", "active"),
      )
      .take(500);
    const degradedConnections = activeConnections.filter(
      (connection) => connection.healthStatus === "degraded",
    );
    const unavailableBindings = await ctx.db
      .query("slackChannelBindings")
      .take(500);
    const latestVerificationAt = activeConnections.reduce<number | undefined>(
      (latest, connection) =>
        connection.lastVerifiedAt &&
        (!latest || connection.lastVerifiedAt > latest)
          ? connection.lastVerifiedAt
          : latest,
      undefined,
    );
    return {
      activeConnections: activeConnections.length,
      degradedConnections: degradedConnections.length,
      unavailableBindings: unavailableBindings.filter(
        (binding) => binding.status === "unavailable",
      ).length,
      latestVerificationAt: latestVerificationAt ?? null,
      reconciliationIntervalMs: RECONCILIATION_INTERVAL_MS,
    };
  },
});

export const listDueReconciliationContexts = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const connections = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("reconcile_schedule", (q) =>
        q.eq("status", "active"),
      )
      .take(200);
    const due = connections
      .filter(
        (connection) =>
          connection.nextReconciliationAt === undefined ||
          connection.nextReconciliationAt <= args.now,
      )
      .slice(0, Math.max(1, Math.min(25, Math.floor(args.limit))));
    return await Promise.all(
      due.map(async (connection) => ({
        connection,
        binding: await bindingForConnection(ctx, connection._id),
      })),
    );
  },
});

const reconciliationChannelValidator = v.object({
  id: v.string(),
  ok: v.boolean(),
  name: v.optional(v.string()),
  isArchived: v.optional(v.boolean()),
  isMember: v.optional(v.boolean()),
  isPrivate: v.optional(v.boolean()),
  isShared: v.optional(v.boolean()),
  isExtShared: v.optional(v.boolean()),
  isOrgShared: v.optional(v.boolean()),
  errorCode: v.optional(v.string()),
  retryable: v.optional(v.boolean()),
});

const DEFINITIVE_AUTH_ERRORS = new Set([
  "account_inactive",
  "invalid_auth",
  "installation_invalid",
  "installation_unavailable",
  "missing_scope",
  "not_allowed_token_type",
  "not_authed",
  "org_login_required",
  "token_expired",
  "token_revoked",
  "workspace_mismatch",
]);
const RESTORABLE_CUSTOMER_CHANNEL_REASONS = new Set([
  "channel_archived",
  "channel_not_found",
  "channel_unshared",
  "not_in_channel",
  "provider_channel_error",
]);

function reconciliationCanRestoreBinding(
  side: "customer" | "host",
  reason: string | undefined,
) {
  if (!reason) return false;
  return side === "host"
    ? reason === "host_installation_revoked" ||
        reason === "host_authorization_invalid" ||
        (reason.startsWith("host_") &&
          RESTORABLE_CUSTOMER_CHANNEL_REASONS.has(reason.slice(5)))
    : RESTORABLE_CUSTOMER_CHANNEL_REASONS.has(reason);
}

const DEFINITIVE_CHANNEL_ERRORS = new Set([
  "channel_not_found",
  "is_archived",
  "not_in_channel",
]);

export const recordProviderFailure = internalMutation({
  args: {
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    ledgerId: v.optional(v.id("slackOutboundSends")),
    operationKey: v.optional(v.string()),
    providerErrorCode: v.string(),
    errorSummary: v.string(),
    retryable: v.boolean(),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const sourceKey = args.ledgerId ?? args.operationKey?.trim();
    if (!sourceKey) {
      throw new Error("A Slack provider failure requires a durable source key");
    }
    const eventKey = `provider:${sourceKey}:${args.providerErrorCode}`;
    const existing = await ctx.db
      .query("slackLifecycleEvents")
      .withIndex("event", (q) => q.eq("eventKey", eventKey))
      .first();
    if (existing) return existing._id;
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    const binding = await bindingForConnection(ctx, connection._id);
    let summary = `Slack send failed: ${args.providerErrorCode}`;
    if (DEFINITIVE_AUTH_ERRORS.has(args.providerErrorCode)) {
      await revokeConnection(ctx, connection, {
        reason: "authorization_invalid",
        source: "provider",
        sourceEventKey: eventKey,
        occurredAt: args.occurredAt,
        providerErrorCode: args.providerErrorCode,
        providerErrorSummary: args.errorSummary,
      });
      summary = "Slack authorization rejected an outbound delivery";
    } else if (
      binding &&
      DEFINITIVE_CHANNEL_ERRORS.has(args.providerErrorCode) &&
      [
        binding.hostChannelId,
        binding.customerChannelId,
        binding.previousHostChannelId,
        binding.previousCustomerChannelId,
      ].includes(args.channelId)
    ) {
      const channelReason =
        args.providerErrorCode === "channel_not_found"
          ? "channel_not_found"
          : args.providerErrorCode === "is_archived"
            ? "channel_archived"
            : "not_in_channel";
      const unavailableReason =
        args.channelId === binding.hostChannelId ||
        args.channelId === binding.previousHostChannelId
          ? `host_${channelReason}`
          : channelReason;
      await ctx.db.patch(binding._id, {
        status: "unavailable",
        healthStatus: "degraded",
        unavailableReason,
        healthSource: "provider",
        healthSourceEventKey: eventKey,
        providerErrorCode: args.providerErrorCode,
        providerErrorSummary: args.errorSummary,
        lastVerifiedAt: args.occurredAt,
        updatedAt: args.occurredAt,
      });
      await ctx.scheduler.runAfter(
        0,
        internalApi.slackLifecycle.suspendOutbound,
        {
          connectionId: connection._id,
          reason: args.errorSummary,
          providerErrorCode: args.providerErrorCode,
        },
      );
      summary = "Slack rejected the selected primary channel";
    } else if (args.retryable) {
      await ctx.db.patch(connection._id, {
        healthStatus: "degraded",
        healthReason: "provider_transient_error",
        healthSource: "provider",
        healthSourceEventKey: eventKey,
        providerErrorCode: args.providerErrorCode,
        providerErrorSummary: args.errorSummary,
        nextReconciliationAt: args.occurredAt,
        updatedAt: args.occurredAt,
      });
    }
    return await ctx.db.insert("slackLifecycleEvents", {
      source: "provider",
      eventKey,
      eventType: "outbound_provider_failure",
      teamId: connection.teamId,
      channelId: args.channelId,
      connectionId: connection._id,
      bindingId: binding?._id,
      clientOrgId: connection.clientOrgId,
      status: "succeeded",
      attempts: 1,
      resultSummary: summary,
      eventAt: args.occurredAt,
      receivedAt: args.occurredAt,
      processedAt: dayjs().valueOf(),
    });
  },
});

export const applyReconciliationResult = internalMutation({
  args: {
    connectionId: v.id("slackWorkspaceConnections"),
    expectedAuthorizationUpdatedAt: v.optional(v.number()),
    expectedBindingId: v.optional(v.id("slackChannelBindings")),
    expectedBindingBoundAt: v.optional(v.number()),
    side: v.union(v.literal("customer"), v.literal("host")),
    teamId: v.string(),
    checkedAt: v.number(),
    ok: v.boolean(),
    botUserId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
    channels: v.array(reconciliationChannelValidator),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.status !== "active" ||
      connection.authorizationUpdatedAt !== args.expectedAuthorizationUpdatedAt
    ) {
      return { applied: false, reason: "stale_connection_generation" };
    }
    const binding = await bindingForConnection(ctx, connection._id);
    if (
      binding?._id !== args.expectedBindingId ||
      binding?.boundAt !== args.expectedBindingBoundAt
    ) {
      return { applied: false, reason: "stale_binding_generation" };
    }
    const eventKey = [
      "reconciliation",
      connection._id,
      args.side,
      String(args.checkedAt),
    ].join(":");
    const existingEvent = await ctx.db
      .query("slackLifecycleEvents")
      .withIndex("event", (q) => q.eq("eventKey", eventKey))
      .first();
    if (existingEvent) return { applied: false, reason: "duplicate" };

    let status: "succeeded" | "failed" = args.ok ? "succeeded" : "failed";
    let summary = args.ok
      ? `${args.side} Slack installation verified`
      : `${args.side} Slack verification failed: ${args.errorCode ?? "unknown_error"}`;
    const definitiveAuthFailure =
      !args.ok &&
      (args.retryable === false ||
        (args.errorCode ? DEFINITIVE_AUTH_ERRORS.has(args.errorCode) : false));

    if (args.side === "customer") {
      if (
        args.ok &&
        connection.botUserId &&
        args.botUserId !== connection.botUserId
      ) {
        await revokeConnection(ctx, connection, {
          reason: "bot_identity_mismatch",
          source: "reconciliation",
          sourceEventKey: eventKey,
          occurredAt: args.checkedAt,
          providerErrorCode: "bot_identity_mismatch",
          providerErrorSummary:
            "Slack returned a different bot identity for this workspace.",
        });
        status = "failed";
        summary = "Customer Slack bot identity changed";
      } else if (definitiveAuthFailure) {
        await revokeConnection(ctx, connection, {
          reason: "authorization_invalid",
          source: "reconciliation",
          sourceEventKey: eventKey,
          occurredAt: args.checkedAt,
          providerErrorCode: args.errorCode,
          providerErrorSummary: args.errorSummary,
        });
      } else if (!args.ok) {
        const failures = (connection.reconciliationFailureCount ?? 0) + 1;
        await ctx.db.patch(connection._id, {
          healthStatus: "degraded",
          healthReason: "verification_failed",
          healthSource: "reconciliation",
          healthSourceEventKey: eventKey,
          providerErrorCode: args.errorCode,
          providerErrorSummary: args.errorSummary,
          lastVerifiedAt: args.checkedAt,
          reconciliationFailureCount: failures,
          nextReconciliationAt: dayjs(args.checkedAt)
            .add(
              Math.min(
                RECONCILIATION_INTERVAL_MS,
                RECONCILIATION_TRANSIENT_BASE_MS *
                  2 ** Math.min(failures - 1, 4),
              ),
              "millisecond",
            )
            .valueOf(),
          updatedAt: args.checkedAt,
        });
      } else {
        await ctx.db.patch(connection._id, {
          healthStatus: "healthy",
          healthReason: undefined,
          healthSource: "reconciliation",
          healthSourceEventKey: eventKey,
          providerErrorCode: undefined,
          providerErrorSummary: undefined,
          lastVerifiedAt: args.checkedAt,
          lastHealthyAt: args.checkedAt,
          reconciliationFailureCount: 0,
          nextReconciliationAt: dayjs(args.checkedAt)
            .add(RECONCILIATION_INTERVAL_MS, "millisecond")
            .valueOf(),
          updatedAt: args.checkedAt,
        });
      }
    } else if (!args.ok && binding) {
      await ctx.db.patch(binding._id, {
        ...(definitiveAuthFailure
          ? {
              status: "unavailable" as const,
              unavailableReason: "host_authorization_invalid",
            }
          : {}),
        healthStatus: "degraded",
        healthSource: "reconciliation",
        healthSourceEventKey: eventKey,
        providerErrorCode: args.errorCode,
        providerErrorSummary: args.errorSummary,
        lastVerifiedAt: args.checkedAt,
        reconciliationFailureCount:
          (binding.reconciliationFailureCount ?? 0) + 1,
        updatedAt: args.checkedAt,
      });
    }

    if (args.ok && binding) {
      const selectedId =
        args.side === "host"
          ? binding.hostChannelId
          : binding.customerChannelId;
      const channel = selectedId
        ? args.channels.find((candidate) => candidate.id === selectedId)
        : undefined;
      if (channel) {
        const definitiveChannelFailure =
          !channel.ok && channel.retryable === false;
        const channelReason = channel.ok
          ? channel.isArchived
            ? "channel_archived"
            : !channel.isMember
              ? "not_in_channel"
              : args.side === "customer" && !channel.isExtShared
                ? "channel_unshared"
                : undefined
          : definitiveChannelFailure
            ? channel.errorCode === "channel_not_found"
              ? "channel_not_found"
              : channel.errorCode === "is_archived"
                ? "channel_archived"
                : channel.errorCode === "not_in_channel"
                  ? "not_in_channel"
                  : "provider_channel_error"
            : undefined;
        const unavailableReason = channelReason
          ? args.side === "host"
            ? `host_${channelReason}`
            : channelReason
          : undefined;
        if (unavailableReason) {
          await ctx.db.patch(binding._id, {
            status: "unavailable",
            healthStatus: "degraded",
            unavailableReason,
            healthSource: "reconciliation",
            healthSourceEventKey: eventKey,
            providerErrorCode: channel.errorCode,
            providerErrorSummary: `The ${args.side} primary channel is unavailable: ${unavailableReason}.`,
            lastVerifiedAt: args.checkedAt,
            updatedAt: args.checkedAt,
          });
          await ctx.scheduler.runAfter(
            0,
            internalApi.slackLifecycle.suspendOutbound,
            {
              connectionId: connection._id,
              reason: unavailableReason,
              providerErrorCode: channel.errorCode,
            },
          );
          summary += `; primary channel unavailable (${unavailableReason})`;
        } else if (!channel.ok) {
          await ctx.db.patch(binding._id, {
            healthStatus: "degraded",
            healthSource: "reconciliation",
            healthSourceEventKey: eventKey,
            providerErrorCode: channel.errorCode,
            providerErrorSummary: `Slack could not verify the ${args.side} primary channel.`,
            lastVerifiedAt: args.checkedAt,
            reconciliationFailureCount:
              (binding.reconciliationFailureCount ?? 0) + 1,
            updatedAt: args.checkedAt,
          });
        } else if (
          binding.status === "active" ||
          reconciliationCanRestoreBinding(args.side, binding.unavailableReason)
        ) {
          await ctx.db.patch(binding._id, {
            status: "active",
            healthStatus: "healthy",
            unavailableReason: undefined,
            healthSource: "reconciliation",
            healthSourceEventKey: eventKey,
            providerErrorCode: undefined,
            providerErrorSummary: undefined,
            ...(channel.name ? { channelName: channel.name } : {}),
            lastVerifiedAt: args.checkedAt,
            lastHealthyAt: args.checkedAt,
            reconciliationFailureCount: 0,
            updatedAt: args.checkedAt,
          });
        }
      }
    }

    await ctx.db.insert("slackLifecycleEvents", {
      source: "reconciliation",
      eventKey,
      eventType: "reconciliation_check",
      teamId: args.teamId,
      authorizationTeamId: args.teamId,
      botUserIds: args.botUserId ? [args.botUserId] : undefined,
      connectionId: connection._id,
      bindingId: binding?._id,
      clientOrgId: connection.clientOrgId,
      status,
      attempts: 1,
      resultSummary: summary,
      lastError: args.ok ? undefined : args.errorSummary,
      eventAt: args.checkedAt,
      receivedAt: args.checkedAt,
      processedAt: dayjs().valueOf(),
    });
    return { applied: true, status, summary };
  },
});
