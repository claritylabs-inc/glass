import dayjs from "dayjs";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyQuoWebhookSignature } from "./lib/quoWebhook";

const acceptedEvents = new Set(["message.received", "message.delivered"]);

type QuoMessage = {
  id?: string;
  phoneNumberId?: string;
  conversationId?: string;
  direction?: string;
  from?: string;
  to?: string | string[];
  body?: string;
  text?: string;
  status?: string;
  contactIds?: string[];
  media?: Array<{ url?: string; type?: string }>;
  createdAt?: string;
};

type QuoEvent = {
  id?: string;
  type?: string;
  createdAt?: string;
  data?: { object?: QuoMessage };
};

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

export const quoBrokerWebhook = httpAction(async (ctx, request) => {
  const signingKey = process.env.QUO_BROKER_WEBHOOK_SECRET?.trim();
  const expectedPhoneNumberId =
    process.env.QUO_BROKER_PHONE_NUMBER_ID?.trim();
  if (!signingKey || !expectedPhoneNumberId) {
    console.error("Quo broker webhook is missing required configuration");
    return textResponse("not configured", 503);
  }

  const rawBody = await request.text();
  let event: QuoEvent;
  try {
    event = JSON.parse(rawBody) as QuoEvent;
  } catch {
    return textResponse("bad request", 400);
  }

  const validSignature = await verifyQuoWebhookSignature({
    compactPayload: JSON.stringify(event),
    signatureHeader: request.headers.get("openphone-signature") ?? "",
    signingKey,
    now: dayjs().valueOf(),
  });
  if (!validSignature) {
    console.error("Quo broker webhook signature verification failed");
    return textResponse("unauthorized", 401);
  }

  if (!event.type || !acceptedEvents.has(event.type)) {
    return textResponse("ignored", 200);
  }

  const message = event.data?.object;
  if (
    !event.id ||
    !event.createdAt ||
    !message?.id ||
    !message.phoneNumberId ||
    (message.direction !== "incoming" && message.direction !== "outgoing")
  ) {
    return textResponse("bad request", 400);
  }
  if (message.phoneNumberId !== expectedPhoneNumberId) {
    return textResponse("ignored", 200);
  }

  const recipients = Array.isArray(message.to)
    ? message.to
    : message.to
      ? [message.to]
      : [];
  const counterpartyPhone =
    message.direction === "incoming" ? message.from : recipients[0];
  if (!message.from || !counterpartyPhone) {
    return textResponse("bad request", 400);
  }

  const media = message.media
    ?.filter((item): item is { url: string; type?: string } => Boolean(item.url))
    .map((item) => ({ url: item.url, type: item.type }));

  await ctx.runMutation(internal.procurementSms.ingestQuoEvent, {
    providerEventId: event.id,
    providerMessageId: message.id,
    eventType: event.type as "message.received" | "message.delivered",
    phoneNumberId: message.phoneNumberId,
    conversationId: message.conversationId,
    counterpartyPhone,
    direction: message.direction,
    from: message.from,
    to: recipients,
    body: message.body ?? message.text ?? "",
    status: message.status,
    contactIds: message.contactIds,
    media,
    providerCreatedAt: event.createdAt,
    messageCreatedAt: message.createdAt,
  });

  return textResponse("ok", 200);
});
