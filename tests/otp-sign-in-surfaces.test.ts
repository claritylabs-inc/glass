import { afterEach, describe, expect, it, vi } from "vitest";
import { completeOtpSignIn } from "../lib/otp-auth";

describe("OTP sign-in", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets auth cookies through the same-origin Next.js proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tokens: { token: "access-token" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeOtpSignIn("person@example.com", "123456");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({
      action: "auth:signIn",
      args: {
        provider: "resend-otp",
        params: { email: "person@example.com", code: "123456" },
      },
    });
  });

  it("preserves proxy verification errors for the existing friendly error copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Could not verify code" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(completeOtpSignIn("person@example.com", "000000")).rejects.toThrow(
      "Could not verify code",
    );
  });

  it("rejects a successful response that did not establish a session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tokens: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(completeOtpSignIn("person@example.com", "123456")).rejects.toThrow(
      "Could not complete sign-in",
    );
  });

});
