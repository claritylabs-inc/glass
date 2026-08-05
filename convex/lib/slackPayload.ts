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
  messageTs: string;
  senderTeamId?: string;
  senderUserId: string;
  content: string;
  attachments?: SlackInboundAttachment[];
  eventType: "message" | "edit";
  isDirectMessage: boolean;
  isBotEcho: boolean;
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

function slackFiles(value: unknown): SlackInboundAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files = value.flatMap((candidate) => {
    const file = record(candidate);
    const id = string(file?.id);
    if (!id) return [];
    const size = number(file?.size);
    return [{
      providerFileId: id,
      filename: string(file?.name ?? file?.title) ?? "Slack attachment",
      contentType: string(file?.mimetype) ?? "application/octet-stream",
      ...(size === undefined ? {} : { size }),
    }];
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
  if (subtype === "message_deleted" || subtype === "message_replied") {
    return null;
  }
  const isEdit = subtype === "message_changed";
  const message = isEdit ? record(outerEvent?.message) : outerEvent;
  const messageSubtype = string(message?.subtype)?.toLowerCase();
  if (!message || messageSubtype === "message_deleted") return null;

  const teamId = string(envelope?.team_id ?? outerEvent?.team);
  const channelId = string(outerEvent?.channel ?? message?.channel);
  const messageTs = string(message?.ts);
  const senderUserId = string(message?.user);
  if (!teamId || !channelId || !messageTs || !senderUserId) return null;

  const content = string(message?.text) ?? "";
  const attachments = slackFiles(message?.files);
  if (!content && !attachments?.length) return null;

  const eventType = isEdit ? "edit" : "message";
  const revisionTs = string(
    outerEvent?.event_ts ?? record(message?.edited)?.ts,
  );
  const eventKey = [
    teamId,
    channelId,
    messageTs,
    eventType,
    ...(eventType === "edit" && revisionTs ? [revisionTs] : []),
  ].join(":");
  const channelType = string(outerEvent?.channel_type)?.toLowerCase();

  return {
    eventKey,
    ...(string(envelope?.event_id)
      ? { providerEventId: string(envelope?.event_id) }
      : {}),
    teamId,
    channelId,
    threadTs: string(message?.thread_ts) ?? messageTs,
    messageTs,
    ...(string(message?.user_team ?? outerEvent?.user_team)
      ? { senderTeamId: string(message?.user_team ?? outerEvent?.user_team) }
      : {}),
    senderUserId,
    content,
    ...(attachments ? { attachments } : {}),
    eventType,
    isDirectMessage: channelType === "im" || channelId.startsWith("D"),
    isBotEcho:
      Boolean(string(message?.bot_id ?? outerEvent?.bot_id)) ||
      messageSubtype === "bot_message" ||
      subtype === "bot_message",
  };
}
