/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { signSpectrumWebhook } from "./lib/slackSecurity";

const modules = import.meta.glob("./**/*.ts");
const SIGNING_SECRET = "slack-http-test-secret";

beforeEach(() => {
  process.env.SLACK_ENABLED = "true";
  process.env.PHOTON_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
});

afterEach(() => {
  delete process.env.SLACK_ENABLED;
  delete process.env.PHOTON_WEBHOOK_SIGNING_SECRET;
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
    event: "messages",
    space: {
      id: "C-PRIMARY",
      teamId: "T-CUSTOMER",
      platform: "slack",
      type: "channel",
    },
    message: {
      id: "1800000000.100",
      platform: "slack",
      timestamp: dayjs().toISOString(),
      ts: "1800000000.100",
      threadTs: "1800000000.100",
      sender: {
        id: "U-CUSTOMER",
      },
      content: { type: "text", text: "<@U-GLASS> show my policy" },
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
    (await signSpectrumWebhook(SIGNING_SECRET, timestamp, rawBody));
  return await t.fetch("/spectrum-slack-inbound", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Spectrum-Webhook-Id": "webhook-fixture",
      "X-Spectrum-Timestamp": timestamp,
      "X-Spectrum-Signature": signature,
    },
    body: rawBody,
  });
}

describe("Slack Photon HTTP webhook", () => {
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
      eventKey: "webhook-fixture:1800000000.100",
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

  test("ignores DMs and bot echoes at the HTTP boundary", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const dm = messagePayload();
    dm.space = { ...dm.space, id: "D-DIRECT", type: "dm" };
    const echo = messagePayload({ id: "1800000000.200", isFromMe: true });

    expect(await (await signedRequest(t, dm)).json()).toMatchObject({
      ok: true,
      ignored: true,
    });
    expect(await (await signedRequest(t, echo)).json()).toMatchObject({
      ok: true,
      ignored: true,
    });
    await expect(
      t.run((ctx) => ctx.db.query("slackInboundEvents").collect()),
    ).resolves.toHaveLength(0);
  });

  test("records a signed installation revocation and disables Slack", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedConnection(t);

    const response = await signedRequest(t, {
      event: "app_uninstalled",
      teamId: "T-CUSTOMER",
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
