/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  cancelSlackSetup,
  createOAuthState,
  startSlackSetup,
} from "./agentChannels";
import {
  begin,
  beginHost,
  complete,
  disconnect,
  sendInstallInvite,
} from "./actions/slackOAuth";
import {
  SLACK_CUSTOMER_SCOPES,
  SLACK_HOST_SCOPES,
} from "./lib/slackOAuthPolicy";
import { encryptSlackCredential } from "./lib/slackCredentials";

const modules = import.meta.glob("./**/*.ts");
const cancelSlackSetupFn = cancelSlackSetup as any;
const createOAuthStateFn = createOAuthState as any;
const startSlackSetupFn = startSlackSetup as any;
const beginFn = begin as any;
const beginHostFn = beginHost as any;
const completeFn = complete as any;
const disconnectFn = disconnect as any;
const sendInstallInviteFn = sendInstallInvite as any;

beforeEach(() => {
  vi.stubEnv("SLACK_ENABLED", "true");
  vi.stubEnv("SLACK_CLIENT_ID", "slack-client-id");
  vi.stubEnv("SLACK_CLIENT_SECRET", "slack-client-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://convex.example.test");
  vi.stubEnv("APP_URL", "https://app.example.test");
  vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", "slack-encryption-test-key");
  vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-CLARITY");
});

afterEach(() => {
  vi.restoreAllMocks();
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

async function seedOperator(
  t: ReturnType<typeof convexTest>,
  name = "Client",
) {
  return await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name,
      type: "client",
    });
    const operatorUserId = await ctx.db.insert("users", {
      name: "Glass Operator",
      email: "operator@glass.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@glass.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { clientOrgId, operatorUserId };
  });
}

async function startInitialSetup(
  t: ReturnType<typeof convexTest>,
  clientOrgId: string,
  operatorUserId: string,
) {
  await t
    .withIdentity({ subject: `${operatorUserId}|session` })
    .mutation(startSlackSetupFn, { clientOrgId, mode: "initial" });
}

async function seedRepairConnection(t: ReturnType<typeof convexTest>) {
  const { clientOrgId, operatorUserId } = await seedOperator(t, "Repair Client");
  const records = await t.run(async (ctx) => {
    const serviceUserId = await ctx.db.insert("users", {
      name: "Slack service",
      accountKind: "customer",
      serviceAccountKind: "slack",
    });
    const installationId = await ctx.db.insert("slackInstallations", {
      teamId: "T-CUSTOMER",
      teamName: "Customer workspace",
      kind: "customer",
      botUserId: "U-GLASS",
      encryptedBotToken: encryptSlackCredential(
        "xoxb-working-token",
        "T-CUSTOMER",
      ),
      grantedScopes: [...SLACK_CUSTOMER_SCOPES],
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
      clientOrgId,
      teamId: "T-CUSTOMER",
      teamName: "Customer workspace",
      nativeInstallationId: installationId,
      botUserId: "U-GLASS",
      grantedScopes: [...SLACK_CUSTOMER_SCOPES],
      status: "active",
      serviceUserId,
      thirdPartyVisibilityAcknowledged: true,
      automaticChannelId: "C-DEFAULT",
      automaticChannelName: "policy-updates",
      automaticChannelRoutingConfiguredAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const bindingId = await ctx.db.insert("slackChannelBindings", {
      connectionId,
      clientOrgId,
      kind: "primary",
      hostTeamId: "T-CLARITY",
      hostChannelId: "C-HOST",
      customerChannelId: "C-SUPPORT",
      channelName: "glass-repair-client",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("agentChannelSettings", {
      clientOrgId,
      emailEnabled: true,
      imessageEnabled: true,
      slackEnabled: true,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: true,
      slackPolicyDeliveryEnabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    return { installationId, connectionId, bindingId };
  });
  const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
  const setupStateId = await operator.mutation(startSlackSetupFn, {
    clientOrgId,
    mode: "reinstall",
  });
  return {
    clientOrgId,
    operatorUserId,
    setupStateId,
    ...records,
  };
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
  test("lets an operator invite installation before the support channel exists", async () => {
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    vi.stubEnv("GLASS_ENV", "local");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t, "Cove & Co.");
    await startInitialSetup(t, clientOrgId, operatorUserId);

    const result = await t
      .withIdentity({ subject: `${operatorUserId}|session` })
      .action(sendInstallInviteFn, {
        clientOrgId,
        recipientEmail: " Admin@Cove.Test ",
      });
    expect(result).toMatchObject({
      recipientEmail: "admin@cove.test",
      expiresInDays: 7,
      mode: "initial",
    });
    expect(result.expiresAt).toBeTypeOf("number");

    const capture = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(capture).toContain("to: admin@cove.test");
    expect(capture).toContain(
      "subject: Install the Glass Slack app for Cove & Co.",
    );
    expect(capture).toContain("Install the Glass app once in your workspace");
    expect(capture).toContain(
      "https://platform.slack-edge.com/img/add_to_slack.png",
    );
    expect(capture).toContain(
      "Clarity Labs sets up your shared support channel separately",
    );

    const records = await t.run(async (ctx) => ({
      state: await ctx.db.query("slackOAuthStates").first(),
      setup: await ctx.db.query("slackSetupStates").first(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.state).toMatchObject({
      clientOrgId,
      purpose: "customer_install_invite",
      recipientEmail: "admin@cove.test",
      initiatedByOperatorUserId: operatorUserId,
    });
    expect(records.setup).toMatchObject({
      status: "in_progress",
      inviteRecipientEmail: "admin@cove.test",
      inviteExpiresAt: result.expiresAt,
    });
    expect(records.state!.expiresAt - records.state!.createdAt).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(records.audits.at(-1)).toMatchObject({
      operatorUserId,
      targetOrgId: clientOrgId,
      type: "setup_write",
      summary: "Sent client Slack app install invitation",
      metadata: { recipientEmail: "admin@cove.test" },
    });
  });

  test("does not let a client admin send the operator install invitation", async () => {
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    vi.stubEnv("GLASS_ENV", "local");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const { clientOrgId, userId } = await seedAdmin(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("slackChannelBindings", {
        clientOrgId,
        kind: "primary",
        hostTeamId: "T-CLARITY",
        hostChannelId: "C-HOST",
        channelName: "glass-client",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      t.withIdentity({ subject: `${userId}|session` }).action(
        sendInstallInviteFn,
        {
          clientOrgId,
          recipientEmail: "admin@client.test",
        },
      ),
    ).rejects.toThrow();
    await expect(
      t.run((ctx) => ctx.db.query("slackOAuthStates").collect()),
    ).resolves.toHaveLength(0);
  });

  test("resending invalidates the previous unused install link", async () => {
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    vi.stubEnv("GLASS_ENV", "local");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    await startInitialSetup(t, clientOrgId, operatorUserId);
    const operator = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });

    await operator.action(sendInstallInviteFn, {
      clientOrgId,
      recipientEmail: "first@client.test",
    });
    const second = await operator.action(sendInstallInviteFn, {
      clientOrgId,
      recipientEmail: "second@client.test",
    });

    const records = await t.run(async (ctx) => ({
      states: await ctx.db.query("slackOAuthStates").collect(),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(records.states).toHaveLength(2);
    expect(records.states[0].invalidatedAt).toBeTypeOf("number");
    expect(records.states[1].invalidatedAt).toBeUndefined();
    expect(records.setup).toMatchObject({
      inviteRecipientEmail: "second@client.test",
      inviteExpiresAt: second.expiresAt,
    });
  });

  test("invalidates a newly created install link when email delivery fails", async () => {
    vi.stubEnv("EMAIL_DELIVERY_MODE", "live");
    vi.stubEnv("AUTH_RESEND_KEY", "");
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    await startInitialSetup(t, clientOrgId, operatorUserId);

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(sendInstallInviteFn, {
          clientOrgId,
          recipientEmail: "admin@client.test",
        }),
    ).rejects.toThrow("Failed to send Slack install invitation");
    const records = await t.run(async (ctx) => ({
      state: await ctx.db.query("slackOAuthStates").first(),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(records.state?.invalidatedAt).toBeTypeOf("number");
    expect(records.setup?.inviteSentAt).toBeUndefined();
  });

  test("installs the host app only for an authenticated Glass operator", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "Glass Operator",
        email: "operator@claritylabs.test",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: id,
        email: "operator@claritylabs.test",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return id;
    });
    const operator = t.withIdentity({ subject: `${userId}|session` });
    const { url } = await operator.action(beginHostFn, {});
    const authorizeUrl = new URL(url);
    const state = authorizeUrl.searchParams.get("state");
    expect(authorizeUrl.searchParams.get("scope")?.split(",")).toEqual(
      SLACK_HOST_SCOPES,
    );
    expect(state).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          slackTokenResponse({
            scope: SLACK_HOST_SCOPES.join(","),
            team: { id: "T-CLARITY", name: "Clarity Labs" },
          }),
        ),
      ),
    );
    const redirect = await t.action(completeFn, {
      code: "host-oauth-code",
      state,
    });
    expect(redirect).toContain("slack_host=connected");
    const records = await t.run(async (ctx) => ({
      installation: await ctx.db.query("slackInstallations").first(),
      connection: await ctx.db.query("slackWorkspaceConnections").first(),
    }));
    expect(records.installation).toMatchObject({
      teamId: "T-CLARITY",
      kind: "host",
      status: "active",
    });
    expect(records.connection).toBeNull();
  });

  test("starts an acknowledged, operator-led installation without exposing state at rest", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
    await startInitialSetup(t, clientOrgId, operatorUserId);

    await expect(
      operator.action(beginFn, {
        clientOrgId,
        thirdPartyVisibilityAcknowledged: false,
      }),
    ).rejects.toThrow("Acknowledge");
    const { url } = await operator.action(beginFn, {
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
    expect(stored).toMatchObject({
      clientOrgId,
      initiatedByOperatorUserId: operatorUserId,
    });
    expect(stored?.stateHash).not.toBe(state);
  });

  test("lets a client admin reinstall a retained revoked workspace", async () => {
    const t = convexTest(schema, modules);
    const repair = await seedRepairConnection(t);
    const adminUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Repair Admin",
        email: "repair-admin@example.test",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: repair.clientOrgId,
        userId,
        role: "admin",
      });
      await ctx.db.patch(repair.connectionId, {
        status: "revoked",
        healthStatus: "degraded",
        healthReason: "app_uninstalled",
      });
      return userId;
    });
    const admin = t.withIdentity({ subject: `${adminUserId}|session` });
    const { url } = await admin.action(beginFn, {
      clientOrgId: repair.clientOrgId,
      thirdPartyVisibilityAcknowledged: true,
    });
    expect(new URL(url).origin).toBe("https://slack.com");
    const state = await t.run((ctx) =>
      ctx.db
        .query("slackOAuthStates")
        .withIndex("client_purpose", (q) =>
          q
            .eq("clientOrgId", repair.clientOrgId)
            .eq("purpose", "customer"),
        )
        .order("desc")
        .first(),
    );
    expect(state).toMatchObject({ initiatedByUserId: adminUserId });
  });

  test("connects, disconnects, and refreshes mock Slack without OAuth", async () => {
    vi.stubEnv("SLACK_MODE", "mock");
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
    await startInitialSetup(t, clientOrgId, operatorUserId);

    await expect(
      operator.action(beginFn, {
        clientOrgId,
        thirdPartyVisibilityAcknowledged: true,
      }),
    ).resolves.toEqual({ url: null, mockRefreshed: true });

    const first = await t.run(async (ctx) => ({
      connection: await ctx.db.query("slackWorkspaceConnections").first(),
      oauthState: await ctx.db.query("slackOAuthStates").first(),
    }));
    expect(first.connection).toMatchObject({
      clientOrgId,
      teamName: "Client local workspace",
      botUserId: "U-GLASS",
      grantedScopes: [...SLACK_CUSTOMER_SCOPES],
      status: "active",
    });
    expect(first.oauthState).toBeNull();

    await expect(
      operator.action(disconnectFn, { clientOrgId }),
    ).resolves.toEqual({ disconnected: true });
    await expect(
      t.run((ctx) => ctx.db.get(first.connection!._id)),
    ).resolves.toMatchObject({ status: "disconnected" });

    await operator.action(beginFn, {
      clientOrgId,
      thirdPartyVisibilityAcknowledged: true,
    });
    const connections = await t.run((ctx) =>
      ctx.db.query("slackWorkspaceConnections").collect(),
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]._id).toBe(first.connection?._id);
    expect(connections[0].status).toBe("active");
  });

  test("exchanges OAuth server-side and stores encrypted installation credentials", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, userId } = await seedAdmin(t);
    const state = await oauthState(t, clientOrgId, userId);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://slack.com/api/oauth.v2.access") {
        return jsonResponse(slackTokenResponse());
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, { code: "oauth-code", state });
    expect(redirect).toContain("slack=connected");
    const records = await t.run(async (ctx) => ({
      connection: await ctx.db.query("slackWorkspaceConnections").first(),
      installation: await ctx.db.query("slackInstallations").first(),
      channelSettings: await ctx.db.query("agentChannelSettings").first(),
      deliverySettings: await ctx.db.query("policyDeliverySettings").first(),
    }));
    expect(records.connection).toMatchObject({
      clientOrgId,
      teamId: "T-CUSTOMER",
      botUserId: "U-GLASS",
      status: "active",
    });
    expect(records.installation).toMatchObject({
      teamId: "T-CUSTOMER",
      kind: "customer",
      status: "active",
    });
    expect(JSON.stringify(records.installation)).not.toContain("xoxb-test-token");
    expect(records.installation?.encryptedBotToken).toBeTruthy();
    expect(records.installation?.encryptedRefreshToken).toBeTruthy();
    expect(records.channelSettings?.slackEnabled).toBe(true);
    expect(records.deliverySettings).toMatchObject({
      deliveryOwnerOrgId: clientOrgId,
      clientOrgId,
      channels: ["slack"],
      defaultAction: "auto_send",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
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
      if (url === "https://slack.com/api/apps.uninstall") {
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

  test("preserves a working repair when OAuth returns the wrong workspace", async () => {
    const t = convexTest(schema, modules);
    const repair = await seedRepairConnection(t);
    const state = await t.mutation(createOAuthStateFn, {
      clientOrgId: repair.clientOrgId,
      userId: repair.operatorUserId,
      actorKind: "operator",
      setupStateId: repair.setupStateId,
    });
    const before = await t.run(async (ctx) => ({
      connection: await ctx.db.get(repair.connectionId),
      installation: await ctx.db.get(repair.installationId),
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://slack.com/api/oauth.v2.access") {
        return jsonResponse(
          slackTokenResponse({
            team: { id: "T-WRONG", name: "Wrong workspace" },
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, {
      code: "repair-code",
      state,
    });
    expect(redirect).toContain("reason=wrong_workspace");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const after = await t.run(async (ctx) => ({
      connection: await ctx.db.get(repair.connectionId),
      installation: await ctx.db.get(repair.installationId),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(after.connection).toEqual(before.connection);
    expect(after.installation).toEqual(before.installation);
    expect(after.setup?.installationCompletedAt).toBeUndefined();
  });

  test("invalidates an unused repair link when the operator cancels", async () => {
    const t = convexTest(schema, modules);
    const repair = await seedRepairConnection(t);
    const state = await t.mutation(createOAuthStateFn, {
      clientOrgId: repair.clientOrgId,
      userId: repair.operatorUserId,
      actorKind: "operator",
      setupStateId: repair.setupStateId,
    });
    await t
      .withIdentity({ subject: `${repair.operatorUserId}|session` })
      .mutation(cancelSlackSetupFn, { clientOrgId: repair.clientOrgId });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, {
      code: "cancelled-repair-code",
      state,
    });
    expect(redirect).toContain("reason=invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
    const records = await t.run(async (ctx) => ({
      connection: await ctx.db.get(repair.connectionId),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(records.connection?.status).toBe("active");
    expect(records.setup?.status).toBe("cancelled");
  });

  test("preserves a working repair when updated scopes are incomplete", async () => {
    const t = convexTest(schema, modules);
    const repair = await seedRepairConnection(t);
    const state = await t.mutation(createOAuthStateFn, {
      clientOrgId: repair.clientOrgId,
      userId: repair.operatorUserId,
      actorKind: "operator",
      setupStateId: repair.setupStateId,
    });
    const before = await t.run(async (ctx) => ({
      connection: await ctx.db.get(repair.connectionId),
      installation: await ctx.db.get(repair.installationId),
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://slack.com/api/oauth.v2.access") {
        return jsonResponse(
          slackTokenResponse({ scope: "app_mentions:read,chat:write" }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, {
      code: "repair-code",
      state,
    });
    expect(redirect).toContain("reason=missing_scopes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const after = await t.run(async (ctx) => ({
      connection: await ctx.db.get(repair.connectionId),
      installation: await ctx.db.get(repair.installationId),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(after.connection).toEqual(before.connection);
    expect(after.installation).toEqual(before.installation);
    expect(after.setup?.installationCompletedAt).toBeUndefined();
  });

  test("refreshes same-workspace repair credentials without resetting client choices", async () => {
    const t = convexTest(schema, modules);
    const repair = await seedRepairConnection(t);
    const state = await t.mutation(createOAuthStateFn, {
      clientOrgId: repair.clientOrgId,
      userId: repair.operatorUserId,
      actorKind: "operator",
      setupStateId: repair.setupStateId,
    });
    const oldInstallation = await t.run((ctx) =>
      ctx.db.get(repair.installationId),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(slackTokenResponse())),
    );

    const redirect = await t.action(completeFn, {
      code: "repair-code",
      state,
    });
    expect(redirect).toContain("slack=connected");
    const records = await t.run(async (ctx) => ({
      connection: await ctx.db.get(repair.connectionId),
      installation: await ctx.db.get(repair.installationId),
      binding: await ctx.db.get(repair.bindingId),
      settings: await ctx.db.query("agentChannelSettings").first(),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(records.connection).toMatchObject({
      status: "active",
      automaticChannelId: "C-DEFAULT",
      automaticChannelName: "policy-updates",
    });
    expect(records.binding?.status).toBe("active");
    expect(records.settings).toMatchObject({
      slackEnabled: true,
      slackVendorAlertsEnabled: true,
    });
    expect(records.installation?.encryptedBotToken).not.toBe(
      oldInstallation?.encryptedBotToken,
    );
    expect(records.setup?.installationCompletedAt).toBeTypeOf("number");
    expect(records.setup?.status).toBe("in_progress");
  });

  test("rejects a workspace mapping collision without revoking the existing client", async () => {
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
      if (url === "https://slack.com/api/apps.uninstall") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = await t.action(completeFn, { code: "oauth-code", state });
    expect(redirect).toContain("reason=workspace_already_connected");
    expect(
      fetchMock.mock.calls.map(([input, init]) => ({
        url: String(input),
        method: init?.method,
      })),
    ).toEqual([
      { url: "https://slack.com/api/oauth.v2.access", method: "POST" },
    ]);
    const connections = await t.run((ctx) =>
      ctx.db.query("slackWorkspaceConnections").collect(),
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      clientOrgId: existing.clientOrgId,
      status: "active",
    });
  });

  test("uninstalls the native Slack app before disconnecting Glass", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, userId } = await seedAdmin(t);
    const connectionId = await t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Slack service",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      const nativeInstallationId = await ctx.db.insert("slackInstallations", {
        teamId: "T-CUSTOMER",
        teamName: "Customer workspace",
        kind: "customer",
        botUserId: "U-GLASS",
        encryptedBotToken: encryptSlackCredential(
          "xoxb-test-token",
          "T-CUSTOMER",
        ),
        grantedScopes: [...SLACK_CUSTOMER_SCOPES],
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const id = await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-CUSTOMER",
        teamName: "Customer workspace",
        nativeInstallationId,
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
        jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t
      .withIdentity({ subject: `${userId}|session` })
      .action(disconnectFn, { clientOrgId });
    expect(result).toEqual({ disconnected: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://slack.com/api/apps.uninstall",
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    const records = await t.run(async (ctx) => ({
      connection: await ctx.db.get(connectionId),
      settings: await ctx.db.query("agentChannelSettings").first(),
    }));
    expect(records.connection?.status).toBe("disconnected");
    expect(records.settings?.slackEnabled).toBe(false);
  });
});
