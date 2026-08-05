"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { throwUserFacingError, userFacingErrorCodes } from "../lib/userFacingErrors";

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
    const permission = await ctx.runQuery(internalApi.agentChannels.authorizeSetup, {
      clientOrgId: args.clientOrgId,
      userId,
    });
    if (permission.kind !== "operator") {
      throwUserFacingError(
        userFacingErrorCodes.operatorRequired,
        "A Glass operator must create the hosted Slack Connect channel.",
      );
    }
    const connection = await ctx.runQuery(internalApi.slack.getActiveConnection, {
      clientOrgId: args.clientOrgId,
    });

    const response = await fetch(`${requiredEnv("SLACK_WORKER_URL")}/connect-channel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requiredEnv("SLACK_WORKER_SECRET")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clientSlug: args.clientSlug, inviteEmail: args.inviteEmail }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
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
    await ctx.runMutation(internalApi.agentChannels.bindPrimaryChannelInternal, {
      clientOrgId: args.clientOrgId,
      connectionId: connection?._id,
      operatorUserId: userId,
      hostTeamId: requiredEnv("SLACK_CLARITY_TEAM_ID"),
      hostChannelId: result.channelId,
      channelName: result.channelName,
    });
    return { created: true as const, ...result };
  },
});
