import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ImessageConvexError,
  isImessageConvexTimeout,
  sendToConvex,
} from "../src/convex";

const request = {
  fromPhone: "+12025550101",
  messageText: "Hello",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("iMessage Convex transport errors", () => {
  test("types HTTP timeouts without inspecting error prose", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("late", { status: 408 })));

    const error = await sendToConvex("https://example.test", "secret", request)
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ImessageConvexError);
    expect(error).toMatchObject({ code: "request_timeout", status: 408 });
    expect(isImessageConvexTimeout(error)).toBe(true);
  });

  test("does not infer timeout semantics from arbitrary error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream timeout", { status: 500 })),
    );

    const error = await sendToConvex("https://example.test", "secret", request)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "http_error", status: 500 });
    expect(isImessageConvexTimeout(error)).toBe(false);
  });
});
