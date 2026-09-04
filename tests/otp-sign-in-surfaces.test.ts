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

});
