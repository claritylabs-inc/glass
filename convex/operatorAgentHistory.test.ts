/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import {
  getThreadAttachmentInternal,
  searchThreadHistoryInternal,
} from "./operatorAgent";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const getThreadAttachmentInternalFn = getThreadAttachmentInternal as any;
const searchThreadHistoryInternalFn = searchThreadHistoryInternal as any;

describe("operator agent older history", () => {
  test("searches only the current authorized thread and reopens its attachments", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const operatorUserId = await ctx.db.insert("users", {
        email: "operator@example.com",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@example.com",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherOperatorUserId = await ctx.db.insert("users", {
        email: "other@example.com",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: otherOperatorUserId,
        email: "other@example.com",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const threadId = await ctx.db.insert("operatorAgentThreads", {
        ownerUserId: operatorUserId,
        visibility: "private",
        channel: "chat",
        title: "Older context",
        lastMessageAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const otherThreadId = await ctx.db.insert("operatorAgentThreads", {
        ownerUserId: otherOperatorUserId,
        visibility: "private",
        channel: "chat",
        title: "Private other context",
        lastMessageAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const fileId = await ctx.storage.store(
        new Blob(["loss run notes"], { type: "text/plain" }),
      );
      const messageId = await ctx.db.insert("operatorAgentMessages", {
        threadId,
        ownerUserId: operatorUserId,
        channel: "chat",
        role: "user",
        content: "The renewal decision used the regional property market.",
        attachments: [
          {
            fileId,
            filename: "loss-runs.txt",
            contentType: "text/plain",
            size: 14,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("operatorAgentAttachments", {
        fileId,
        operatorUserId,
        threadId,
        messageId,
        filename: "loss-runs.txt",
        contentType: "text/plain",
        size: 14,
        createdAt: 1,
      });
      await ctx.db.insert("operatorAgentMessages", {
        threadId: otherThreadId,
        ownerUserId: otherOperatorUserId,
        channel: "chat",
        role: "user",
        content: "The renewal decision used a captive market.",
        createdAt: 1,
        updatedAt: 1,
      });
      return {
        operatorUserId,
        otherOperatorUserId,
        threadId,
        otherThreadId,
        messageId,
        fileId,
      };
    });

    const matches = await t.query(searchThreadHistoryInternalFn, {
      operatorUserId: fixture.operatorUserId,
      threadId: fixture.threadId,
      query: "renewal decision",
    });
    expect(matches).toMatchObject([
      {
        messageId: fixture.messageId,
        attachments: [{ filename: "loss-runs.txt" }],
      },
    ]);
    await expect(
      t.query(getThreadAttachmentInternalFn, {
        operatorUserId: fixture.operatorUserId,
        threadId: fixture.threadId,
        messageId: fixture.messageId,
        filename: "loss-runs.txt",
      }),
    ).resolves.toMatchObject({ fileId: fixture.fileId });
    await expect(
      t.query(searchThreadHistoryInternalFn, {
        operatorUserId: fixture.otherOperatorUserId,
        threadId: fixture.threadId,
        query: "renewal decision",
      }),
    ).rejects.toThrow("Operator thread not found");
  });
});
