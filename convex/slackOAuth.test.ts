/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { createOAuthState } from "./agentChannels";
import {
  begin,
  complete,
  disconnect,
} from "./actions/slackOAuth";
import { SLACK_CUSTOMER_SCOPES } from "./lib/slackOAuthPolicy";

const modules = import.meta.glob("./**/*.ts");
const createOAuthStateFn = createOAuthState as any;
const beginFn = begin as any;
const completeFn = complete as any;
const disconnectFn = disconnect as any;

beforeEach(() => {
  vi.stubEnv("SLACK_ENABLED", "true");
  vi.stubEnv("SLACK_CLIENT_ID", "slack-client-id");
  vi.stubEnv("SLACK_CLIENT_SECRET", "slack-client-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://convex.example.test");
  vi.stubEnv("APP_URL", "https://app.example.test");
  vi.stubEnv("PHOTON_PROJECT_ID", "00000000-0000-4000-8000-000000000001");
  vi.stubEnv("PHOTON_PROJECT_SECRET", "photon-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedAdmin(t: ReturnType<typeof convexTest>, name = "Client") {
  return await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name,
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      name: `${name} Admin`,
      email: `admin@${name.toLowerCase().replace(/\s+/g, "-")}.test`,
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId,
      role: "admin",
    });
    return { clientOrgId, userId };
  });
}

async function oauthState(
  t: ReturnType<typeof convexTest>,
  clientOrgId: string,
  userId: string,
) {
  return await t.mutation(createOAuthStateFn, {
    clientOrgId,
    userId,
    actorKind: "client_admin",
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function slackTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    app_id: "A-GLASS",
    access_token: "xoxb-test-token",
    refresh_token: "xoxe-test-refresh-token",
    expires_in: 43_200,
    scope: SLACK_CUSTOMER_SCOPES.join(","),
    bot_user_id: "U-GLASS",
    team: { id: "T-CUSTOMER", name: "Customer workspace" },
    ...overrides,
  };
}

describe("Slack OAuth actions", () => {
  test("starts an acknowledged, org-bound installation without exposing state at rest", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, userId } = await seedAdmin(t);
    const admin = t.withIdentity({ subject: `${userId}|session` });

    await expect(
      admin.action(beginFn, {
        clientOrgId,
        thirdPartyVisibilityAcknowledged: false,
      }),
    ).rejects.toThrow("Acknowledge");
    const { url } = await admin.action(beginFn, {
      clientOrgId,
      thirdPartyVisibilityAcknowledged: true,
    });
    const authorizeUrl = new URL(url);
    const state = authorizeUrl.searchParams.get("state");
    expect(authorizeUrl.origin).toBe("https://slack.com");
    expect(authorizeUrl.searchParams.get("scope")?.split(",")).toEqual(
      SLACK_CUSTOMER_SCOPES,
    );
    expect(state).toBeTruthy();

    const stored = await t.run((ctx) => ctx.db.query("slackOAuthStates").first());
    expect(stored).toMatchObject({ clientOrgId });
    expect(stored?.stateHash).not.toBe(state);
  });

  test("exchanges OAuth server-side, registers Photon, and stores safe metadata", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, userId } = await seedAdmin(t);
    const state = await oauthState(t, clientOrgId, userId);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://slack.com/api/oauth.v2.access") {
        return jsonResponse(slackTokenResponse());
      }
      if (url.includes("/slack/installations/T-CUSTOMER") && init?.method === "PUT") {
        return jsonResponse({
          succeed: true,
          data: { installationId: "installation-1" },
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, { code: "oauth-code", state });
    expect(redirect).toContain("slack=connected");
    const records = await t.run(async (ctx) => ({
      connection: await ctx.db.query("slackWorkspaceConnections").first(),
      channelSettings: await ctx.db.query("agentChannelSettings").first(),
      deliverySettings: await ctx.db.query("policyDeliverySettings").first(),
    }));
    expect(records.connection).toMatchObject({
      clientOrgId,
      teamId: "T-CUSTOMER",
      installationId: "installation-1",
      botUserId: "U-GLASS",
      status: "active",
    });
    expect(JSON.stringify(records.connection)).not.toContain("xoxb-test-token");
    expect(records.channelSettings?.slackEnabled).toBe(true);
    expect(records.deliverySettings).toMatchObject({
      deliveryOwnerOrgId: clientOrgId,
      clientOrgId,
      channels: ["slack"],
      defaultAction: "auto_send",
    });
    const photonRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(photonRequest.body))).toMatchObject({
      botToken: "xoxb-test-token",
      botRefreshToken: "xoxe-test-refresh-token",
      botTokenExpiresInSec: 43_200,
    });

    const callsAfterSuccess = fetchMock.mock.calls.length;
    const replay = await t.action(completeFn, { code: "oauth-code", state });
    expect(replay).toContain("reason=invalid_state");
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterSuccess);
  });

  test("revokes incomplete-scope tokens without creating a connection", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, userId } = await seedAdmin(t);
    const state = await oauthState(t, clientOrgId, userId);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://slack.com/api/oauth.v2.access") {
        return jsonResponse(
          slackTokenResponse({ scope: "app_mentions:read,chat:write" }),
        );
      }
      if (url === "https://slack.com/api/auth.revoke") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, { code: "oauth-code", state });
    expect(redirect).toContain("reason=missing_scopes");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(
      t.run((ctx) => ctx.db.query("slackWorkspaceConnections").collect()),
    ).resolves.toHaveLength(0);
  });

  test("rolls Photon and Slack back when a workspace mapping collides", async () => {
    const t = convexTest(schema, modules);
    const existing = await seedAdmin(t, "Existing Client");
    const target = await seedAdmin(t, "Target Client");
    await t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Existing Slack service",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId: existing.clientOrgId,
        teamId: "T-CUSTOMER",
        teamName: "Existing workspace",
        grantedScopes: [...SLACK_CUSTOMER_SCOPES],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const state = await oauthState(t, target.clientOrgId, target.userId);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://slack.com/api/oauth.v2.access") {
        return jsonResponse(slackTokenResponse());
      }
      if (url.includes("/slack/installations/T-CUSTOMER")) {
        return jsonResponse({
          succeed: true,
          data: { installationId: "installation-collision" },
        });
      }
      if (url === "https://slack.com/api/auth.revoke") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, { code: "oauth-code", state });
    expect(redirect).toContain("already+connected+to+another+client");
    expect(
      fetchMock.mock.calls.map(([input, init]) => ({
        url: String(input),
        method: init?.method,
      })),
    ).toEqual([
      { url: "https://slack.com/api/oauth.v2.access", method: "POST" },
      {
        url: "https://spectrum.photon.codes/projects/00000000-0000-4000-8000-000000000001/slack/installations/T-CUSTOMER",
        method: "PUT",
      },
      {
        url: "https://spectrum.photon.codes/projects/00000000-0000-4000-8000-000000000001/slack/installations/T-CUSTOMER",
        method: "DELETE",
      },
      { url: "https://slack.com/api/auth.revoke", method: "POST" },
    ]);
    const targetConnection = await t.run((ctx) =>
      ctx.db
        .query("slackWorkspaceConnections")
        .filter((q) => q.eq(q.field("clientOrgId"), target.clientOrgId))
        .first(),
    );
    expect(targetConnection).toBeNull();
  });

  test("removes the Photon installation before disconnecting Glass", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, userId } = await seedAdmin(t);
    const connectionId = await t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Slack service",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      const id = await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-CUSTOMER",
        teamName: "Customer workspace",
        grantedScopes: [...SLACK_CUSTOMER_SCOPES],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("agentChannelSettings", {
        clientOrgId,
        emailEnabled: true,
        imessageEnabled: true,
        slackEnabled: true,
        slackSafeAlertsEnabled: true,
        slackVendorAlertsEnabled: false,
        slackPolicyDeliveryEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return id;
    });
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ succeed: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t
      .withIdentity({ subject: `${userId}|session` })
      .action(disconnectFn, { clientOrgId });
    expect(result).toEqual({ disconnected: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
    const records = await t.run(async (ctx) => ({
      connection: await ctx.db.get(connectionId),
      settings: await ctx.db.query("agentChannelSettings").first(),
    }));
    expect(records.connection?.status).toBe("disconnected");
    expect(records.settings?.slackEnabled).toBe(false);
  });
});
