import { afterEach, describe, expect, test, vi } from "vitest";

import { getAgentDomain, getAgentDomains } from "./resend";

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
