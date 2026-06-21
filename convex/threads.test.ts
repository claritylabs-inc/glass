/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const getAttachmentUrlFn = api.threads.getAttachmentUrl as any;

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
