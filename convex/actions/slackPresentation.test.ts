/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import {
  clearReaction,
  finish,
  start,
} from "./slackPresentation";

const modules = import.meta.glob("../**/*.ts");
const startFn = start as any;
const finishFn = finish as any;
const clearReactionFn = clearReaction as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function seedPresentation(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const serviceUserId = await ctx.db.insert("users", {
      name: "Glass Slack",
      accountKind: "customer",
      serviceAccountKind: "slack",
    });
    const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
      clientOrgId: orgId,
      teamId: "T-CUSTOMER",
      teamName: "Cove",
      botUserId: "U-GLASS",
      grantedScopes: ["chat:write"],
      status: "active",
      serviceUserId,
      thirdPartyVisibilityAcknowledged: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("slackChannelMemberships", {
      connectionId,
      clientOrgId: orgId,
      channelId: "C-PRIMARY",
      channelName: "primary",
      isPrivate: false,
      isShared: false,
      status: "active",
      lastSyncedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const bindingId = await ctx.db.insert("slackChannelBindings", {
      connectionId,
      clientOrgId: orgId,
      kind: "primary",
      hostTeamId: "T-CLARITY",
      hostChannelId: "C-HOST",
      customerChannelId: "C-PRIMARY",
      channelName: "primary",
      status: "active",
      healthStatus: "healthy",
      boundAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      title: "Slack support",
      createdBy: serviceUserId,
      lastMessageAt: 1,
      originChannel: "slack",
      slackConnectionId: connectionId,
      slackChannelId: "C-PRIMARY",
      slackThreadTs: "1800.0",
      slackConversationKind: "channel",
      slackState: "active",
    });
    const userMessageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "slack",
      role: "user",
      slackMessageTs: "1800.0",
      content: "Check this policy.",
    });
    const messageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "slack",
      role: "agent",
      content: "✅ **The policy is active.**",
      replyToMessageId: userMessageId,
      agentSteps: [
        { type: "tool", name: "choose_slack_reaction", completed: true },
        { type: "tool", name: "lookup_policy", completed: true },
      ],
    });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      userId: serviceUserId,
      fileName: "policy.pdf",
      carrier: "Zurich",
      policyNumber: "GL-123",
      insuredName: "Cove",
      linesOfBusiness: ["CGL"],
      policyYear: 2026,
      effectiveDate: "2026-01-01",
      expirationDate: "2027-01-01",
      isRenewal: false,
      coverages: [],
      extractionDataStage: "final",
    });
    await ctx.db.patch(messageId, { referencedPolicyIds: [policyId] });
    return { orgId, connectionId, bindingId, threadId, messageId };
  });
}

describe("Slack presentation lifecycle", () => {
  test("falls back from rejected rich blocks and persists classic delivery", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedPresentation(t);
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example");
    vi.stubEnv("SLACK_WORKER_SECRET", "test-secret");
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ path, body });
        if (
          path === "/send" &&
          (body.blocks as Array<Record<string, unknown>> | undefined)?.some(
            (block) => block.type === "card",
          )
        ) {
          return Response.json(
            {
              error: "The provider rejected the rich blocks",
              providerErrorCode: "invalid_blocks",
              retryable: false,
            },
            { status: 400 },
          );
        }
        if (path === "/send") return Response.json({ messageId: "1800.1" });
        if (path === "/reaction/add" || path === "/reaction/remove") {
          return Response.json({ ok: true });
        }
        throw new Error(`Unexpected worker path ${path}`);
      }),
    );

    const started = await t.action(startFn, {
      orgId: fixture.orgId,
      connectionId: fixture.connectionId,
      threadId: fixture.threadId,
      threadMessageId: fixture.messageId,
      channelId: "C-PRIMARY",
      threadTs: "1800.0",
    });
    expect(started?.actionToken).toEqual(expect.any(String));

    const finished = await t.action(finishFn, {
      threadMessageId: fixture.messageId,
      actionToken: started?.actionToken,
    });
    expect(finished).toMatchObject({ phase: "final", mode: "message" });
    await t.action(clearReactionFn, {
      threadMessageId: fixture.messageId,
    });
    const sends = calls.filter((call) => call.path === "/send");
    expect(sends).toHaveLength(2);
    const classic = sends[1]?.body.blocks as Array<Record<string, unknown>>;
    expect(classic.some((block) => block.type === "card")).toBe(false);
    expect(classic.some((block) => block.type === "actions")).toBe(true);

    const message = await t.run((ctx) => ctx.db.get(fixture.messageId));
    expect(message).toMatchObject({
      slackMessageTs: "1800.1",
      slackDeliveryStatus: "sent",
    });
  });

  test("persists definitive provider failures and suspends the primary channel", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedPresentation(t);
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example");
    vi.stubEnv("SLACK_WORKER_SECRET", "test-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "The selected Slack channel no longer exists.",
            providerErrorCode: "channel_not_found",
            retryable: false,
          },
          { status: 409 },
        ),
      ),
    );

    const started = await t.action(startFn, {
      orgId: fixture.orgId,
      connectionId: fixture.connectionId,
      threadId: fixture.threadId,
      threadMessageId: fixture.messageId,
      channelId: "C-PRIMARY",
    });
    await expect(
      t.action(finishFn, {
        threadMessageId: fixture.messageId,
        actionToken: started?.actionToken,
      }),
    ).rejects.toThrow("no longer exists");

    const state = await t.run(async (ctx) => ({
      binding: await ctx.db.get(fixture.bindingId),
      presentation: await ctx.db
        .query("slackMessagePresentations")
        .withIndex("message", (q) =>
          q.eq("threadMessageId", fixture.messageId),
        )
        .unique(),
      lifecycle: await ctx.db.query("slackLifecycleEvents").collect(),
    }));
    expect(state.binding).toMatchObject({
      status: "unavailable",
      unavailableReason: "channel_not_found",
      providerErrorCode: "channel_not_found",
    });
    expect(state.presentation).toMatchObject({
      phase: "failed",
      providerErrorCode: "channel_not_found",
      retryable: false,
    });
    expect(state.lifecycle).toHaveLength(1);
    expect(state.lifecycle[0]).toMatchObject({
      eventType: "outbound_provider_failure",
      status: "succeeded",
    });
  });
});
