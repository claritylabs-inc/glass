export type OperatorSlackConfig = {
  enabled: boolean;
  hostTeamId?: string;
  mockBotUserId?: string;
};

export function operatorSlackConversationKey(args: {
  teamId: string;
  channelId: string;
  threadTs: string;
}) {
  return [args.teamId, args.channelId, args.threadTs].join(":");
}

export function getOperatorSlackConfig(): OperatorSlackConfig {
  return {
    enabled: process.env.OPERATOR_SLACK_ENABLED === "true",
    hostTeamId: process.env.SLACK_CLARITY_TEAM_ID?.trim() || undefined,
    mockBotUserId:
      process.env.OPERATOR_SLACK_BOT_USER_ID?.trim() || undefined,
  };
}
