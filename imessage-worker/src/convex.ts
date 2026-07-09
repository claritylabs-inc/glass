/** Typed client for the Glass Convex /imessage-inbound HTTP endpoint. */

export interface ImessageAttachment {
  data: string;      // base64-encoded bytes
  mimeType: string;
  name: string;
}

export interface ImessageRequest {
  fromPhone: string;
  messageText: string;
  chatGuid?: string;
  isGroup?: boolean;
  chatTitle?: string;
  participantsUnavailable?: boolean;
  participants?: Array<{ address: string; displayName?: string }>;
  sourceMessageId?: string;
  receivedAt?: number;
  attachments?: ImessageAttachment[];
}

export interface ImessageResponseAttachment {
  url: string;
  filename: string;
  mimeType: string;
}

export interface ImessageAppCard {
  url: string;
  title?: string;
  subtitle?: string;
  summary?: string;
}

export interface ImessageResponse {
  response: string;
  attachments?: ImessageResponseAttachment[];
  appCards?: ImessageAppCard[];
  leaveGroup?: boolean;
  chatGuid?: string;
  threadMessageId?: string;
}

export async function sendToConvex(
  siteUrl: string,
  secret: string,
  payload: ImessageRequest,
): Promise<ImessageResponse> {
  const res = await fetch(`${siteUrl}/imessage-inbound`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Convex responded ${res.status}: ${text}`);
  }

  return res.json() as Promise<ImessageResponse>;
}

export interface ImessageDeliveryFailure {
  filename: string;
  error?: string;
}

export async function reportImessageDeliveryEvent(
  siteUrl: string,
  secret: string,
  payload: {
    threadMessageId: string;
    attachmentFailures: ImessageDeliveryFailure[];
  },
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${siteUrl}/imessage-delivery-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("Convex delivery callback failed:", err);
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.warn(`Convex delivery callback failed ${res.status}: ${text}`);
    return false;
  }
  return true;
}
