export type StoredEmailPayloadFields = {
  fromHeader?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  renderedText?: string;
  renderedHtml?: string;
};

export function parseEmailPayloadRecord(
  emailPayload: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(emailPayload);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function extractStoredEmailPayloadFields(
  emailPayload: string,
): StoredEmailPayloadFields {
  const payload = parseEmailPayloadRecord(emailPayload);
  const headers =
    payload.headers && typeof payload.headers === "object"
      ? (payload.headers as Record<string, unknown>)
      : {};

  return {
    fromHeader: stringField(payload.from),
    replyTo: stringField(payload.reply_to),
    inReplyTo: stringField(headers["In-Reply-To"]),
    references: stringField(headers.References),
    renderedText: stringField(payload.text),
    renderedHtml: stringField(payload.html),
  };
}
