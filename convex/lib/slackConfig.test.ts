import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getSlackHostConfiguration,
  getSlackMode,
  isSlackMockMode,
} from "./slackConfig";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Slack environment mode", () => {
  test("defaults to live Slack mode", () => {
    vi.stubEnv("SLACK_MODE", "");

    expect(getSlackMode()).toBe("slack");
    expect(isSlackMockMode()).toBe(false);
  });

  test("keeps mock mode explicit", () => {
    vi.stubEnv("SLACK_MODE", "mock");
    vi.stubEnv("SLACK_ENABLED", "true");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-FIXTURE");

    expect(getSlackMode()).toBe("mock");
    expect(isSlackMockMode()).toBe(true);
    expect(getSlackHostConfiguration()).toEqual({
      mode: "mock",
      enabled: true,
      configured: true,
    });

    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "");
    expect(getSlackHostConfiguration()).toEqual({
      mode: "mock",
      enabled: true,
      configured: false,
    });
  });

  test("requires the complete live host OAuth configuration", () => {
    vi.stubEnv("SLACK_MODE", "slack");
    vi.stubEnv("SLACK_ENABLED", "true");
    vi.stubEnv("SLACK_CLIENT_ID", "client-id");
    vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", "encryption-key");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-CLARITY");
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.example.test");

    expect(getSlackHostConfiguration()).toEqual({
      mode: "slack",
      enabled: true,
      configured: true,
    });

    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    expect(getSlackHostConfiguration()).toEqual({
      mode: "slack",
      enabled: true,
      configured: false,
    });
  });

  test("accepts an explicit OAuth redirect without a Convex site URL", () => {
    vi.stubEnv("SLACK_MODE", "slack");
    vi.stubEnv("SLACK_ENABLED", "false");
    vi.stubEnv("SLACK_CLIENT_ID", "client-id");
    vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", "encryption-key");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-CLARITY");
    vi.stubEnv("CONVEX_SITE_URL", "");
    vi.stubEnv(
      "SLACK_OAUTH_REDIRECT_URI",
      "https://example.test/slack/oauth/callback",
    );

    expect(getSlackHostConfiguration()).toEqual({
      mode: "slack",
      enabled: false,
      configured: true,
    });
  });
});
