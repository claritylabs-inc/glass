import { afterEach, describe, expect, test, vi } from "vitest";

import {
  getAgentDomain,
  getAgentDomains,
  getEmailDeliveryMode,
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("defaults to live delivery", () => {
    expect(getEmailDeliveryMode()).toBe("live");
  });

  test("captures email without calling Resend", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("EMAIL_DELIVERY_MODE", "capture");

    const result = await sendResendEmail({
      from: "Glass <noreply@example.com>",
      to: "person@example.com",
      subject: "Test",
      text: "hello",
    });

    expect(result).toEqual({ ok: true, id: "captured" });
    expect(mockFetch).not.toHaveBeenCalled();
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
