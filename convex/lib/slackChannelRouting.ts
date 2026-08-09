export type SlackAutomaticChannelConnection = {
  automaticChannelId?: string;
  automaticChannelName?: string;
  automaticChannelRoutingConfiguredAt?: number;
};

export type SlackSupportChannelBinding = {
  customerChannelId?: string;
  hostChannelId: string;
  channelName?: string;
};

export type SlackAutomaticChannel = {
  channelId: string;
  channelName?: string;
};

export function resolveSlackAutomaticChannel(
  connection: SlackAutomaticChannelConnection,
  legacySupportBinding?: SlackSupportChannelBinding | null,
): SlackAutomaticChannel | undefined {
  const configuredId = connection.automaticChannelId?.trim() || undefined;
  if (connection.automaticChannelRoutingConfiguredAt !== undefined) {
    return configuredId
      ? {
          channelId: configuredId,
          channelName: connection.automaticChannelName?.trim() || undefined,
        }
      : undefined;
  }
  const channelId =
    configuredId ?? resolveSlackSupportChannelId(legacySupportBinding);
  if (!channelId) return undefined;
  return {
    channelId,
    channelName:
      connection.automaticChannelName?.trim() ||
      legacySupportBinding?.channelName?.trim() ||
      undefined,
  };
}

export function resolveSlackAutomaticChannelId(
  connection: SlackAutomaticChannelConnection,
  legacySupportBinding?: SlackSupportChannelBinding | null,
): string | undefined {
  return resolveSlackAutomaticChannel(connection, legacySupportBinding)
    ?.channelId;
}

export function resolveSlackSupportChannelId(
  binding: SlackSupportChannelBinding | null | undefined,
): string | undefined {
  return binding?.customerChannelId?.trim() || binding?.hostChannelId?.trim();
}
