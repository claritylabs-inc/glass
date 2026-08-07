"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { isSlackMockMode } from "../lib/slackConfig";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

const internalApi = internal as any;
const WORKER_TIMEOUT_MS = 30_000;
const MANUAL_SETUP_ERRORS = new Set([
  "not_paid",
  "paid_teams_only",
  "not_allowed",
  "access_denied",
  "enterprise_is_restricted",
  "not_allowed_for_grid_workspace",
  "not_allowed_token_type",
  "not_in_channel",
  "not_owner",
  "not_supported",
  "no_external_invite_permission",
  "no_permission",
  "missing_scope",
  "restricted_action",
  "method_not_supported_for_channel_type",
  "external_invites_disabled",
  "team_access_not_granted",
]);

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

type AvailableSlackChannel = { id: string; name: string };

async function fetchAvailableChannels(args: {
  teamId: string;
  currentChannelId?: string;
  currentChannelName?: string;
}) {
  const response = await fetch(`${requiredEnv("SLACK_WORKER_URL")}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("SLACK_WORKER_SECRET")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const result = (await response.json()) as {
    channels?: AvailableSlackChannel[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(result.channels)) {
    throw new Error(result.error ?? "Slack channels could not be loaded");
  }
  return result.channels;
}

export const createPrimaryChannel = action({
  args: {
    clientOrgId: v.id("organizations"),
    clientSlug: v.string(),
    inviteEmail: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      {
        clientOrgId: args.clientOrgId,
        userId,
      },
    );
    if (permission.kind !== "operator") {
      throwUserFacingError(
        userFacingErrorCodes.operatorRequired,
        "A Glass operator must create the hosted Slack Connect channel.",
      );
    }
    const connection = await ctx.runQuery(
      internalApi.slack.getActiveConnection,
      {
        clientOrgId: args.clientOrgId,
      },
    );

    const response = await fetch(
      `${requiredEnv("SLACK_WORKER_URL")}/connect-channel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requiredEnv("SLACK_WORKER_SECRET")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientSlug: args.clientSlug,
          inviteEmail: args.inviteEmail,
        }),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      },
    );
    const result = (await response.json()) as {
      channelId?: string;
      channelName?: string;
      inviteId?: string;
      error?: string;
    };
    if (!response.ok || !result.channelId || !result.channelName) {
      const code = result.error ?? `HTTP ${response.status}`;
      return {
        created: false as const,
        manualSetupRequired: MANUAL_SETUP_ERRORS.has(code),
        reason: code,
      };
    }
    await ctx.runMutation(
      internalApi.agentChannels.bindPrimaryChannelInternal,
      {
        clientOrgId: args.clientOrgId,
        connectionId: connection?._id,
        operatorUserId: userId,
        hostTeamId: requiredEnv("SLACK_CLARITY_TEAM_ID"),
        hostChannelId: result.channelId,
        channelName: result.channelName,
      },
    );
    return { created: true as const, ...result };
  },
});

export const listAvailableChannels = action({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.runQuery(internalApi.agentChannels.authorizeSetup, {
      clientOrgId: args.clientOrgId,
      userId,
    });
    const [connection, binding] = await Promise.all([
      ctx.runQuery(internalApi.slack.getActiveConnection, {
        clientOrgId: args.clientOrgId,
      }),
      ctx.runQuery(internalApi.agentChannels.getPrimarySlackBindingForSetup, {
        clientOrgId: args.clientOrgId,
      }),
    ]);
    if (!connection) throw new Error("The Slack workspace is not connected");
    if (!binding) throw new Error("The primary Slack channel was not found");
    const currentChannelId =
      binding.customerChannelId ??
      (isSlackMockMode() ? binding.hostChannelId : undefined);
    return {
      channels: await fetchAvailableChannels({
        teamId: connection.teamId,
        currentChannelId,
        currentChannelName: currentChannelId ? binding.channelName : undefined,
      }),
    };
  },
});

export const selectPrimaryChannel = action({
  args: {
    clientOrgId: v.id("organizations"),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      { clientOrgId: args.clientOrgId, userId },
    );
    const [connection, binding] = await Promise.all([
      ctx.runQuery(internalApi.slack.getActiveConnection, {
        clientOrgId: args.clientOrgId,
      }),
      ctx.runQuery(internalApi.agentChannels.getPrimarySlackBindingForSetup, {
        clientOrgId: args.clientOrgId,
      }),
    ]);
    if (!connection) throw new Error("The Slack workspace is not connected");
    if (!binding) throw new Error("The primary Slack channel was not found");
    const channels = await fetchAvailableChannels({
      teamId: connection.teamId,
      currentChannelId:
        binding.customerChannelId ??
        (isSlackMockMode() ? binding.hostChannelId : undefined),
      currentChannelName: binding.channelName,
    });
    const channel = channels.find(
      (candidate) => candidate.id === args.channelId,
    );
    if (!channel) {
      throw new Error("Select a Slack channel that Glass has joined");
    }
    await ctx.runMutation(
      internalApi.agentChannels.selectPrimarySlackChannelInternal,
      {
        clientOrgId: args.clientOrgId,
        connectionId: connection._id,
        customerChannelId: channel.id,
        channelName: channel.name,
        actorUserId: userId,
        actorKind: permission.kind,
      },
    );
    return channel;
  },
});
