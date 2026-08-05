import { afterEach, describe, expect, test, vi } from "vitest";
import { getSlackMode, isSlackMockMode } from "./slackConfig";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Slack environment mode", () => {
  test("defaults to live Slack mode", () => {
    vi.stubEnv("SLACK_MODE", "");

    expect(getSlackMode()).toBe("slack");
    expect(isSlackMockMode()).toBe(false);
  });

  test("keeps staging mock mode explicit", () => {
    vi.stubEnv("SLACK_MODE", "mock");

    expect(getSlackMode()).toBe("mock");
    expect(isSlackMockMode()).toBe(true);
  });
});
