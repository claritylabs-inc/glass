/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import { sendInternal } from "./actions/sendOperatorSlack";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const sendOperatorSlack = sendInternal as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("operator Slack outbound ledger", () => {
  test("claims one idempotent direct message and preserves its sent result", async () => {
    const t = convexTest(schema, modules);
    const [senderOperatorUserId, recipientOperatorUserId] = await t.run(
      async (ctx) => [
        await ctx.db.insert("users", {
          name: "Sender",
          email: "sender@example.com",
          accountKind: "operator",
        }),
        await ctx.db.insert("users", {
          name: "Recipient",
          email: "recipient@example.com",
          accountKind: "operator",
        }),
      ],
    );
    const input = {
      idempotencyKey: "operator-slack-message-1",
      senderOperatorUserId,
      recipientOperatorUserId,
      teamId: "T-HOST",
      recipientSlackUserId: "U-RECIPIENT",
      recipientEmail: "recipient@example.com",
      content: "Procurement records are updated.",
    };

    const claimed = await t.mutation(
      internal.slackOutbound.claimOperatorDirectMessage,
      input,
    );
    expect(claimed).toMatchObject({
      send: true,
      row: { status: "sending", attemptCount: 1, ...input },
    });
    await t.mutation(internal.slackOutbound.markOperatorDirectMessageSent, {
      id: claimed.row._id,
      providerMessageId: "123.456",
    });

    const replay = await t.mutation(
      internal.slackOutbound.claimOperatorDirectMessage,
      input,
    );
    expect(replay).toMatchObject({
      send: false,
      row: {
        _id: claimed.row._id,
        status: "sent",
        attemptCount: 1,
        providerMessageId: "123.456",
      },
    });
  });

  test("revalidates the recipient and delivers through the shared worker", async () => {
    const t = convexTest(schema, modules);
    const { senderOperatorUserId } = await t.run(async (ctx) => {
      const senderOperatorUserId = await ctx.db.insert("users", {
        name: "Sender",
        email: "sender@example.com",
        accountKind: "operator",
      });
      const recipientOperatorUserId = await ctx.db.insert("users", {
        name: "Recipient",
        email: "recipient@example.com",
        accountKind: "operator",
      });
      for (const [userId, email, slackUserId] of [
        [senderOperatorUserId, "sender@example.com", "U-SENDER"],
        [recipientOperatorUserId, "recipient@example.com", "U-RECIPIENT"],
      ] as const) {
        await ctx.db.insert("operatorProfiles", {
          userId,
          email,
          role: "operator",
          status: "active",
          slackTeamId: "T-HOST",
          slackUserId,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      return { senderOperatorUserId };
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ messageId: "123.456", attachmentFailures: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-HOST");
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example");
    vi.stubEnv("SLACK_WORKER_SECRET", "test-secret");

    const result = await t.action(sendOperatorSlack, {
      operatorUserId: senderOperatorUserId,
      recipientEmail: "recipient@example.com",
      content: "Procurement records are updated.",
      idempotencyKey: "operator-slack-message-action",
    });

    expect(result).toMatchObject({
      status: "sent",
      recipientEmail: "recipient@example.com",
      recipientName: "Recipient",
      providerMessageId: "123.456",
      idempotent: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      teamId: "T-HOST",
      channelId: "U-RECIPIENT",
      mrkdwnText: "Procurement records are updated.",
    });
    const sends = await t.run(async (ctx) =>
      ctx.db.query("operatorSlackOutboundSends").collect(),
    );
    expect(sends).toMatchObject([
      {
        senderOperatorUserId,
        recipientEmail: "recipient@example.com",
        recipientSlackUserId: "U-RECIPIENT",
        status: "sent",
        providerMessageId: "123.456",
      },
    ]);
  });
});
