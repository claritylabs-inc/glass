import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeOtpSignIn } from "../lib/otp-auth";

const root = join(__dirname, "..");

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

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

  it.each([
    "components/auth-entry-page.tsx",
    "components/broker-auth-entry-page.tsx",
    "app/operator/login/page.tsx",
    "app/oauth/authorize/page.tsx",
    "app/invite/[token]/invite-acceptance.tsx",
    "app/connected-orgs/request/[token]/request-acceptance.tsx",
  ])("completes OTP verification with a full authenticated navigation in %s", (relativePath) => {
    const source = read(relativePath);

    expect(source).toContain('import { completeOtpSignIn } from "@/lib/otp-auth";');
    expect(source).toContain("await completeOtpSignIn(");
    expect(source).toMatch(/window\.location\.(assign|reload)\(/);
    expect(source).not.toMatch(/await signIn\("resend-otp", \{[^\n]*code/);
  });
});
