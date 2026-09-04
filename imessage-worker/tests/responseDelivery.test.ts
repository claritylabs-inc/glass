import { describe, expect, it, vi } from "vitest";
import { deliverImessageResponse } from "../src/responseDelivery";

describe("iMessage response delivery", () => {
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
