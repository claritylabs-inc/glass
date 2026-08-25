/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import {
  commitSummary,
  getThreadAttachment,
  recordCompactionFailure,
  resetTask,
  searchThreadHistory,
} from "./agentHistory";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const searchThreadHistoryFn = searchThreadHistory as any;
const getThreadAttachmentFn = getThreadAttachment as any;
const commitSummaryFn = commitSummary as any;
const recordCompactionFailureFn = recordCompactionFailure as any;
const resetTaskFn = resetTask as any;

describe("thread history retrieval", () => {
  test("stays inside the accessible thread and filters internal message states", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        email: "owner@example.com",
      });
      const otherId = await ctx.db.insert("users", {
        email: "other@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const threadId = await ctx.db.insert("threads", {
        orgId,
        title: "Private",
        createdBy: ownerId,
        lastMessageAt: 1,
        originChannel: "imessage",
        visibility: "user_private",
      });
      await ctx.db.insert("threadMessages", {
        threadId,
        orgId,
        channel: "imessage",
        role: "user",
        content: "We decided to renew the cyber policy.",
      });
      await ctx.db.insert("threadMessages", {
        threadId,
        orgId,
        channel: "imessage",
        role: "agent",
        content: "renew lookup still processing",
        status: "processing",
      });
      await ctx.db.insert("threadMessages", {
        threadId,
        orgId,
        channel: "imessage",
        role: "system",
        content: "renew internal payload",
      });
      return { ownerId, otherId, orgId, threadId };
    });

    const matches = await t.query(searchThreadHistoryFn, {
      threadId: fixture.threadId,
      userId: fixture.ownerId,
      readOrgIds: [fixture.orgId],
      query: "renew",
      limit: 8,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].excerpt).toContain("cyber policy");

    const denied = await t.query(searchThreadHistoryFn, {
      threadId: fixture.threadId,
      userId: fixture.otherId,
      readOrgIds: [fixture.orgId],
      query: "renew",
      limit: 8,
    });
    expect(denied).toEqual([]);
  });

  test("authorizes attachments by both thread and message ownership", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        email: "owner@example.com",
      });
      const otherId = await ctx.db.insert("users", {
        email: "other@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const threadId = await ctx.db.insert("threads", {
        orgId,
        title: "Private",
        createdBy: ownerId,
        lastMessageAt: 1,
        originChannel: "imessage",
        visibility: "user_private",
      });
      const otherThreadId = await ctx.db.insert("threads", {
        orgId,
        title: "Other",
        createdBy: ownerId,
        lastMessageAt: 1,
        originChannel: "chat",
      });
      const fileId = await ctx.storage.store(
        new Blob(["older document"], { type: "text/plain" }),
      );
      const messageId = await ctx.db.insert("threadMessages", {
        threadId,
        orgId,
        channel: "imessage",
        role: "user",
        content: "See the old file.",
        attachments: [
          {
            filename: "old.txt",
            contentType: "text/plain",
            size: 14,
            fileId,
          },
        ],
      });
      return { ownerId, otherId, orgId, threadId, otherThreadId, messageId };
    });

    const allowed = await t.query(getThreadAttachmentFn, {
      threadId: fixture.threadId,
      messageId: String(fixture.messageId),
      filename: "old.txt",
      userId: fixture.ownerId,
      readOrgIds: [fixture.orgId],
    });
    expect(allowed?.filename).toBe("old.txt");

    const wrongThread = await t.query(getThreadAttachmentFn, {
      threadId: fixture.otherThreadId,
      messageId: String(fixture.messageId),
      filename: "old.txt",
      userId: fixture.ownerId,
      readOrgIds: [fixture.orgId],
    });
    expect(wrongThread).toBeNull();

    const wrongUser = await t.query(getThreadAttachmentFn, {
      threadId: fixture.threadId,
      messageId: String(fixture.messageId),
      filename: "old.txt",
      userId: fixture.otherId,
      readOrgIds: [fixture.orgId],
    });
    expect(wrongUser).toBeNull();
  });
});

describe("thread summary state", () => {
  test("rejects stale compaction results and isolates an explicit task reset", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "summary@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const threadId = await ctx.db.insert("threads", {
        orgId,
        title: "Direct",
        createdBy: userId,
        lastMessageAt: 2,
        originChannel: "imessage",
        visibility: "user_private",
      });
      const currentMessageId = await ctx.db.insert("threadMessages", {
        threadId,
        orgId,
        channel: "imessage",
        role: "user",
        content: "Start over",
      });
      await ctx.db.insert("threadContextStates", {
        threadId,
        orgId,
        continuityMode: "task_scoped",
        taskEpoch: 2,
        taskStartedAt: 1,
        summary: "Old task",
        summaryVersion: 1,
        status: "scheduled",
        attemptCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      return { threadId, currentMessageId };
    });
    const stale = await t.mutation(commitSummaryFn, {
      threadId: fixture.threadId,
      expectedTaskEpoch: 1,
      summary: "Stale overwrite",
      lastMessageId: fixture.currentMessageId,
      lastMessageCreatedAt: 2,
      hasMore: false,
    });
    expect(stale.committed).toBe(false);

    const staleWatermark = await t.mutation(commitSummaryFn, {
      threadId: fixture.threadId,
      expectedTaskEpoch: 2,
      expectedSummarizedThroughMessageId: fixture.currentMessageId,
      summary: "Stale watermark overwrite",
      lastMessageId: fixture.currentMessageId,
      lastMessageCreatedAt: 2,
      hasMore: false,
    });
    expect(staleWatermark.committed).toBe(false);

    await t.mutation(resetTaskFn, {
      threadId: fixture.threadId,
      currentMessageId: fixture.currentMessageId,
    });
    const state = await t.run(
      async (ctx) =>
        await ctx.db
          .query("threadContextStates")
          .withIndex("thread", (q) => q.eq("threadId", fixture.threadId))
          .unique(),
    );
    expect(state?.taskEpoch).toBe(3);
    expect(state?.summary).toBeUndefined();
    expect(state?.taskStartedAt).toBeGreaterThanOrEqual(1);
  });

  test("records bounded summary retry state without blocking the conversation", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "retry@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const id = await ctx.db.insert("threads", {
        orgId,
        title: "Chat",
        createdBy: userId,
        lastMessageAt: 1,
        originChannel: "chat",
      });
      const watermarkMessageId = await ctx.db.insert("threadMessages", {
        threadId: id,
        orgId,
        channel: "chat",
        role: "user",
        content: "Earlier request",
      });
      await ctx.db.insert("threadContextStates", {
        threadId: id,
        orgId,
        continuityMode: "thread_long",
        taskEpoch: 0,
        taskStartedAt: 1,
        summarizedThroughMessageId: watermarkMessageId,
        summarizedThroughCreatedAt: 2,
        summaryVersion: 1,
        status: "scheduled",
        attemptCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      return { threadId: id, watermarkMessageId };
    });
    await t.mutation(recordCompactionFailureFn, {
      threadId: fixture.threadId,
      taskEpoch: 0,
      error: "temporary provider failure",
    });
    const staleState = await t.run(
      async (ctx) =>
        await ctx.db
          .query("threadContextStates")
          .withIndex("thread", (q) => q.eq("threadId", fixture.threadId))
          .unique(),
    );
    expect(staleState?.attemptCount).toBe(0);

    await t.mutation(recordCompactionFailureFn, {
      threadId: fixture.threadId,
      taskEpoch: 0,
      expectedSummarizedThroughMessageId: fixture.watermarkMessageId,
      expectedSummarizedThroughCreatedAt: 2,
      error: "temporary provider failure",
    });
    const state = await t.run(
      async (ctx) =>
        await ctx.db
          .query("threadContextStates")
          .withIndex("thread", (q) => q.eq("threadId", fixture.threadId))
          .unique(),
    );
    expect(state).toMatchObject({
      status: "scheduled",
      attemptCount: 1,
      lastError: "temporary provider failure",
    });
  });
});
