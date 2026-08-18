/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { startSlackSetup } from "./agentChannels";
import {
  createPrimaryChannel,
  joinPublicChannel,
  leavePublicChannel,
  listAvailableChannels,
  selectAutomaticChannel,
} from "./slackOnboarding";

const modules = import.meta.glob("./**/*.ts");
const startSlackSetupFn = startSlackSetup as any;
const createPrimaryChannelFn = createPrimaryChannel as any;
const joinPublicChannelFn = joinPublicChannel as any;
const leavePublicChannelFn = leavePublicChannel as any;
const listAvailableChannelsFn = listAvailableChannels as any;
const selectAutomaticChannelFn = selectAutomaticChannel as any;

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
      operatorUserIds: ["U-OPERATOR"],
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

  test("persists a support channel through partial failures and reuses it on retry", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    await t.run(async (ctx) => {
      for (const operator of [
        {
          name: "Unlinked Operator",
          email: "unlinked@glass.insure",
          status: "active" as const,
        },
        {
          name: "Mismatched Operator",
          email: "mismatch@glass.insure",
          status: "active" as const,
          slackTeamId: "T-OTHER",
          slackUserId: "U-MISMATCH",
        },
        {
          name: "Disabled Operator",
          email: "disabled@glass.insure",
          status: "disabled" as const,
          slackTeamId: "T-GLASS",
          slackUserId: "U-DISABLED",
        },
      ]) {
        const userId = await ctx.db.insert("users", {
          name: operator.name,
          email: operator.email,
          accountKind: "operator",
        });
        await ctx.db.insert("operatorProfiles", {
          userId,
          email: operator.email,
          role: "operator",
          status: operator.status,
          slackTeamId: operator.slackTeamId,
          slackUserId: operator.slackUserId,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const operator = t.withIdentity({
      subject: `${operatorUserId}|session`,
    });
    await operator.mutation(startSlackSetupFn, {
      clientOrgId,
      mode: "initial",
    });
    let requestCount = 0;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        requestCount += 1;
        return jsonResponse({
          channelId: "C-HOST",
          channelName: "glass-onboarding-client",
          reusedChannel: requestCount > 1,
          operatorInvites:
            requestCount === 1
              ? {
                  requested: 1,
                  succeeded: false,
                  error: "user_not_found",
                }
              : { requested: 1, succeeded: true },
          supportInvite:
            requestCount === 1
              ? {
                  succeeded: false,
                  pending: false,
                  error: "restricted_action",
                }
              : { succeeded: true, pending: true },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const partial = await operator.action(createPrimaryChannelFn, {
      clientOrgId,
      clientSlug: "onboarding-client",
      inviteEmail: "admin@client.test",
    });
    expect(partial).toMatchObject({
      created: true,
      manualSetupRequired: true,
      reason: "restricted_action",
      omittedOperators: [
        { email: "unlinked@glass.insure", reason: "Not linked to Slack" },
        {
          email: "mismatch@glass.insure",
          reason: "Linked to a different workspace",
        },
        {
          email: "disabled@glass.insure",
          reason: "Operator is disabled",
        },
      ],
    });
    const partialRecords = await t.run(async (ctx) => ({
      binding: await ctx.db.query("slackChannelBindings").first(),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(partialRecords.binding).toMatchObject({
      hostChannelId: "C-HOST",
      status: "active",
    });
    expect(partialRecords.setup).toMatchObject({
      supportOperatorInvitesSucceeded: false,
      supportOperatorInviteError: "user_not_found",
      supportInviteError: "restricted_action",
    });

    await operator.action(createPrimaryChannelFn, {
      clientOrgId,
      clientSlug: "onboarding-client",
      inviteEmail: "admin@client.test",
    });
    const retryBody = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(retryBody).toMatchObject({
      existingChannelId: "C-HOST",
      existingChannelName: "glass-onboarding-client",
      operatorUserIds: ["U-OPERATOR"],
    });
    const retried = await t.run(async (ctx) => ({
      bindings: await ctx.db.query("slackChannelBindings").collect(),
      setup: await ctx.db.query("slackSetupStates").first(),
    }));
    expect(retried.bindings).toHaveLength(1);
    expect(retried.setup).toMatchObject({
      supportOperatorInvitesSucceeded: true,
    });
    expect(retried.setup?.supportOperatorInviteError).toBeUndefined();
    expect(retried.setup?.supportInviteError).toBeUndefined();
    expect(retried.setup?.supportInviteSentAt).toBeTypeOf("number");
  });

  test("syncs joined channels and keeps automatic delivery separate from support", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    const bindingId = await t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Slack service",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-CUSTOMER",
        teamName: "Customer workspace",
        grantedScopes: ["channels:read", "groups:read"],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("slackChannelBindings", {
        connectionId,
        clientOrgId,
        kind: "primary",
        hostTeamId: "T-GLASS",
        hostChannelId: "C-HOST",
        customerChannelId: "C-OLD",
        channelName: "glass-client",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        channels: [
          {
            id: "C-OLD",
            name: "glass-client",
            isMember: true,
            isPrivate: true,
            isShared: true,
          },
          {
            id: "C-NEW",
            name: "client-service",
            isMember: true,
            isPrivate: false,
            isShared: false,
          },
          {
            id: "C-AVAILABLE",
            name: "insurance",
            isMember: false,
            isPrivate: false,
            isShared: false,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(listAvailableChannelsFn, { clientOrgId }),
    ).resolves.toEqual({
      channels: [
        {
          id: "C-OLD",
          name: "glass-client",
          isMember: true,
          isPrivate: true,
          isShared: true,
        },
        {
          id: "C-NEW",
          name: "client-service",
          isMember: true,
          isPrivate: false,
          isShared: false,
        },
        {
          id: "C-AVAILABLE",
          name: "insurance",
          isMember: false,
          isPrivate: false,
          isShared: false,
        },
      ],
    });
    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(selectAutomaticChannelFn, {
          clientOrgId,
          channelId: "C-NEW",
        }),
    ).resolves.toEqual({
      id: "C-NEW",
      name: "client-service",
      isMember: true,
      isPrivate: false,
      isShared: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack-worker.example.test/channels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          teamId: "T-CUSTOMER",
          currentChannelId: "C-OLD",
          currentChannelName: "glass-client",
        }),
      }),
    );
    const records = await t.run(async (ctx) => ({
      binding: await ctx.db.get(bindingId),
      connection: await ctx.db
        .query("slackWorkspaceConnections")
        .withIndex("by_clientOrgId_and_status", (q) =>
          q.eq("clientOrgId", clientOrgId).eq("status", "active"),
        )
        .first(),
      memberships: await ctx.db.query("slackChannelMemberships").collect(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.binding).toMatchObject({
      customerChannelId: "C-OLD",
      channelName: "glass-client",
    });
    expect(records.connection).toMatchObject({
      automaticChannelId: "C-NEW",
      automaticChannelName: "client-service",
    });
    expect(records.memberships).toHaveLength(2);
    expect(records.audits.at(-1)?.summary).toBe(
      "Selected #client-service for automatic Slack messages",
    );

    await t.run((ctx) =>
      ctx.db.patch(bindingId, { customerChannelId: "C-NEW" }),
    );
    await t
      .withIdentity({ subject: `${operatorUserId}|session` })
      .action(listAvailableChannelsFn, { clientOrgId });
    await expect(t.run((ctx) => ctx.db.get(bindingId))).resolves.toMatchObject({
      customerChannelId: "C-NEW",
      channelName: "glass-client",
      status: "unavailable",
      unavailableReason: "channel_unshared",
    });
  });

  test("adds Glass to a public channel and syncs the joined inventory", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    await t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Slack service",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-CUSTOMER",
        teamName: "Customer workspace",
        grantedScopes: ["channels:join"],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        automaticChannelRoutingConfiguredAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/channels/join")) {
          return jsonResponse({
            channel: {
              id: "C-INSURANCE",
              name: "insurance",
              isMember: true,
              isPrivate: false,
              isShared: false,
            },
          });
        }
        return jsonResponse({
          channels: [
            {
              id: "C-INSURANCE",
              name: "insurance",
              isMember: true,
              isPrivate: false,
              isShared: false,
            },
          ],
        });
      }),
    );

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(joinPublicChannelFn, {
          clientOrgId,
          channelId: "C-INSURANCE",
        }),
    ).resolves.toMatchObject({
      channel: { id: "C-INSURANCE", name: "insurance", isMember: true },
    });
    const records = await t.run(async (ctx) => ({
      memberships: await ctx.db.query("slackChannelMemberships").collect(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.memberships).toMatchObject([
      { channelId: "C-INSURANCE", channelName: "insurance", status: "active" },
    ]);
    expect(records.audits.at(-1)?.summary).toBe("Added Glass to #insurance");
  });

  test("removes Glass from a public channel and clears a removed default", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, operatorUserId } = await seedOperator(t);
    await t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Slack service",
        accountKind: "customer",
        serviceAccountKind: "slack",
      });
      const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId,
        teamId: "T-CUSTOMER",
        teamName: "Customer workspace",
        grantedScopes: ["channels:join"],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        automaticChannelId: "C-INSURANCE",
        automaticChannelName: "insurance",
        automaticChannelRoutingConfiguredAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("slackChannelMemberships", {
        clientOrgId,
        connectionId,
        channelId: "C-INSURANCE",
        channelName: "insurance",
        isPrivate: false,
        isShared: false,
        status: "active",
        lastSyncedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/channels/leave")) {
          return jsonResponse({
            channel: {
              id: "C-INSURANCE",
              name: "insurance",
              isMember: false,
              isPrivate: false,
              isShared: false,
            },
          });
        }
        return jsonResponse({
          channels: [
            {
              id: "C-INSURANCE",
              name: "insurance",
              isMember: false,
              isPrivate: false,
              isShared: false,
            },
          ],
        });
      }),
    );

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(leavePublicChannelFn, {
          clientOrgId,
          channelId: "C-INSURANCE",
        }),
    ).resolves.toMatchObject({
      channel: { id: "C-INSURANCE", isMember: false },
    });
    const records = await t.run(async (ctx) => ({
      connection: await ctx.db
        .query("slackWorkspaceConnections")
        .withIndex("by_clientOrgId_and_status", (q) =>
          q.eq("clientOrgId", clientOrgId).eq("status", "active"),
        )
        .first(),
      memberships: await ctx.db.query("slackChannelMemberships").collect(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(records.connection?.automaticChannelId).toBeUndefined();
    expect(records.memberships).toMatchObject([
      { channelId: "C-INSURANCE", status: "removed" },
    ]);
    expect(records.audits.at(-1)?.summary).toBe(
      "Removed Glass from #insurance",
    );
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
