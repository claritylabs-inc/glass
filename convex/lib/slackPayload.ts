export type SlackInboundPayload = {
  eventKey: string;
  spectrumMessageId: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  senderTeamId?: string;
  senderUserId: string;
  senderDisplayName?: string;
  content: string;
  attachment?: {
    providerFileId: string;
    filename: string;
    contentType: string;
    size?: number;
  };
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

export function parseSlackWebhookPayload(
  value: unknown,
  webhookId?: string,
): SlackInboundPayload | null {
  const envelope = record(value);
  const message = record(envelope?.message);
  const space = record(envelope?.space) ?? record(message?.space);
  const sender = record(message?.sender);
  const content = record(message?.content);
  const platform = string(message?.platform ?? space?.platform)?.toLowerCase();
  if (envelope?.event !== "messages" || platform !== "slack") return null;

  const spectrumMessageId = string(message?.id);
  const channelId = string(space?.id);
  const teamId = string(space?.teamId ?? message?.teamId);
  const senderUserId = string(sender?.id);
  if (!spectrumMessageId || !channelId || !teamId || !senderUserId) return null;

  const contentType = string(content?.type);
  if (contentType === "reaction") return null;
  const text = contentType === "text" ? string(content?.text) ?? "" : "";
  const providerFileId =
    contentType === "attachment" ? string(content?.id) : undefined;
  if (!text && !providerFileId) return null;

  const messageTs =
    string(message?.ts) ?? string(message?.timestamp) ?? spectrumMessageId;
  const threadTs = string(message?.threadTs) ?? messageTs;
  const subtype = string(message?.subtype)?.toLowerCase();
  const senderTeamId = string(
    sender?.teamId ?? sender?.team_id ?? message?.userTeam,
  );
  const spaceType = string(space?.type)?.toLowerCase();

  return {
    eventKey: `${webhookId ? `${webhookId}:` : ""}${spectrumMessageId}`,
    spectrumMessageId,
    teamId,
    channelId,
    threadTs,
    messageTs,
    ...(senderTeamId ? { senderTeamId } : {}),
    senderUserId,
    senderDisplayName: string(sender?.displayName ?? sender?.name),
    content: text,
    attachment: providerFileId
      ? {
          providerFileId,
          filename: string(content?.name) ?? "Slack attachment",
          contentType:
            string(content?.mimeType) ?? "application/octet-stream",
          ...(typeof content?.size === "number" ? { size: content.size } : {}),
        }
      : undefined,
    eventType:
      subtype === "message_changed" || subtype === "message_edited"
        ? "edit"
        : "message",
    isDirectMessage: spaceType === "dm" || channelId.startsWith("D"),
    isBotEcho:
      message?.isFromMe === true ||
      subtype === "bot_message" ||
      sender?.isBot === true,
  };
}
