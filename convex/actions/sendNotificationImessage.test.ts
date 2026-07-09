/// <reference types="vite/client" />
import dayjs from "dayjs";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { send } from "./sendNotificationImessage";

const modules = import.meta.glob("../**/*.ts");
const sendFn = send as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendNotificationImessage", () => {
  test("sends once and records the message in a direct iMessage thread", async () => {
    const t = convexTest(schema, modules);
    const { notificationId, orgId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Alice",
        phone: "+14155550123",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      await ctx.db.insert("notificationPreferences", {
        orgId,
        userId,
        type: "__proactive__",
        channel: "imessage",
        enabled: true,
        updatedAt: dayjs().valueOf(),
      });
      const notificationId = await ctx.db.insert("notifications", {
        orgId,
        userId,
        type: "mailbox_attention",
        title: "Mailbox item needs attention",
        body: "Glass found a policy document.",
        severity: "warning",
        status: "unread",
        imessageStatus: "scheduled",
        createdAt: dayjs().valueOf(),
      });
      return { notificationId, orgId };
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("IMESSAGE_TERMINAL_ENABLED", "true");
    vi.stubEnv("IMESSAGE_WORKER_URL", "https://imessage.example");
    vi.stubEnv("IMESSAGE_WORKER_SECRET", "test-secret");

    await t.action(sendFn, { notificationId });

    const snapshot = await t.run(async (ctx) => ({
      notification: await ctx.db.get(notificationId),
      threads: await ctx.db
        .query("threads")
        .withIndex("by_orgId_threadPhone", (q) =>
          q.eq("orgId", orgId).eq("threadPhone", "+14155550123"),
        )
        .collect(),
      messages: await ctx.db.query("threadMessages").collect(),
      sends: await ctx.db.query("imessageOutboundSends").collect(),
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(snapshot.notification?.imessageStatus).toBe("sent");
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0].visibility).toBe("user_private");
    expect(snapshot.messages).toMatchObject([
      {
        threadId: snapshot.threads[0]._id,
        channel: "imessage",
        role: "agent",
        content: "Mailbox item needs attention\n\nGlass found a policy document.",
      },
    ]);
    expect(snapshot.sends).toMatchObject([
      {
        status: "sent",
        idempotencyKey: `notification-imessage:${notificationId}:${snapshot.notification?.userId}`,
      },
    ]);
  });

  test("records a private view-thread notification only in the owner's private direct thread", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const ownerId = await ctx.db.insert("users", {
        name: "Alice",
        phone: "+14155550123",
      });
      const teammateId = await ctx.db.insert("users", {
        name: "Bob",
        phone: "+14155550124",
      });
      for (const userId of [ownerId, teammateId]) {
        await ctx.db.insert("orgMemberships", {
          orgId,
          userId,
          role: "member",
        });
        await ctx.db.insert("notificationPreferences", {
          orgId,
          userId,
          type: "__proactive__",
          channel: "imessage",
          enabled: true,
          updatedAt: dayjs().valueOf(),
        });
      }
      const sourceThreadId = await ctx.db.insert("threads", {
        orgId,
        title: "Alice mailbox activity",
        createdBy: ownerId,
        lastMessageAt: dayjs().valueOf(),
        originChannel: "chat",
        visibility: "user_private",
      });
      const sharedThreadId = await ctx.db.insert("threads", {
        orgId,
        title: "Shared iMessage",
        createdBy: ownerId,
        lastMessageAt: dayjs().valueOf(),
        threadPhone: "+14155550123",
        originChannel: "imessage",
      });
      const notificationId = await ctx.db.insert("notifications", {
        orgId,
        type: "mailbox_attention",
        title: "Mailbox item needs attention",
        body: "Glass found a private mailbox item.",
        severity: "warning",
        status: "unread",
        imessageStatus: "scheduled",
        actionType: "view_thread",
        actionPayload: { threadId: sourceThreadId },
        createdAt: dayjs().valueOf(),
      });
      return {
        orgId,
        ownerId,
        teammateId,
        sourceThreadId,
        sharedThreadId,
        notificationId,
      };
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("IMESSAGE_TERMINAL_ENABLED", "true");
    vi.stubEnv("IMESSAGE_WORKER_URL", "https://imessage.example");
    vi.stubEnv("IMESSAGE_WORKER_SECRET", "test-secret");

    await t.action(sendFn, { notificationId: seeded.notificationId });

    const snapshot = await t.run(async (ctx) => ({
      threads: await ctx.db
        .query("threads")
        .withIndex("by_orgId_threadPhone", (q) =>
          q.eq("orgId", seeded.orgId).eq("threadPhone", "+14155550123"),
        )
        .collect(),
      messages: await ctx.db.query("threadMessages").collect(),
    }));
    const privateDirect = snapshot.threads.find(
      (thread) => thread.visibility === "user_private",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(privateDirect).toMatchObject({
      createdBy: seeded.ownerId,
      threadPhone: "+14155550123",
      visibility: "user_private",
    });
    expect(privateDirect?._id).toBe(seeded.sharedThreadId);
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].threadId).toBe(privateDirect?._id);
    expect(snapshot.messages[0].userId).toBe(seeded.ownerId);
  });
});
