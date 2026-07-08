import { afterEach, describe, expect, test, vi } from "vitest";

import {
  getAgentDomain,
  getAgentDomains,
  getEmailDeliveryMode,
  isLocalEmailCaptureEnabled,
  logLocalEmailCapture,
  sendResendEmail,
} from "./resend";

describe("agent email domains", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses glass.insure when the configured agent domain is legacy", () => {
    vi.stubEnv("AGENT_DOMAIN", "glass.claritylabs.inc");

    expect(getAgentDomain()).toBe("glass.insure");
    expect(getAgentDomains()).toEqual([
      "glass.insure",
      "glass.claritylabs.inc",
      "dev.claritylabs.inc",
    ]);
  });

  test("always accepts glass.insure alongside custom legacy aliases", () => {
    vi.stubEnv("AGENT_EMAIL_DOMAIN", "agents.example.com");
    vi.stubEnv("LEGACY_AGENT_DOMAINS", "glass.claritylabs.inc, old.example.com");

    expect(getAgentDomain()).toBe("agents.example.com");
    expect(getAgentDomains()).toEqual([
      "glass.insure",
      "agents.example.com",
      "glass.claritylabs.inc",
      "old.example.com",
    ]);
  });
});

describe("email delivery modes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("defaults to live delivery", () => {
    expect(getEmailDeliveryMode()).toBe("live");
  });

  test("captures local email content without calling Resend or requiring an API key", async () => {
    const mockFetch = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    vi.stubEnv("GLASS_ENV", "local");

    const result = await sendResendEmail({
      from: "Glass <noreply@example.com>",
      to: ["person@example.com", "Team <team@example.com>"],
      cc: "cc@example.com",
      bcc: "secret@example.com",
      subject: "Sign-in code 123456",
      text: "Your Glass code is 654321.",
      html: "<p>Your Glass code is <strong>654321</strong>.</p>",
      attachments: [
        {
          filename: "welcome.pdf",
          contentType: "application/pdf",
          size: 2048,
          content: "raw-base64-secret",
        },
      ],
    });

    expect(result).toEqual({ ok: true, id: "captured" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(isLocalEmailCaptureEnabled()).toBe(true);

    const block = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(block).toContain("[glass:local-email-capture]");
    expect(block).toContain("from: Glass <noreply@example.com>");
    expect(block).toContain("to: person@example.com, team@example.com");
    expect(block).toContain("cc: cc@example.com");
    expect(block).toContain("bcc: secret@example.com");
    expect(block).toContain("subject: Sign-in code 123456");
    expect(block).toContain("codeCandidates: 123456, 654321");
    expect(block).toContain("attachmentCount: 1");
    expect(block).toContain('"filename":"welcome.pdf"');
    expect(block).toContain('"contentType":"application/pdf"');
    expect(block).not.toContain("raw-base64-secret");
    expect(block).toContain("text:\nYour Glass code is 654321.");
    expect(block).toContain("html:\n<p>Your Glass code is <strong>654321</strong>.</p>");
  });

  test("capture mode outside local logs metadata only", async () => {
    const mockFetch = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    vi.stubEnv("GLASS_ENV", "staging");

    const result = await sendResendEmail({
      from: "Glass <noreply@example.com>",
      to: "person@example.com",
      subject: "Test",
      text: "secret text body",
      html: "<p>secret html body</p>",
    });

    expect(result).toEqual({ ok: true, id: "captured" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(isLocalEmailCaptureEnabled()).toBe(false);

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).toContain("Captured email without sending");
    expect(logged).toContain("toCount");
    expect(logged).not.toContain("secret text body");
    expect(logged).not.toContain("secret html body");
  });

  test("suppressed invite OTP helper logs only in local capture", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");
    vi.stubEnv("GLASS_ENV", "local");

    const logged = logLocalEmailCapture({
      kind: "suppressed-invite-otp",
      to: "invitee@example.com",
      subject: "Suppressed invite OTP",
      text: "Suppressed invite OTP for invitee@example.com: 112233",
      codeCandidates: ["112233"],
    });

    expect(logged).toBe(true);
    expect(String(logSpy.mock.calls[0]?.[0] ?? "")).toContain("kind: suppressed-invite-otp");
    expect(String(logSpy.mock.calls[0]?.[0] ?? "")).toContain("to: invitee@example.com");
    expect(String(logSpy.mock.calls[0]?.[0] ?? "")).toContain("codeCandidates: 112233");

    vi.stubEnv("GLASS_ENV", "staging");
    expect(
      logLocalEmailCapture({
        kind: "suppressed-invite-otp",
        to: "invitee@example.com",
        codeCandidates: ["445566"],
      }),
    ).toBe(false);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  test("redirects restricted email to the configured capture recipient", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "resend-msg-restricted" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "restricted");
    vi.stubEnv("EMAIL_REDIRECT_TO", "capture@claritylabs.inc");
    vi.stubEnv("GLASS_ENV", "staging");

    const result = await sendResendEmail({
      from: "Glass <noreply@example.com>",
      to: ["person@example.com", "admin@outside.test"],
      cc: "cc@example.com",
      bcc: "secret@example.com",
      subject: "Policy update",
      text: "hello",
    });

    expect(result).toEqual({ ok: true, id: "resend-msg-restricted" });
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.to).toBe("capture@claritylabs.inc");
    expect(callBody.cc).toBeUndefined();
    expect(callBody.bcc).toBeUndefined();
    expect(callBody.subject).toBe("[STAGING] Policy update");
    expect(callBody.headers["X-Glass-Original-To"]).toContain("person@example.com");
    expect(callBody.headers["X-Glass-Environment"]).toBe("staging");
  });

  test("allows restricted email to allowlisted domains", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "resend-msg-allowed" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "restricted");
    vi.stubEnv("EMAIL_ALLOWED_RECIPIENT_DOMAINS", "claritylabs.inc");
    vi.stubEnv("GLASS_ENV", "staging");

    const result = await sendResendEmail({
      from: "Glass <noreply@example.com>",
      to: "terry@claritylabs.inc",
      subject: "Allowed",
      text: "hello",
    });

    expect(result).toEqual({ ok: true, id: "resend-msg-allowed" });
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.to).toBe("terry@claritylabs.inc");
    expect(callBody.subject).toBe("[STAGING] Allowed");
  });
});
