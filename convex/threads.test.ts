/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  createProactiveInternal,
  findByEmail,
  findOrCreateByImessageChat,
  findOrCreateByPhone,
  recordNotificationImessageInternal,
} from "./threads";

const modules = import.meta.glob("./**/*.ts");
const getAttachmentUrlFn = api.threads.getAttachmentUrl as any;
const getThreadFn = api.threads.get as any;
const listThreadsFn = api.threads.list as any;
const messagesFn = api.threads.messages as any;
const listForClientFn = api.threads.listForClient as any;
const getForClientFn = api.threads.getForClient as any;
const messagesForClientFn = api.threads.messagesForClient as any;
const updateTitleFn = api.threads.updateTitle as any;
const streamContentFn = api.threads.streamContent as any;
const createProactiveInternalFn = createProactiveInternal as any;
const findByEmailFn = findByEmail as any;
const findOrCreateByImessageChatFn = findOrCreateByImessageChat as any;
const findOrCreateByPhoneFn = findOrCreateByPhone as any;
const recordNotificationImessageInternalFn =
  recordNotificationImessageInternal as any;

async function seedThreadWithAttachment() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      email: "alice@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      title: "Attachments",
      createdBy: userId,
      lastMessageAt: dayjs().valueOf(),
      originChannel: "chat",
    });
    const attachedFileId = await ctx.storage.store(
      new Blob(["attached"], { type: "text/plain" }),
    );
    const unattachedFileId = await ctx.storage.store(
      new Blob(["unattached"], { type: "text/plain" }),
    );
    await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "user",
      userId,
      content: "See attached.",
      attachments: [
        {
          filename: "attached.txt",
          contentType: "text/plain",
          size: 8,
          fileId: attachedFileId,
        },
      ],
    });

    return { userId, threadId, attachedFileId, unattachedFileId };
  });
  return { t, ...ids };
}

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

describe("threads.getAttachmentUrl", () => {
  test("returns a URL for a file attached to the requested thread", async () => {
    const { t, userId, threadId, attachedFileId } =
      await seedThreadWithAttachment();

    const url = await t.withIdentity(sessionFor(userId)).query(getAttachmentUrlFn, {
      threadId,
      fileId: attachedFileId,
    });

    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });

  test("returns null for a storage file not referenced by the thread", async () => {
    const { t, userId, threadId, unattachedFileId } =
      await seedThreadWithAttachment();

    const url = await t.withIdentity(sessionFor(userId)).query(getAttachmentUrlFn, {
      threadId,
      fileId: unattachedFileId,
    });

    expect(url).toBeNull();
  });

  test("rejects calls that omit threadId", async () => {
    const { t, userId, attachedFileId } = await seedThreadWithAttachment();

    await expect(
      t.withIdentity(sessionFor(userId)).query(getAttachmentUrlFn, {
        fileId: attachedFileId,
      }),
    ).rejects.toThrow("threadId");
  });
});

describe("proactive conversation threads", () => {
  test("creates a replyable thread email when the org has an agent handle", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
        agentHandle: "acme",
      });
      const userId = await ctx.db.insert("users", {
        email: "alice@example.com",
      });
      return { orgId, userId };
    });

    const result = await t.mutation(createProactiveInternalFn, {
      orgId,
      userId,
      title: "Mailbox items needing attention",
      content: "Glass found one policy document.",
    });
    const threadId = result.threadId as Id<"threads">;
    const thread = await t.run((ctx) => ctx.db.get(threadId));

    expect(result.threadEmail).toMatch(/^acme\+[a-z0-9]{8}@glass\.insure$/);
    expect(thread?.threadEmail).toBe(result.threadEmail);
  });

  test("marks user-scoped proactive threads private while keeping reply routing internal", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
        agentHandle: "acme",
      });
      const userId = await ctx.db.insert("users", {
        email: "alice@example.com",
      });
      return { orgId, userId };
    });

    const result = await t.mutation(createProactiveInternalFn, {
      orgId,
      userId,
      visibility: "user_private",
      title: "Mailbox automation update",
      content: "Glass imported one document.",
    });
    const threadId = result.threadId as Id<"threads">;
    const thread = await t.run((ctx) => ctx.db.get(threadId));
    const routed = await t.query(findByEmailFn, {
      threadEmail: result.threadEmail,
    });

    expect(thread?.visibility).toBe("user_private");
    expect(routed?._id).toBe(result.threadId);
  });

  test("records one outbound message in the user's direct iMessage thread", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Alice",
        phone: "+14155550123",
      });
      return { orgId, userId };
    });
    const args = {
      orgId,
      userId,
      userName: "Alice",
      phone: "+14155550123",
      content: "Glass found a mailbox item that needs attention.",
      idempotencyKey: "notification-imessage:test:alice",
    };

    const first = await t.mutation(recordNotificationImessageInternalFn, args);
    const second = await t.mutation(recordNotificationImessageInternalFn, args);
    const messages = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_messageId", (q) =>
          q.eq("messageId", args.idempotencyKey),
        )
        .collect(),
    );
    const thread = await t.run((ctx) => ctx.db.get(first.threadId));

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({
      duplicate: true,
      threadId: first.threadId,
      messageId: first.messageId,
    });
    expect(messages).toHaveLength(1);
    expect(thread).toMatchObject({
      originChannel: "imessage",
      threadPhone: args.phone,
      visibility: "user_private",
    });
  });

  test("migrates the owner's shared direct thread before recording private notifications", async () => {
    const t = convexTest(schema, modules);
    const { orgId, ownerId, sharedThreadId, otherPrivateThreadId } =
      await t.run(async (ctx) => {
        const orgId = await ctx.db.insert("organizations", {
          name: "Acme",
          type: "client",
        });
        const ownerId = await ctx.db.insert("users", { name: "Alice" });
        const otherUserId = await ctx.db.insert("users", { name: "Alex" });
        const sharedThreadId = await ctx.db.insert("threads", {
          orgId,
          title: "Shared iMessage",
          createdBy: ownerId,
          lastMessageAt: dayjs().valueOf(),
          threadPhone: "+14155550123",
          originChannel: "imessage",
        });
        const otherPrivateThreadId = await ctx.db.insert("threads", {
          orgId,
          title: "Alex private iMessage",
          createdBy: otherUserId,
          lastMessageAt: dayjs().valueOf(),
          threadPhone: "+14155550123",
          originChannel: "imessage",
          visibility: "user_private",
        });
        return {
          orgId,
          ownerId,
          sharedThreadId,
          otherPrivateThreadId,
        };
      });

    const first = await t.mutation(recordNotificationImessageInternalFn, {
      orgId,
      userId: ownerId,
      userName: "Alice",
      phone: "+14155550123",
      content: "Private mailbox update",
      idempotencyKey: "notification-imessage:private:1",
    });
    const second = await t.mutation(recordNotificationImessageInternalFn, {
      orgId,
      userId: ownerId,
      userName: "Alice",
      phone: "+14155550123",
      content: "Another private mailbox update",
      idempotencyKey: "notification-imessage:private:2",
    });
    const privateThread = await t.run((ctx) => ctx.db.get(first.threadId));

    expect(first.threadId).toBe(sharedThreadId);
    expect(first.threadId).not.toBe(otherPrivateThreadId);
    expect(second.threadId).toBe(first.threadId);
    expect(privateThread).toMatchObject({
      createdBy: ownerId,
      visibility: "user_private",
      threadPhone: "+14155550123",
    });
  });

  test("reuses the owner's private phone thread for inbound direct chat while groups stay shared", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, directThreadId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const userId = await ctx.db.insert("users", { name: "Alice" });
      const directThreadId = await ctx.db.insert("threads", {
        orgId,
        title: "iMessage - Alice",
        createdBy: userId,
        lastMessageAt: dayjs().valueOf(),
        threadPhone: "+14155550123",
        originChannel: "imessage",
      });
      return { orgId, userId, directThreadId };
    });

    const byPhone = await t.mutation(findOrCreateByPhoneFn, {
      orgId,
      userId,
      fromPhone: "+14155550123",
      userName: "Alice",
    });
    const byChat = await t.mutation(findOrCreateByImessageChatFn, {
      orgId,
      userId,
      chatGuid: "iMessage;-;+14155550123",
      isGroup: false,
      scope: "single_org",
      fallbackPhone: "+14155550123",
      userName: "Alice",
    });
    const groupThreadId = await t.mutation(findOrCreateByImessageChatFn, {
      orgId,
      userId,
      chatGuid: "iMessage;+;group-1",
      isGroup: true,
      scope: "single_org",
      fallbackPhone: "+14155550123",
      title: "Project team",
      userName: "Alice",
    });
    const snapshot = await t.run(async (ctx) => ({
      direct: await ctx.db.get(byChat as Id<"threads">),
      group: await ctx.db.get(groupThreadId as Id<"threads">),
    }));

    expect(byPhone).toBe(directThreadId);
    expect(byChat).toBe(directThreadId);
    expect(snapshot.direct).toMatchObject({
      createdBy: userId,
      imessageChatGuid: "iMessage;-;+14155550123",
      visibility: "user_private",
    });
    expect(snapshot.group?.imessageIsGroup).toBe(true);
    expect(snapshot.group?.visibility).toBeUndefined();
  });
});

describe("user-private thread access", () => {
  async function seedPrivateThreadAccess() {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
        brokerOrgId,
      });
      const ownerId = await ctx.db.insert("users", { email: "owner@acme.co" });
      const teammateId = await ctx.db.insert("users", { email: "team@acme.co" });
      const brokerUserId = await ctx.db.insert("users", { email: "broker@example.com" });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: ownerId,
        role: "admin",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: teammateId,
        role: "member",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: brokerUserId,
        role: "admin",
      });
      const privateThreadId = await ctx.db.insert("threads", {
        orgId: clientOrgId,
        title: "Owner mailbox activity",
        threadEmail: "acme+private@glass.insure",
        createdBy: ownerId,
        lastMessageAt: dayjs().valueOf(),
        originChannel: "chat",
        visibility: "user_private",
      });
      const orgThreadId = await ctx.db.insert("threads", {
        orgId: clientOrgId,
        title: "Org mailbox activity",
        createdBy: ownerId,
        lastMessageAt: dayjs().subtract(1, "minute").valueOf(),
        originChannel: "chat",
      });
      const fileId = await ctx.storage.store(
        new Blob(["private"], { type: "text/plain" }),
      );
      const privateMessageId = await ctx.db.insert("threadMessages", {
        threadId: privateThreadId,
        orgId: clientOrgId,
        channel: "chat",
        role: "agent",
        content: "Private mailbox result",
        status: "processing",
        attachments: [
          {
            filename: "private.txt",
            contentType: "text/plain",
            size: 7,
            fileId,
          },
        ],
      });
      await ctx.db.insert("threadMessages", {
        threadId: orgThreadId,
        orgId: clientOrgId,
        channel: "chat",
        role: "agent",
        content: "Org mailbox result",
      });
      return {
        brokerOrgId,
        clientOrgId,
        ownerId,
        teammateId,
        brokerUserId,
        privateThreadId,
        orgThreadId,
        privateMessageId,
        fileId,
      };
    });
    return { t, ...ids };
  }

  test("only the owner can list, get, read, or download from a private thread", async () => {
    const seeded = await seedPrivateThreadAccess();
    const owner = seeded.t.withIdentity(sessionFor(seeded.ownerId));
    const teammate = seeded.t.withIdentity(sessionFor(seeded.teammateId));

    const [ownerList, teammateList] = await Promise.all([
      owner.query(listThreadsFn, {}),
      teammate.query(listThreadsFn, {}),
    ]);
    expect(ownerList.map((thread: { _id: string }) => thread._id)).toEqual([
      seeded.privateThreadId,
      seeded.orgThreadId,
    ]);
    expect(teammateList.map((thread: { _id: string }) => thread._id)).toEqual([
      seeded.orgThreadId,
    ]);
    await expect(owner.query(getThreadFn, { id: seeded.privateThreadId })).resolves.toMatchObject({
      _id: seeded.privateThreadId,
    });
    await expect(teammate.query(getThreadFn, { id: seeded.privateThreadId })).resolves.toBeNull();
    await expect(owner.query(messagesFn, { threadId: seeded.privateThreadId })).resolves.toHaveLength(1);
    await expect(teammate.query(messagesFn, { threadId: seeded.privateThreadId })).resolves.toEqual([]);
    await expect(
      owner.query(getAttachmentUrlFn, {
        threadId: seeded.privateThreadId,
        fileId: seeded.fileId,
      }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      teammate.query(getAttachmentUrlFn, {
        threadId: seeded.privateThreadId,
        fileId: seeded.fileId,
      }),
    ).resolves.toBeNull();
  });

  test("broker-of-client readers cannot see private threads or messages", async () => {
    const seeded = await seedPrivateThreadAccess();
    const broker = seeded.t.withIdentity(sessionFor(seeded.brokerUserId));

    const threads = await broker.query(listForClientFn, {
      clientOrgId: seeded.clientOrgId,
    });
    expect(threads.map((thread: { _id: string }) => thread._id)).toEqual([
      seeded.orgThreadId,
    ]);
    await expect(
      broker.query(getForClientFn, {
        clientOrgId: seeded.clientOrgId,
        id: seeded.privateThreadId,
      }),
    ).resolves.toBeNull();
    await expect(
      broker.query(messagesForClientFn, {
        clientOrgId: seeded.clientOrgId,
        threadId: seeded.privateThreadId,
      }),
    ).resolves.toEqual([]);
  });

  test("non-owners cannot mutate a private thread or its messages", async () => {
    const seeded = await seedPrivateThreadAccess();
    const teammate = seeded.t.withIdentity(sessionFor(seeded.teammateId));

    await expect(
      teammate.mutation(updateTitleFn, {
        id: seeded.privateThreadId,
        title: "Leaked",
      }),
    ).rejects.toThrow("Not found");
    await expect(
      teammate.mutation(streamContentFn, {
        messageId: seeded.privateMessageId,
        content: "Leaked",
      }),
    ).rejects.toThrow("Not found");
  });
});
