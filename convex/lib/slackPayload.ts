import dayjs from "dayjs";

export type SlackInboundAttachment = {
  providerFileId: string;
  filename: string;
  contentType: string;
  size?: number;
};

export type SlackInboundPayload = {
  eventKey: string;
  providerEventId?: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  replyThreadTs?: string;
  messageTs: string;
  senderTeamId?: string;
  senderUserId: string;
  content: string;
  attachments?: SlackInboundAttachment[];
  eventType: "message" | "edit" | "delete";
  isDirectMessage: boolean;
  isPrivateChannel: boolean;
  isBotEcho: boolean;
};

export type SlackLifecyclePayload = {
  eventKey: string;
  providerEventId?: string;
  eventType: string;
  teamId?: string;
  authorizationTeamId?: string;
  apiAppId?: string;
  botUserIds?: string[];
  channelId?: string;
  oldChannelId?: string;
  newChannelId?: string;
  channelName?: string;
  connectedTeamId?: string;
  previouslyConnectedTeamId?: string;
  isExtShared?: boolean;
  payloadHash: string;
  eventAt: number;
  receivedAt: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.flatMap((candidate) => string(candidate) ?? []);
  return values.length ? Array.from(new Set(values)) : undefined;
}

const SLACK_CHANNEL_LIFECYCLE_TYPES = new Set([
  "channel_archive",
  "channel_deleted",
  "channel_id_changed",
  "channel_rename",
  "channel_shared",
  "channel_unarchive",
  "channel_unshared",
  "group_archive",
  "group_deleted",
  "group_rename",
  "group_unarchive",
]);

export function parseSlackLifecyclePayload(
  value: unknown,
  payloadHash: string,
  receivedAt = dayjs().valueOf(),
): SlackLifecyclePayload | null {
  const envelope = record(value);
  const event = record(envelope?.event);
  if (envelope?.type !== "event_callback" || !event) return null;

  const outerType = string(event.type)?.toLowerCase();
  const subtype = string(event.subtype)?.toLowerCase();
  if (!outerType || outerType === "app_mention") return null;
  const eventType =
    outerType === "message" &&
    subtype &&
    SLACK_CHANNEL_LIFECYCLE_TYPES.has(subtype)
      ? subtype
      : outerType;
  if (outerType === "message" && eventType === outerType) return null;

  const channel = record(event.channel);
  const channelId = string(channel?.id ?? event.channel);
  const channelName = string(channel?.name ?? event.name);
  const tokens = record(event.tokens);
  const authorization = Array.isArray(envelope.authorizations)
    ? record(envelope.authorizations[0])
    : null;
  const teamId = string(envelope.team_id);
  const providerEventId = string(envelope.event_id);
  const eventAtSeconds = number(envelope.event_time);
  const eventAt = eventAtSeconds
    ? dayjs.unix(eventAtSeconds).valueOf()
    : receivedAt;
  const oldChannelId = string(event.old_channel_id);
  const newChannelId = string(event.new_channel_id);
  const stableParts = [
    teamId,
    eventType,
    string(event.event_ts),
    channelId,
    oldChannelId,
    newChannelId,
  ].filter(Boolean);

  return {
    eventKey: providerEventId
      ? `slack:${providerEventId}`
      : `slack:${stableParts.join(":")}:${payloadHash}`,
    ...(providerEventId ? { providerEventId } : {}),
    eventType,
    ...(teamId ? { teamId } : {}),
    ...(string(authorization?.team_id)
      ? { authorizationTeamId: string(authorization?.team_id) }
      : {}),
    ...(string(envelope.api_app_id)
      ? { apiAppId: string(envelope.api_app_id) }
      : {}),
    ...(stringArray(tokens?.bot)
      ? { botUserIds: stringArray(tokens?.bot) }
      : {}),
    ...(channelId ? { channelId } : {}),
    ...(oldChannelId ? { oldChannelId } : {}),
    ...(newChannelId ? { newChannelId } : {}),
    ...(channelName ? { channelName } : {}),
    ...(string(event.connected_team_id)
      ? { connectedTeamId: string(event.connected_team_id) }
      : {}),
    ...(string(event.previously_connected_team_id)
      ? {
          previouslyConnectedTeamId: string(event.previously_connected_team_id),
        }
      : {}),
    ...(boolean(event.is_ext_shared) === undefined
      ? {}
      : { isExtShared: boolean(event.is_ext_shared) }),
    payloadHash,
    eventAt,
    receivedAt,
  };
}

function slackFiles(value: unknown): SlackInboundAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files = value.flatMap((candidate) => {
    const file = record(candidate);
    const id = string(file?.id);
    if (!id) return [];
    const size = number(file?.size);
    return [
      {
        providerFileId: id,
        filename: string(file?.name ?? file?.title) ?? "Slack attachment",
        contentType: string(file?.mimetype) ?? "application/octet-stream",
        ...(size === undefined ? {} : { size }),
      },
    ];
  });
  return files.length ? files : undefined;
}

export function parseSlackEventPayload(
  value: unknown,
): SlackInboundPayload | null {
  const envelope = record(value);
  const outerEvent = record(envelope?.event);
  const outerType = string(outerEvent?.type)?.toLowerCase();
  if (
    envelope?.type !== "event_callback" ||
    (outerType !== "message" && outerType !== "app_mention")
  ) {
    return null;
  }

  const subtype = string(outerEvent?.subtype)?.toLowerCase();
  if (subtype === "message_replied") {
    return null;
  }
  const isEdit = subtype === "message_changed";
  const isDelete = subtype === "message_deleted";
  const message = isDelete
    ? record(outerEvent?.previous_message)
    : isEdit
      ? record(outerEvent?.message)
      : outerEvent;
  const messageSubtype = string(message?.subtype)?.toLowerCase();
  if (!message) return null;

  const teamId = string(envelope?.team_id ?? outerEvent?.team);
  const channelId = string(outerEvent?.channel ?? message?.channel);
  const messageTs = string(
    isDelete ? (outerEvent?.deleted_ts ?? message?.ts) : message?.ts,
  );
  const senderUserId = string(message?.user);
  if (!teamId || !channelId || !messageTs || !senderUserId) return null;

  const content = isDelete ? "" : (string(message?.text) ?? "");
  const attachments = isDelete ? undefined : slackFiles(message?.files);
  if (!isDelete && !content && !attachments?.length) return null;

  const eventType = isDelete ? "delete" : isEdit ? "edit" : "message";
  const revisionTs = string(
    outerEvent?.event_ts ?? record(message?.edited)?.ts,
  );
  const eventKey = [
    teamId,
    channelId,
    messageTs,
    eventType,
    ...(eventType !== "message" && revisionTs ? [revisionTs] : []),
  ].join(":");
  const channelType = string(outerEvent?.channel_type)?.toLowerCase();
  const isDirectMessage = channelType === "im" || channelId.startsWith("D");
  const explicitThreadTs = string(message?.thread_ts);
  const replyThreadTs =
    isDirectMessage && explicitThreadTs && explicitThreadTs !== messageTs
      ? explicitThreadTs
      : undefined;

  return {
    eventKey,
    ...(string(envelope?.event_id)
      ? { providerEventId: string(envelope?.event_id) }
      : {}),
    teamId,
    channelId,
    // Slack App Home is one continuous 1:1 conversation. Use the DM channel
    // as its stable Glass conversation key while preserving an explicit Slack
    // thread root as the delivery target for replies made inside a thread.
    threadTs: isDirectMessage
      ? channelId
      : (explicitThreadTs ?? messageTs),
    ...(replyThreadTs ? { replyThreadTs } : {}),
    messageTs,
    ...(string(message?.user_team ?? outerEvent?.user_team)
      ? { senderTeamId: string(message?.user_team ?? outerEvent?.user_team) }
      : {}),
    senderUserId,
    content,
    ...(attachments ? { attachments } : {}),
    eventType,
    isDirectMessage,
    isPrivateChannel: channelType === "group",
    isBotEcho:
      Boolean(string(message?.bot_id ?? outerEvent?.bot_id)) ||
      messageSubtype === "bot_message" ||
      subtype === "bot_message",
  };
}
