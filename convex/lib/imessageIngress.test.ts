import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildFallbackImessageChatGuid,
  buildImessageParticipantInputs,
  buildInboundImessageEventKey,
  normalizeInboundImessageSender,
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
    expect(
      [...buildImessageParticipantInputs({
        senderAddress: "+14155550100",
        participants: [{ address: "(415) 555-0101", displayName: "Alex" }],
      }).values()],
    ).toEqual([
      { address: "+4155550101", displayName: "Alex" },
      { address: "+14155550100" },
    ]);
  });

  test("stores supported attachments and ignores unsupported MIME types", async () => {
    const store = vi.fn(async () => "stored-file" as Id<"_storage">);
    const records = await storeImessageAttachments(
      { storage: { store } },
      [
        {
          name: "policy.pdf",
          mimeType: "application/pdf",
          data: Buffer.from("pdf").toString("base64"),
        },
        {
          name: "archive.zip",
          mimeType: "application/zip",
          data: Buffer.from("zip").toString("base64"),
        },
      ],
    );

    expect(store).toHaveBeenCalledTimes(1);
    expect(records).toMatchObject([
      {
        filename: "policy.pdf",
        contentType: "application/pdf",
        size: 3,
        fileId: "stored-file",
      },
    ]);
  });
});
