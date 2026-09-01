import { describe, expect, test } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import { buildOperatorHistoryWithAttachments } from "./operatorAgentRunner";

describe("operator attachment history", () => {
  test("rehydrates a recent file for a follow-up turn", async () => {
    const fileId = "first-turn-file" as Id<"_storage">;
    const messages = [
      {
        _id: "message-1",
        _creationTime: 1,
        role: "user",
        channel: "chat",
        ownerUserId: "operator-1",
        threadId: "thread-1",
        content: "Read this renewal schedule.",
        attachments: [
          {
            fileId,
            filename: "renewals.csv",
            contentType: "text/csv",
            size: 24,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "message-2",
        _creationTime: 2,
        role: "agent",
        channel: "chat",
        ownerUserId: "operator-1",
        threadId: "thread-1",
        content: "I reviewed it.",
        createdAt: 2,
        updatedAt: 2,
      },
      {
        _id: "message-3",
        _creationTime: 3,
        role: "user",
        channel: "chat",
        ownerUserId: "operator-1",
        threadId: "thread-1",
        content: "Which policy has the highest premium?",
        createdAt: 3,
        updatedAt: 3,
      },
    ] as Array<Doc<"operatorAgentMessages">>;

    const history = await buildOperatorHistoryWithAttachments(
      {
        storage: {
          get: async () => new Blob(["policy,premium\nGL-1,1200"]),
        },
      } as never,
      messages,
    );

    expect(history[0]).toMatchObject({ role: "user" });
    expect(JSON.stringify(history[0])).toContain("GL-1,1200");
    expect(history.at(-1)).toEqual({
      role: "user",
      content: "Which policy has the highest premium?",
    });
  });

  test("caps rehydrated files across follow-up messages by aggregate size", async () => {
    const olderFileId = "older-file" as Id<"_storage">;
    const currentFileId = "current-file" as Id<"_storage">;
    const secondCurrentFileId = "second-current-file" as Id<"_storage">;
    const requested: string[] = [];
    const messages = [
      {
        _id: "message-1",
        _creationTime: 1,
        role: "user",
        channel: "chat",
        ownerUserId: "operator-1",
        threadId: "thread-1",
        content: "Review this first file.",
        attachments: [
          {
            fileId: olderFileId,
            filename: "older.png",
            contentType: "image/png",
            size: 25 * 1024 * 1024,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "message-2",
        _creationTime: 2,
        role: "user",
        channel: "chat",
        ownerUserId: "operator-1",
        threadId: "thread-1",
        content: "Compare it with this file.",
        attachments: [
          {
            fileId: currentFileId,
            filename: "current.png",
            contentType: "image/png",
            size: 25 * 1024 * 1024,
          },
          {
            fileId: secondCurrentFileId,
            filename: "second-current.png",
            contentType: "image/png",
            size: 25 * 1024 * 1024,
          },
        ],
        createdAt: 2,
        updatedAt: 2,
      },
    ] as Array<Doc<"operatorAgentMessages">>;

    await buildOperatorHistoryWithAttachments(
      {
        storage: {
          get: async (fileId: Id<"_storage">) => {
            requested.push(String(fileId));
            return new Blob([new Uint8Array([1])]);
          },
        },
      } as never,
      messages,
    );

    expect(requested).toEqual([
      String(currentFileId),
      String(secondCurrentFileId),
    ]);
  });
});
