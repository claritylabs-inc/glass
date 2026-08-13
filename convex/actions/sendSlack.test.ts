/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { send } from "./sendSlack";

const modules = import.meta.glob("../**/*.ts");
const sendFn = send as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendSlack", () => {
  test("persists and sends Block Kit even when the fallback text is empty", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
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
      return { orgId, connectionId };
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload).toMatchObject({
        text: "",
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

  test("threads file parts under a new text message", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
      });
      const serviceUserId = await ctx.db.insert("users", {
        name: "Glass Slack",
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
        botUserId: "U-GLASS",
        grantedScopes: ["chat:write"],
        status: "active",
        serviceUserId,
        thirdPartyVisibilityAcknowledged: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const fileId = await ctx.storage.store(
        new Blob(["policy"], { type: "application/pdf" }),
      );
      return { orgId, connectionId, fileId };
    });
    const rootMessageTs = "1800000000.700";
    const payloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);
      return Response.json({
        messageId: payload.text ? rootMessageTs : "1800000000.701",
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
      text: "Your policy is ready.",
    });
    expect(payloads[0]).not.toHaveProperty("threadTs");
    expect(payloads[1]).toMatchObject({
      clientMessageId: `policy-delivery:fixture:slack:file:${seeded.fileId}`,
      threadTs: rootMessageTs,
      text: "",
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
