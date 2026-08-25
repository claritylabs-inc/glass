import { describe, expect, it, vi } from "vitest";
import {
  deliverImessageResponse,
  splitImessageResponse,
} from "../src/responseDelivery";

describe("iMessage response delivery", () => {
  it("splits paragraphs into separate response bubbles", () => {
    expect(splitImessageResponse("First.\n\nSecond.\n\nThird.")).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
  });

  it("hard-splits a single oversized token without breaking a code point", () => {
    const token = `${"a".repeat(519)}😀b`;
    const segments = splitImessageResponse(token);

    expect(segments).toEqual(["a".repeat(519), "😀b"]);
    expect(segments.every((segment) => segment.length <= 520)).toBe(true);
    expect(segments.join("")).toBe(token);
  });

  it("delivers every bubble through one native reply operation", async () => {
    const replyAll = vi.fn(async (segments: string[]) => segments.length);
    const sendChat = vi.fn(async () => undefined);
    const segments = ["First.", "Second.", "Third."];

    await expect(
      deliverImessageResponse({ segments, replyAll, sendChat }),
    ).resolves.toEqual({
      mode: "thread",
      deliveredSegments: 3,
      expectedSegments: 3,
      complete: true,
    });
    expect(replyAll).toHaveBeenCalledOnce();
    expect(replyAll).toHaveBeenCalledWith(segments);
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("falls back with the whole response only when no reply bubble was sent", async () => {
    const sendChat = vi.fn(async () => undefined);
    const segments = ["First.", "Second."];

    await expect(
      deliverImessageResponse({
        segments,
        replyAll: async () => 0,
        sendChat,
      }),
    ).resolves.toMatchObject({ mode: "chat", complete: true });
    expect(sendChat.mock.calls.map(([segment]) => segment)).toEqual(segments);
  });

  it("never sends remaining bubbles outside a partially created reply thread", async () => {
    const sendChat = vi.fn(async () => undefined);

    await expect(
      deliverImessageResponse({
        segments: ["First.", "Second.", "Third."],
        replyAll: async () => 1,
        sendChat,
      }),
    ).resolves.toEqual({
      mode: "thread",
      deliveredSegments: 1,
      expectedSegments: 3,
      complete: false,
    });
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("does not risk an unthreaded duplicate after an ambiguous reply error", async () => {
    const sendChat = vi.fn(async () => undefined);
    const error = new Error("provider reply failed");

    await expect(
      deliverImessageResponse({
        segments: ["First.", "Second."],
        replyAll: async () => {
          throw error;
        },
        sendChat,
      }),
    ).resolves.toEqual({
      mode: "thread",
      deliveredSegments: 0,
      expectedSegments: 2,
      complete: false,
      error,
    });
    expect(sendChat).not.toHaveBeenCalled();
  });
});
