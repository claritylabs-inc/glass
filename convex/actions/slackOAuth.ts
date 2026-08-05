"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  missingSlackCustomerScopes,
  SLACK_CUSTOMER_SCOPES,
} from "../lib/slackOAuthPolicy";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

const internalApi = internal as any;
const REQUEST_TIMEOUT_MS = 30_000;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function redirectUri(): string {
  return (
    process.env.SLACK_OAUTH_REDIRECT_URI?.trim() ||
    `${requiredEnv("CONVEX_SITE_URL")}/slack/oauth/callback`
  );
}

function photonAuthorization(): string {
  return `Basic ${Buffer.from(
    `${requiredEnv("PHOTON_PROJECT_ID")}:${requiredEnv("PHOTON_PROJECT_SECRET")}`,
  ).toString("base64")}`;
}

function settingsRedirect(
  params: Record<string, string>,
  clientOrgId?: Id<"organizations">,
): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "https://app.glass.insure";
  const url = new URL(
    clientOrgId
      ? "/settings?section=agent&tab=channels"
      : "/settings?section=agent",
    base,
  );
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export const begin = action({
  args: {
    clientOrgId: v.id("organizations"),
    thirdPartyVisibilityAcknowledged: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    if (!args.thirdPartyVisibilityAcknowledged) {
      throw new Error(
        "Acknowledge that everyone in a channel can see Glass responses before installing.",
      );
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      { clientOrgId: args.clientOrgId, userId },
    );
    const state = await ctx.runMutation(
      internalApi.agentChannels.createOAuthState,
      {
        clientOrgId: args.clientOrgId,
        userId,
        actorKind: permission.kind,
      },
    );
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", requiredEnv("SLACK_CLIENT_ID"));
    url.searchParams.set("scope", SLACK_CUSTOMER_SCOPES.join(","));
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", state);
    return { url: url.toString() };
  },
});

type SlackOAuthResponse = {
  ok?: boolean;
  error?: string;
  app_id?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
};

type PhotonInstallationResponse = {
  succeed?: boolean;
  data?: { installationId?: string };
  message?: string;
};

async function revokeSlackToken(token: string): Promise<void> {
  await fetch("https://slack.com/api/auth.revoke", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}

async function removePhotonInstallation(
  projectId: string,
  teamId: string,
): Promise<Response> {
  return await fetch(
    `https://spectrum.photon.codes/projects/${encodeURIComponent(projectId)}/slack/installations/${encodeURIComponent(teamId)}`,
    {
      method: "DELETE",
      headers: { Authorization: photonAuthorization() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
}

export const complete = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.runMutation(
      internalApi.agentChannels.claimOAuthState,
      { state: args.state },
    );
    if (!state) {
      return settingsRedirect({ slack: "error", reason: "invalid_state" });
    }

    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("SLACK_CLIENT_ID"),
        client_secret: requiredEnv("SLACK_CLIENT_SECRET"),
        code: args.code,
        redirect_uri: redirectUri(),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const token = (await tokenResponse.json()) as SlackOAuthResponse;
    if (!tokenResponse.ok || !token.ok || !token.access_token || !token.team?.id) {
      return settingsRedirect({
        slack: "error",
        reason: token.error || "oauth_exchange_failed",
      }, state.clientOrgId);
    }

    const grantedScopes = (token.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    const missingScopes = missingSlackCustomerScopes(grantedScopes);
    if (missingScopes.length > 0) {
      await revokeSlackToken(token.access_token);
      return settingsRedirect({
        slack: "error",
        reason: "missing_scopes",
        scopes: missingScopes.join(","),
      }, state.clientOrgId);
    }

    const projectId = requiredEnv("PHOTON_PROJECT_ID");
    const photonResponse = await fetch(
      `https://spectrum.photon.codes/projects/${encodeURIComponent(projectId)}/slack/installations/${encodeURIComponent(token.team.id)}`,
      {
        method: "PUT",
        headers: {
          Authorization: photonAuthorization(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamName: token.team.name || token.team.id,
          appId: token.app_id || requiredEnv("SLACK_CLIENT_ID"),
          botToken: token.access_token,
          botRefreshToken: token.refresh_token,
          botTokenExpiresInSec: token.expires_in,
          botUserId: token.bot_user_id || "unknown",
          grantedScopes,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const installation =
      (await photonResponse.json()) as PhotonInstallationResponse;
    if (!photonResponse.ok || !installation.succeed) {
      await revokeSlackToken(token.access_token);
      return settingsRedirect({
        slack: "error",
        reason: installation.message || "photon_registration_failed",
      }, state.clientOrgId);
    }

    try {
      await ctx.runMutation(
        internalApi.agentChannels.upsertSlackConnection,
        {
          clientOrgId: state.clientOrgId,
          teamId: token.team.id,
          teamName: token.team.name || token.team.id,
          appId: token.app_id,
          installationId: installation.data?.installationId,
          botUserId: token.bot_user_id,
          grantedScopes,
          installedByUserId: state.initiatedByUserId,
          installedByOperatorUserId: state.initiatedByOperatorUserId,
        },
      );
    } catch (error) {
      await removePhotonInstallation(projectId, token.team.id).catch(
        () => undefined,
      );
      await revokeSlackToken(token.access_token);
      return settingsRedirect({
        slack: "error",
        reason: error instanceof Error ? error.message : "connection_failed",
      }, state.clientOrgId);
    }
    return settingsRedirect({ slack: "connected" }, state.clientOrgId);
  },
});

export const disconnect = action({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const authorized = await ctx.runQuery(
      internalApi.agentChannels.authorizeDisconnect,
      { clientOrgId: args.clientOrgId, userId },
    );
    if (!authorized) return { disconnected: false };

    const projectId = requiredEnv("PHOTON_PROJECT_ID");
    const response = await removePhotonInstallation(
      projectId,
      authorized.connection.teamId,
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Photon disconnect failed (${response.status})`);
    }
    await ctx.runMutation(internalApi.agentChannels.disconnectInternal, {
      connectionId: authorized.connection._id,
      actorUserId: userId,
      actorKind: authorized.actorKind,
    });
    return { disconnected: true };
  },
});
