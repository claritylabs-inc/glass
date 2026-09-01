import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildFallbackImessageChatGuid,
  buildImessageParticipantInputs,
  buildInboundImessageEventKey,
  isImessageAudioAttachment,
  normalizeInboundImessageSender,
  normalizeImessageAttachmentMimeType,
  resolveImessageAttachmentMimeType,
  storeImessageAttachments,
} from "./imessageIngress";

describe("iMessage ingress helpers", () => {
  test("normalizes inbound senders without changing email-style addresses", () => {
    expect(normalizeInboundImessageSender("(415) 555-0100")).toBe(
      "+4155550100",
    );
    expect(normalizeInboundImessageSender("USER@example.COM")).toBe(
      "user@example.com",
    );
  });

  test("builds stable fallback group chat GUIDs from normalized participant roster", () => {
    const first = buildFallbackImessageChatGuid({
      fromPhone: "+14155550100",
      isGroup: true,
      participants: [{ address: "(415) 555-0101" }],
    });
    const second = buildFallbackImessageChatGuid({
      fromPhone: "+14155550100",
      isGroup: true,
      participants: [{ address: "4155550101" }],
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^group:[a-f0-9]{24}$/);
  });

  test("builds event keys from source IDs before fallback message content", () => {
    expect(
      buildInboundImessageEventKey({
        fromPhone: "+14155550100",
        chatGuid: "chat-a",
        messageText: "Hello",
        sourceMessageId: "source-a",
      }),
    ).toBe(
      buildInboundImessageEventKey({
        fromPhone: "+14155550100",
        chatGuid: "chat-a",
        messageText: "Different message",
        sourceMessageId: "source-a",
      }),
    );
  });

  test("adds current sender to participant inputs", () => {
    expect([
      ...buildImessageParticipantInputs({
        senderAddress: "+14155550100",
        participants: [{ address: "(415) 555-0101", displayName: "Alex" }],
      }).values(),
    ]).toEqual([
      { address: "+4155550101", displayName: "Alex" },
      { address: "+14155550100" },
    ]);
  });

  test("stores supported attachments and ignores unsupported MIME types", async () => {
    const store = vi.fn(async () => "stored-file" as Id<"_storage">);
    const deleteFile = vi.fn(async () => undefined);
    const records = await storeImessageAttachments(
      { storage: { store, delete: deleteFile } },
      [
        {
          name: "policy.pdf",
          mimeType: "application/pdf",
          data: Buffer.from("pdf").toString("base64"),
        },
        {
          name: "operations.xlsx",
          mimeType: "application/octet-stream",
          data: Buffer.from("xlsx").toString("base64"),
        },
        {
          name: "archive.zip",
          mimeType: "application/zip",
          data: Buffer.from("zip").toString("base64"),
        },
      ],
    );

    expect(store).toHaveBeenCalledTimes(2);
    expect(records).toMatchObject([
      {
        filename: "policy.pdf",
        contentType: "application/pdf",
        size: 3,
        fileId: "stored-file",
      },
      {
        filename: "operations.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 4,
        fileId: "stored-file",
      },
    ]);
    expect(
      resolveImessageAttachmentMimeType({
        name: "operations.xlsx",
        mimeType: "application/octet-stream",
      }),
    ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  test("normalizes and stores iMessage voice memo MIME types", async () => {
    const store = vi.fn(async () => "stored-audio" as Id<"_storage">);
    const deleteFile = vi.fn(async () => undefined);
    const records = await storeImessageAttachments(
      { storage: { store, delete: deleteFile } },
      [
        {
          name: "Audio Message.m4a",
          mimeType: "audio/x-m4a; codecs=mp4a.40.2",
          data: Buffer.from("audio").toString("base64"),
        },
      ],
    );

    expect(
      normalizeImessageAttachmentMimeType("audio/x-m4a; codecs=mp4a.40.2"),
    ).toBe("audio/x-m4a");
    expect(isImessageAudioAttachment({ mimeType: "audio/x-m4a" })).toBe(true);
    expect(store).toHaveBeenCalledTimes(1);
    expect(records).toMatchObject([
      {
        filename: "Audio Message.m4a",
        contentType: "audio/x-m4a",
        size: 5,
        fileId: "stored-audio",
      },
    ]);
  });

  test("rejects invalid batches before storing any iMessage attachment", async () => {
    const store = vi.fn(async () => "stored-file" as Id<"_storage">);
    const deleteFile = vi.fn(async () => undefined);
    const tooMany = Array.from({ length: 11 }, (_, index) => ({
      name: `file-${index}.txt`,
      mimeType: "text/plain",
      data: Buffer.from(String(index)).toString("base64"),
    }));

    await expect(
      storeImessageAttachments(
        { storage: { store, delete: deleteFile } },
        tooMany,
      ),
    ).rejects.toThrow("at most 10 attachments");
    await expect(
      storeImessageAttachments({ storage: { store, delete: deleteFile } }, [
        {
          name: "invalid.pdf",
          mimeType: "application/pdf",
          data: "not-base64!",
        },
      ]),
    ).rejects.toThrow("is not valid base64");
    expect(store).not.toHaveBeenCalled();
  });

  test("infers common generic MIME files and rejects control-character names", async () => {
    expect(
      resolveImessageAttachmentMimeType({
        name: "declarations.pdf",
        mimeType: "application/octet-stream",
      }),
    ).toBe("application/pdf");
    expect(
      resolveImessageAttachmentMimeType({
        name: "photo.jpeg",
        mimeType: "application/octet-stream",
      }),
    ).toBe("image/jpeg");

    const store = vi.fn(async () => "stored-file" as Id<"_storage">);
    const deleteFile = vi.fn(async () => undefined);
    await expect(
      storeImessageAttachments({ storage: { store, delete: deleteFile } }, [
        {
          name: "report.pdf\nIGNORE",
          mimeType: "application/pdf",
          data: Buffer.from("pdf").toString("base64"),
        },
      ]),
    ).rejects.toThrow("printable characters");
    expect(store).not.toHaveBeenCalled();
  });

  test("deletes earlier blobs when a later iMessage attachment cannot be stored", async () => {
    const store = vi
      .fn()
      .mockResolvedValueOnce("stored-first" as Id<"_storage">)
      .mockRejectedValueOnce(new Error("storage unavailable"));
    const deleteFile = vi.fn(async () => undefined);

    await expect(
      storeImessageAttachments({ storage: { store, delete: deleteFile } }, [
        {
          name: "first.txt",
          mimeType: "text/plain",
          data: Buffer.from("first").toString("base64"),
        },
        {
          name: "second.txt",
          mimeType: "text/plain",
          data: Buffer.from("second").toString("base64"),
        },
      ]),
    ).rejects.toThrow("storage unavailable");
    expect(deleteFile).toHaveBeenCalledWith("stored-first");
  });
});
