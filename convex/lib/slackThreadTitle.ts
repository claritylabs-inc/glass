const SLACK_MENTION_PATTERN = /<@[A-Z0-9-]+>/giu;

function truncate(value: string, length: number) {
  return Array.from(value).slice(0, length).join("");
}

function normalizeChannelLabel(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .replace(/^#+/u, "")
    .replace(/\s+/gu, "-");
}

export function slackChannelTitlePrefix(args: {
  channelId: string;
  channelName?: string;
}) {
  const channelLabel =
    normalizeChannelLabel(args.channelName ?? "") ||
    normalizeChannelLabel(args.channelId) ||
    "slack-channel";
  return `#${truncate(channelLabel, 80)}`;
}

export function slackThreadTitle(prefix: string, subject: string) {
  const normalizedPrefix = truncate(prefix.normalize("NFC").trim(), 81);
  const normalizedSubject = truncate(subject.normalize("NFC").trim(), 40);
  if (!normalizedPrefix) return normalizedSubject || "Slack Thread";
  if (!normalizedSubject) return normalizedPrefix;
  return `${normalizedPrefix} · ${normalizedSubject}`;
}

export function slackThreadTitleSeed(content: string) {
  return content
    .replace(SLACK_MENTION_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isLegacyOperatorSlackTitle(title: string, channelId: string) {
  return title === `Slack · ${channelId}`;
}
