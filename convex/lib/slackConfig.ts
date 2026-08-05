export type SlackMode = "mock" | "slack";

export function getSlackMode(): SlackMode {
  return process.env.SLACK_MODE === "mock" ? "mock" : "slack";
}

export function isSlackMockMode(): boolean {
  return getSlackMode() === "mock";
}
