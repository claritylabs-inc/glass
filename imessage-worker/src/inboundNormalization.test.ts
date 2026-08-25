import { describe, expect, test, vi } from "vitest";

import {
  normalizeInboundTurn,
  type InboundRecoveryClient,
} from "./inboundNormalization.js";
import type { InboundAttachmentContent } from "./attachmentPolicy.js";

const readAttachment = async (content: InboundAttachmentContent) => ({
  data: Buffer.from(await content.read()).toString("base64"),
  mimeType: content.mimeType,
  name: content.name ?? "attachment",
});

function stream(bytes: string) {
  return (async function* () {
    yield { type: "header" as const };
    yield {
      type: "primaryChunk" as const,
      data: Buffer.from(bytes),
    };
  })();
}

describe("normalizeInboundTurn", () => {
  test("recovers text and every attachment from the original Photon message", async () => {
    const client: InboundRecoveryClient = {
      messages: {
        get: vi.fn().mockResolvedValue({
          guid: "message-1",
          content: {
            text: "Please review these forms",
            attachments: [
              {
                guid: "file-1",
                fileName: "first.pdf",
                mimeType: "application/pdf",
              },
              {
                guid: "file-2",
                fileName: "second.pdf",
                mimeType: "application/pdf",
              },
            ],
          },
        }),
      },
      attachments: {
        downloadStream: (guid) => stream(guid),
      },
    };
    const turn = await normalizeInboundTurn({
      message: {
        id: "message-1",
        content: {
          type: "attachment",
          id: "file-1",
          name: "first.pdf",
          mimeType: "application/pdf",
          read: async () => Buffer.from("fallback"),
        },
      },
      recoverFromPhoton: true,
      client,
      readAttachment,
    });

    expect(turn.messageText).toBe("Please review these forms");
    expect(turn.attachments.map((attachment) => attachment.name)).toEqual([
      "first.pdf",
      "second.pdf",
    ]);
    expect(turn.recoveryFailure).toBeUndefined();
  });

  test("combines Spectrum group text and deduplicates attachment identifiers", async () => {
    const turn = await normalizeInboundTurn({
      message: {
        id: "message-2",
        content: {
          type: "group",
          items: [
            { id: "text-1", content: { type: "text", text: "Here it is" } },
            {
              id: "file-event-1",
              content: {
                type: "attachment",
                id: "file-1",
                name: "policy.pdf",
                mimeType: "application/pdf",
                read: async () => Buffer.from("pdf"),
              },
            },
            {
              id: "file-event-2",
              content: {
                type: "attachment",
                id: "file-1",
                name: "policy.pdf",
                mimeType: "application/pdf",
                read: async () => Buffer.from("pdf"),
              },
            },
          ],
        },
      },
      recoverFromPhoton: false,
      readAttachment,
    });
    expect(turn.messageText).toBe("Here it is");
    expect(turn.attachments).toHaveLength(1);
    expect(turn.sourceMessageId).toBe("message-2");
  });

  test("uses the attachment placeholder only for genuinely textless turns", async () => {
    const turn = await normalizeInboundTurn({
      message: {
        id: "message-3",
        content: {
          type: "attachment",
          id: "file-3",
          name: "photo.png",
          mimeType: "image/png",
          read: async () => Buffer.from("image"),
        },
      },
      recoverFromPhoton: false,
      readAttachment,
    });
    expect(turn.messageText).toBe("(attachment)");
    expect(turn.attachments).toHaveLength(1);
  });

  test("records raw recovery failure and preserves the available attachment", async () => {
    const turn = await normalizeInboundTurn({
      message: {
        id: "message-4",
        content: {
          type: "attachment",
          id: "file-4",
          name: "fallback.pdf",
          mimeType: "application/pdf",
          read: async () => Buffer.from("fallback"),
        },
      },
      recoverFromPhoton: true,
      client: {
        messages: { get: vi.fn().mockRejectedValue(new Error("not found")) },
      },
      readAttachment,
    });
    expect(turn.attachments).toHaveLength(1);
    expect(turn.recoveryFailure).toMatchObject({
      stage: "raw_message",
      sourceMessageId: "message-4",
      error: "not found",
    });
  });

  test("falls back to the Spectrum attachment when Photon download fails", async () => {
    const turn = await normalizeInboundTurn({
      message: {
        id: "message-5",
        content: {
          type: "attachment",
          id: "file-5",
          name: "fallback.pdf",
          mimeType: "application/pdf",
          read: async () => Buffer.from("fallback"),
        },
      },
      recoverFromPhoton: true,
      client: {
        messages: {
          get: vi.fn().mockResolvedValue({
            guid: "message-5",
            content: {
              text: "Keep this caption",
              attachments: [
                {
                  guid: "file-5",
                  fileName: "fallback.pdf",
                  mimeType: "application/pdf",
                },
              ],
            },
          }),
        },
        attachments: {
          downloadStream: () =>
            (async function* () {
              throw new Error("download unavailable");
            })(),
        },
      },
      readAttachment,
    });
    expect(turn.messageText).toBe("Keep this caption");
    expect(turn.attachments).toHaveLength(1);
    expect(Buffer.from(turn.attachments[0].data, "base64").toString()).toBe(
      "fallback",
    );
    expect(turn.recoveryFailure).toMatchObject({
      stage: "attachment_download",
      sourceMessageId: "message-5",
      error: "download unavailable",
    });
  });
});
