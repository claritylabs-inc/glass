/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { finish, start } from "./slackPresentation";

const modules = import.meta.glob("../**/*.ts");
const startFn = start as any;
const finishFn = finish as any;

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
    const messageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "slack",
      role: "agent",
      content: "The policy is active.",
      agentSteps: [{ type: "tool", name: "lookup_policy", completed: true }],
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
    return { orgId, connectionId, threadId, messageId };
  });
}

describe("Slack presentation lifecycle", () => {
  test("degrades streaming to one mutable message and finalizes with classic blocks", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedPresentation(t);
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example");
    vi.stubEnv("SLACK_WORKER_SECRET", "test-secret");
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ path, body });
      if (path === "/thread/status") return Response.json({ ok: true });
      if (path === "/stream/start") {
        return Response.json({ error: "unsupported_method" }, { status: 400 });
      }
      if (path === "/send") return Response.json({ messageId: "1800.1" });
      if (path === "/message/update" &&
          (body.blocks as Array<Record<string, unknown>> | undefined)?.some(
            (block) => block.type === "card",
          )) {
        return Response.json({ error: "invalid_blocks" }, { status: 400 });
      }
      if (path === "/message/update") return Response.json({ messageId: "1800.1" });
      throw new Error(`Unexpected worker path ${path}`);
    }));

    const started = await t.action(startFn, {
      ...fixture,
      threadMessageId: fixture.messageId,
      channelId: "C-PRIMARY",
      threadTs: "1800.0",
      recipientUserId: "U-CUSTOMER",
      recipientTeamId: "T-CUSTOMER",
    });
    expect(started).toMatchObject({
      mode: "message",
      phase: "active",
      providerMessageId: "1800.1",
    });
    expect(started?.actionToken).toEqual(expect.any(String));

    const finished = await t.action(finishFn, {
      threadMessageId: fixture.messageId,
      actionToken: started?.actionToken,
    });
    expect(finished).toMatchObject({ phase: "final", mode: "message" });
    expect(calls.map((call) => call.path)).toEqual([
      "/thread/status",
      "/stream/start",
      "/send",
      "/message/update",
      "/message/update",
    ]);
    const classic = calls.at(-1)?.body.blocks as Array<Record<string, unknown>>;
    expect(classic.some((block) => block.type === "card")).toBe(false);
    expect(classic.some((block) => block.type === "actions")).toBe(true);

    const message = await t.run((ctx) => ctx.db.get(fixture.messageId));
    expect(message).toMatchObject({
      slackMessageTs: "1800.1",
      slackDeliveryStatus: "sent",
    });
  });
});
