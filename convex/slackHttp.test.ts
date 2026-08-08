/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { signSlackRequest } from "./lib/slackSecurity";

const modules = import.meta.glob("./**/*.ts");
const SIGNING_SECRET = "slack-http-test-secret";

beforeEach(() => {
  process.env.SLACK_ENABLED = "true";
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
});

afterEach(() => {
  delete process.env.SLACK_ENABLED;
  delete process.env.SLACK_SIGNING_SECRET;
});

async function seedConnection(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Slack HTTP Client",
      type: "client",
    });
    const serviceUserId = await ctx.db.insert("users", {
      name: "Glass Slack",
      accountKind: "customer",
      serviceAccountKind: "slack",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: serviceUserId,
      role: "admin",
    });
    const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
      clientOrgId,
      teamId: "T-CUSTOMER",
      teamName: "Customer",
      botUserId: "U-GLASS",
      grantedScopes: ["app_mentions:read", "chat:write"],
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
    await ctx.db.insert("slackChannelBindings", {
      connectionId,
      clientOrgId,
      kind: "primary",
      hostTeamId: "T-GLASS",
      hostChannelId: "C-HOST",
      customerChannelId: "C-PRIMARY",
      channelName: "glass-customer",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { clientOrgId, connectionId };
  });
}

function messagePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T-CUSTOMER",
    api_app_id: "A-GLASS",
    event_id: "Ev-1800000000.100",
    event_time: dayjs().unix(),
    event: {
      type: "app_mention",
      ts: "1800000000.100",
      thread_ts: "1800000000.100",
      event_ts: "1800000000.100",
      channel: "C-PRIMARY",
      channel_type: "channel",
      user: "U-CUSTOMER",
      text: "<@U-GLASS> show my policy",
      ...overrides,
    },
  };
}

async function signedRequest(
  t: ReturnType<typeof convexTest>,
  payload: unknown,
  options: { timestamp?: string; signature?: string } = {},
) {
  const rawBody = JSON.stringify(payload);
  const timestamp = options.timestamp ?? String(dayjs().unix());
  const signature =
    options.signature ??
    (await signSlackRequest(SIGNING_SECRET, timestamp, rawBody));
  return await t.fetch("/slack/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body: rawBody,
  });
}

describe("Slack Events API webhook", () => {
  test("answers signed URL verification while event processing is disabled", async () => {
    const t = convexTest(schema, modules);
    process.env.SLACK_ENABLED = "false";
    const response = await signedRequest(t, {
      type: "url_verification",
      challenge: "native-slack-challenge",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "native-slack-challenge",
    });
  });

  test("verifies, durably deduplicates, and acknowledges inbound messages", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const payload = messagePayload();

    await expect(signedRequest(t, payload)).resolves.toMatchObject({
      status: 200,
    });
    await expect(signedRequest(t, payload)).resolves.toMatchObject({
      status: 200,
    });

    const events = await t.run((ctx) =>
      ctx.db.query("slackInboundEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "T-CUSTOMER:C-PRIMARY:1800000000.100:message",
      status: "queued",
      mentionsGlass: true,
      isPrimaryChannel: true,
    });
    expect(events[0].senderTeamId).toBeUndefined();
  });

  test("rejects stale or tampered deliveries before claiming them", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const payload = messagePayload();
    const staleTimestamp = String(dayjs().subtract(6, "minute").unix());

    expect((await signedRequest(t, payload, { timestamp: staleTimestamp })).status).toBe(
      401,
    );
    expect((await signedRequest(t, payload, { signature: "v0=invalid" })).status).toBe(
      401,
    );
    await expect(
      t.run((ctx) => ctx.db.query("slackInboundEvents").collect()),
    ).resolves.toHaveLength(0);
  });

  test("claims DMs and still ignores bot echoes at the HTTP boundary", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const dm = messagePayload({
      type: "message",
      channel: "D-DIRECT",
      channel_type: "im",
      thread_ts: undefined,
      text: "show my policy",
    });
    const echo = messagePayload({
      ts: "1800000000.200",
      event_ts: "1800000000.200",
      bot_id: "B-GLASS",
    });

    expect(await (await signedRequest(t, dm)).json()).toMatchObject({ ok: true });
    expect(await (await signedRequest(t, echo)).json()).toMatchObject({
      ok: true,
      ignored: true,
    });
    const events = await t.run((ctx) =>
      ctx.db.query("slackInboundEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channelId: "D-DIRECT",
      threadTs: "D-DIRECT",
      isDirectMessage: true,
      status: "queued",
    });
  });

  test("records a signed installation revocation and disables Slack", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedConnection(t);

    const response = await signedRequest(t, {
      type: "event_callback",
      event: { type: "app_uninstalled" },
      team_id: "T-CUSTOMER",
    });
    expect(response.status).toBe(200);
    const state = await t.run(async (ctx) => ({
      connection: await ctx.db.get(connectionId),
      settings: await ctx.db.query("agentChannelSettings").first(),
    }));
    expect(state.connection?.status).toBe("revoked");
    expect(state.settings?.slackEnabled).toBe(false);
  });
});
