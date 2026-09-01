/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { getSendTarget } from "../slackOutbound";
import { send } from "./sendSlack";

const modules = import.meta.glob("../**/*.ts");
const getSendTargetFn = getSendTarget as any;
const sendFn = send as any;

async function seedSlackConnection(
  t: ReturnType<typeof convexTest>,
  options: { unavailableSupportBinding?: boolean } = {},
) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const serviceUserId = await ctx.db.insert("users", {
      name: "Spot Slack",
      accountKind: "customer",
      serviceAccountKind: "slack",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: serviceUserId,
      role: "admin",
    });
    const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
      clientOrgId: orgId,
      teamId: "T-CUSTOMER",
      teamName: "Cove",
      botUserId: "U-SPOT",
      grantedScopes: ["chat:write"],
      status: "active",
      serviceUserId,
      thirdPartyVisibilityAcknowledged: true,
      createdAt: 1,
      updatedAt: 1,
    });
    if (options.unavailableSupportBinding) {
      await ctx.db.insert("slackChannelBindings", {
        connectionId,
        clientOrgId: orgId,
        kind: "primary",
        hostTeamId: "T-SPOT",
        hostChannelId: "C-HOST",
        customerChannelId: "C-CUSTOMER",
        channelName: "spot-cove",
        status: "unavailable",
        createdAt: 1,
        updatedAt: 1,
      });
    }
    return { orgId, serviceUserId, connectionId };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendSlack", () => {
  test("sends to a Slack-delivered channel without a membership inventory row", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSlackConnection(t);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload).toMatchObject({
        mrkdwnText: "I couldn't complete that request.",
        blocks: [{ type: "section" }],
      });
      return Response.json({ messageId: "1800000000.500" });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example");
    vi.stubEnv("SLACK_WORKER_SECRET", "test-secret");

    const result = await t.action(sendFn, {
      idempotencyKey: "rich-only",
      orgId: seeded.orgId,
      connectionId: seeded.connectionId,
      channelId: "C-PRIMARY",
      content: "",
      blocks: [{ type: "section" }],
    });
    expect(result).toMatchObject({ status: "sent" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("uses the exact delivered support channel despite stale binding health", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedSlackConnection(t, {
      unavailableSupportBinding: true,
    });

    await expect(
      t.query(getSendTargetFn, {
        connectionId,
        channelId: "C-HOST",
      }),
    ).resolves.toMatchObject({
      available: true,
      teamId: "T-SPOT",
      channelId: "C-HOST",
    });
  });

  test("threads file parts under a new text message", async () => {
    const t = convexTest(schema, modules);
    const connection = await seedSlackConnection(t);
    const fileId = await t.run(async (ctx) => {
      await ctx.db.insert("slackChannelMemberships", {
        connectionId: connection.connectionId,
        clientOrgId: connection.orgId,
        channelId: "C-PRIMARY",
        channelName: "primary",
        isPrivate: false,
        isShared: false,
        status: "active",
        lastSyncedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.storage.store(
        new Blob(["policy"], { type: "application/pdf" }),
      );
    });
    const seeded = { ...connection, fileId };
    const rootMessageTs = "1800000000.700";
    const payloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);
      return Response.json({
        messageId: payload.mrkdwnText ? rootMessageTs : "1800000000.701",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example");
    vi.stubEnv("SLACK_WORKER_SECRET", "test-secret");

    const result = await t.action(sendFn, {
      idempotencyKey: "policy-delivery:fixture:slack",
      orgId: seeded.orgId,
      connectionId: seeded.connectionId,
      channelId: "C-PRIMARY",
      content: "Your policy is ready.",
      attachments: [
        {
          fileId: seeded.fileId,
          filename: "policy.pdf",
          contentType: "application/pdf",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "sent",
      providerMessageId: rootMessageTs,
    });
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      clientMessageId: "policy-delivery:fixture:slack:text",
      mrkdwnText: "Your policy is ready.",
    });
    expect(payloads[0]).not.toHaveProperty("threadTs");
    expect(payloads[1]).toMatchObject({
      clientMessageId: `policy-delivery:fixture:slack:file:${seeded.fileId}`,
      threadTs: rootMessageTs,
      mrkdwnText: "",
      attachments: [{ filename: "policy.pdf", contentType: "application/pdf" }],
    });

    const sends = await t.run((ctx) =>
      ctx.db.query("slackOutboundSends").collect(),
    );
    expect(sends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idempotencyKey: `policy-delivery:fixture:slack:file:${seeded.fileId}`,
          threadTs: rootMessageTs,
          status: "sent",
        }),
      ]),
    );
  });
});
