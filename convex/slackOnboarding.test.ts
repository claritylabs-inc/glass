/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { createPrimaryChannel } from "./actions/slackOnboarding";

const modules = import.meta.glob("./**/*.ts");
const createPrimaryChannelFn = createPrimaryChannel as any;

beforeEach(() => {
  vi.stubEnv("SLACK_ENABLED", "true");
  vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example.test");
  vi.stubEnv("SLACK_WORKER_SECRET", "worker-secret");
  vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-GLASS");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedOperator(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Onboarding Client",
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
      slackTeamId: "T-GLASS",
      slackUserId: "U-OPERATOR",
      createdAt: 1,
      updatedAt: 1,
    });
    return { clientOrgId, operatorUserId };
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Slack Connect onboarding action", () => {
  test("lets an operator create and audit the hosted primary channel", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          channelId: "C-HOST",
          channelName: "glass-onboarding-client",
          inviteId: "INVITE-1",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t
      .withIdentity({ subject: `${operatorUserId}|session` })
      .action(createPrimaryChannelFn, {
        clientOrgId,
        clientSlug: "onboarding-client",
        inviteEmail: "admin@client.test",
      });
    expect(result).toMatchObject({
      created: true,
      channelId: "C-HOST",
      channelName: "glass-onboarding-client",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack-worker.example.test/connect-channel",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer worker-secret",
        }),
      }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      clientSlug: "onboarding-client",
      inviteEmail: "admin@client.test",
    });
    const records = await t.run(async (ctx) => ({
      binding: await ctx.db.query("slackChannelBindings").first(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.binding).toMatchObject({
      clientOrgId,
      hostTeamId: "T-GLASS",
      hostChannelId: "C-HOST",
      channelName: "glass-onboarding-client",
      status: "active",
    });
    expect(records.audits).toMatchObject([
      {
        operatorUserId,
        targetOrgId: clientOrgId,
        type: "setup_write",
        summary:
          "Created #glass-onboarding-client as the primary Slack service channel",
      },
    ]);
  });

  test("classifies Slack plan and permission failures for manual setup", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not_paid" }, 500)),
    );

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(createPrimaryChannelFn, {
          clientOrgId,
          clientSlug: "onboarding-client",
          inviteEmail: "admin@client.test",
        }),
    ).resolves.toEqual({
      created: false,
      manualSetupRequired: true,
      reason: "not_paid",
    });
  });

  test("rejects non-operators without calling the worker", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId } = await seedOperator(t);
    const clientAdminId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Client Admin",
        email: "admin@client.test",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId,
        role: "admin",
      });
      return userId;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t
        .withIdentity({ subject: `${clientAdminId}|session` })
        .action(createPrimaryChannelFn, {
          clientOrgId,
          clientSlug: "onboarding-client",
          inviteEmail: "admin@client.test",
        }),
    ).rejects.toThrow("Glass operator");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
