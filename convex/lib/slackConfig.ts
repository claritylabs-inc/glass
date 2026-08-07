export type SlackMode = "mock" | "slack";

const LIVE_HOST_REQUIRED_ENV = [
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_TOKEN_ENCRYPTION_KEY",
  "SLACK_CLARITY_TEAM_ID",
] as const;

export function getSlackMode(): SlackMode {
  return process.env.SLACK_MODE === "mock" ? "mock" : "slack";
}

export function isSlackMockMode(): boolean {
  return getSlackMode() === "mock";
}

export function getSlackHostConfiguration(): {
  mode: SlackMode;
  enabled: boolean;
  configured: boolean;
} {
  const mode = getSlackMode();
  const enabled = process.env.SLACK_ENABLED === "true";
  if (mode === "mock") {
    return {
      mode,
      enabled,
      configured: Boolean(process.env.SLACK_CLARITY_TEAM_ID?.trim()),
    };
  }

  const hasRequiredEnvironment = LIVE_HOST_REQUIRED_ENV.every((name) =>
    Boolean(process.env[name]?.trim()),
  );
  const hasRedirectOrigin = Boolean(
    process.env.SLACK_OAUTH_REDIRECT_URI?.trim() ||
      process.env.CONVEX_SITE_URL?.trim(),
  );

  return {
    mode,
    enabled,
    configured: hasRequiredEnvironment && hasRedirectOrigin,
  };
}
