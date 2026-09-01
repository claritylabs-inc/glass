export type OperatorSlackConfig = {
  enabled: boolean;
  hostTeamId?: string;
  mockBotUserId?: string;
  approvedChannelIds: ReadonlySet<string>;
};

export function getOperatorSlackConfig(): OperatorSlackConfig {
  const approvedChannelIds = new Set(
    (process.env.OPERATOR_SLACK_CHANNEL_IDS ?? "")
      .split(",")
      .map((channelId) => channelId.trim())
      .filter(Boolean),
  );
  return {
    enabled: process.env.OPERATOR_SLACK_ENABLED === "true",
    hostTeamId: process.env.SLACK_CLARITY_TEAM_ID?.trim() || undefined,
    mockBotUserId:
      process.env.OPERATOR_SLACK_BOT_USER_ID?.trim() || undefined,
    approvedChannelIds,
  };
}

export function isApprovedOperatorSlackChannel(channelId: string): boolean {
  const { approvedChannelIds } = getOperatorSlackConfig();
  return approvedChannelIds.has(channelId);
}

export function isSafeOperatorSlackConversation(args: {
  isDirectMessage: boolean;
  isMember?: boolean;
  isPrivate?: boolean;
  isShared?: boolean;
}): boolean {
  if (args.isDirectMessage) return true;
  return (
    args.isMember === true &&
    args.isPrivate === true &&
    args.isShared === false
  );
}
