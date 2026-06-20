import http from "node:http";
import {
  Spectrum,
  app as appCard,
  attachment,
  type ContentInput,
  type Message,
  type Space,
  type SpectrumInstance,
} from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { terminal } from "@spectrum-ts/terminal";
import {
  sendToConvex,
  type ImessageAttachment,
  type ImessageAppCard,
  type ImessageResponseAttachment,
} from "./convex.js";

type AdvancedImessageClient = {
  attachments?: {
    upload(input: {
      data: Buffer;
      fileName: string;
    }): Promise<{ attachment: { guid: string } }>;
  };
  chats?: {
    get(chatGuid: string): Promise<{
      displayName?: string;
      isGroup?: boolean;
      participants?: readonly { address: string }[];
    }>;
    create(addresses: string[], options?: {
      message?: string;
      clientMessageId?: string;
    }): Promise<{
      chat: {
        guid: string;
        displayName?: string;
        isGroup?: boolean;
        participants?: readonly { address: string }[];
      };
    }>;
  };
  groups?: {
    leave(chatGuid: string): Promise<void>;
    setDisplayName(chatGuid: string, displayName: string, options?: {
      clientMessageId?: string;
    }): Promise<unknown>;
  };
  messages?: {
    sendAttachment(
      chatGuid: string,
      attachmentGuid: string,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    sendText(
      chatGuid: string,
      text: string,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
  };
};

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.PHOTON_PROJECT_ID;
const PROJECT_SECRET = process.env.PHOTON_PROJECT_SECRET;
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
const WORKER_SECRET = process.env.IMESSAGE_WORKER_SECRET ?? "";
const IMESSAGE_ENABLED = process.env.IMESSAGE_ENABLED === "true";
const SPECTRUM_PROVIDER = process.env.SPECTRUM_PROVIDER;
const USE_TERMINAL =
  SPECTRUM_PROVIDER === "terminal" ||
  (!IMESSAGE_ENABLED && SPECTRUM_PROVIDER !== "imessage");
const TRANSPORT = USE_TERMINAL ? "terminal" : "imessage";
const TERMINAL_FROM_PHONE =
  process.env.IMESSAGE_TERMINAL_FROM_PHONE ??
  process.env.DEV_IMESSAGE_FROM_PHONE ??
  "";
const TERMINAL_SPACE_ID = process.env.IMESSAGE_TERMINAL_SPACE_ID ?? "chat-1";
const SEND_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const sendIdempotencyKeys = new Map<
  string,
  { status: "sending" | "sent"; expiresAt: number }
>();

if (TRANSPORT === "imessage" && !IMESSAGE_ENABLED) {
  console.error("IMESSAGE_ENABLED must be true before connecting to Photon iMessage");
  process.exit(1);
}
if (TRANSPORT === "imessage" && (!PROJECT_ID || !PROJECT_SECRET)) {
  console.error("PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET are required");
  process.exit(1);
}
if (!CONVEX_SITE_URL) {
  console.error("CONVEX_SITE_URL is required");
  process.exit(1);
}
if (TRANSPORT === "terminal" && !TERMINAL_FROM_PHONE) {
  console.error(
    "IMESSAGE_TERMINAL_FROM_PHONE is required for terminal mode so Convex can route to a Glass user",
  );
  process.exit(1);
}

export function imessageProcessingFallbackMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Convex responded 408|Client disconnected|timed?\s*out|timeout/i.test(message)) {
    return "I'm still working on that. If I don't follow up here, check Glass for the draft.";
  }
  return "Sorry, something went wrong. Please try again.";
}

function pruneSendIdempotencyKeys() {
  const now = Date.now();
  for (const [key, value] of sendIdempotencyKeys.entries()) {
    if (value.expiresAt <= now) {
      sendIdempotencyKeys.delete(key);
    }
  }
}

function claimSendIdempotencyKey(clientMessageId?: string) {
  if (!clientMessageId) return true;
  pruneSendIdempotencyKeys();
  if (sendIdempotencyKeys.has(clientMessageId)) return false;
  sendIdempotencyKeys.set(clientMessageId, {
    status: "sending",
    expiresAt: Date.now() + SEND_IDEMPOTENCY_TTL_MS,
  });
  return true;
}

function completeSendIdempotencyKey(clientMessageId?: string) {
  if (!clientMessageId) return;
  sendIdempotencyKeys.set(clientMessageId, {
    status: "sent",
    expiresAt: Date.now() + SEND_IDEMPOTENCY_TTL_MS,
  });
}

function releaseSendIdempotencyKey(clientMessageId?: string) {
  if (!clientMessageId) return;
  const existing = sendIdempotencyKeys.get(clientMessageId);
  if (existing?.status === "sending") {
    sendIdempotencyKeys.delete(clientMessageId);
  }
}

function parseHttpPort(configuredPort: string): number {
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid HTTP port: ${configuredPort}`);
    process.exit(1);
  }
  return port;
}

function getHttpPorts(): number[] {
  const primaryPort = parseHttpPort(
    process.env.PORT ?? process.env.WORKER_HTTP_PORT ?? "3001",
  );
  if (!process.env.RAILWAY_ENVIRONMENT) return [primaryPort];

  const publicDomainPort = parseHttpPort(process.env.WORKER_HTTP_PORT ?? "3001");
  return [...new Set([primaryPort, publicDomainPort])];
}

function readStringField(value: unknown, fieldNames: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const field = record[fieldName];
    if (typeof field === "string" && field.trim().length > 0) {
      return field;
    }
    if (typeof field === "number" && Number.isFinite(field)) {
      return String(field);
    }
  }
  return undefined;
}

function readTimestamp(value: unknown, fieldNames: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const field = record[fieldName];
    if (typeof field === "number" && Number.isFinite(field)) {
      return field < 10_000_000_000 ? field * 1000 : field;
    }
    if (typeof field === "string") {
      const parsed = Date.parse(field);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (field instanceof Date) {
      return field.getTime();
    }
  }
  return undefined;
}

async function sendOutboundAttachments(
  space: Space,
  attachments?: ImessageResponseAttachment[],
) {
  for (const att of attachments ?? []) {
    try {
      const res = await fetch(att.url);
      if (!res.ok) {
        console.warn(`[glass-imessage] Failed to download attachment ${att.filename}: ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await space.send(
        attachment(buffer, { name: att.filename, mimeType: att.mimeType }),
      );
    } catch (err) {
      console.warn(`[glass-imessage] Failed to send attachment ${att.filename}:`, err);
    }
  }
}

function appCardFallbackText(card: ImessageAppCard) {
  return [card.title, card.subtitle, card.url]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
}

async function sendReplyOrFallback(
  space: Space,
  message: Message,
  content: ContentInput,
  fallbackText?: string,
) {
  try {
    const replied = await message.reply(content);
    if (replied) return;
  } catch (err) {
    console.warn("[glass-imessage] Failed to send threaded reply:", err);
  }
  await space.send(fallbackText ?? content);
}

async function sendOutboundAppCards(
  space: Space,
  appCards?: ImessageAppCard[],
  targetMessage?: Message,
) {
  for (const card of appCards ?? []) {
    if (!card.url) continue;
    const content = appCard(card.url);
    try {
      if (targetMessage) {
        await sendReplyOrFallback(space, targetMessage, content, appCardFallbackText(card));
      } else {
        await space.send(content);
      }
    } catch (err) {
      console.warn(`[glass-imessage] Failed to send app card ${card.url}:`, err);
      await space.send(appCardFallbackText(card));
    }
  }
}

async function sendAttachmentsThroughClient(
  client: AdvancedImessageClient,
  chatGuid: string,
  attachments?: ImessageResponseAttachment[],
  clientMessageId?: string,
) {
  if (!attachments?.length) return;
  if (!client.attachments?.upload || !client.messages?.sendAttachment) {
    console.warn("[glass-imessage] Attachment send by chat GUID is not available");
    return;
  }

  for (const [index, att] of attachments.entries()) {
    try {
      const res = await fetch(att.url);
      if (!res.ok) {
        console.warn(`[glass-imessage] Failed to download attachment ${att.filename}: ${res.status}`);
        continue;
      }
      const uploaded = await client.attachments.upload({
        data: Buffer.from(await res.arrayBuffer()),
        fileName: att.filename,
      });
      await client.messages.sendAttachment(chatGuid, uploaded.attachment.guid, {
        clientMessageId: clientMessageId
          ? `${clientMessageId}:attachment:${index}`
          : undefined,
      });
    } catch (err) {
      console.warn(`[glass-imessage] Failed to send attachment ${att.filename}:`, err);
    }
  }
}

async function sendAppCardsThroughClient(
  client: AdvancedImessageClient,
  chatGuid: string,
  appCards?: ImessageAppCard[],
  clientMessageId?: string,
) {
  if (!appCards?.length) return;
  if (!client.messages?.sendText) {
    console.warn("[glass-imessage] App card fallback send by chat GUID is not available");
    return;
  }

  for (const [index, card] of appCards.entries()) {
    if (!card.url) continue;
    try {
      await client.messages.sendText(chatGuid, appCardFallbackText(card), {
        clientMessageId: clientMessageId
          ? `${clientMessageId}:app-card:${index}`
          : undefined,
      });
    } catch (err) {
      console.warn(`[glass-imessage] Failed to send app card fallback ${card.url}:`, err);
    }
  }
}

async function sendByChatGuid(params: {
  app: SpectrumInstance;
  chatGuid: string;
  message: string;
  attachments?: ImessageResponseAttachment[];
  appCards?: ImessageAppCard[];
  clientMessageId?: string;
}) {
  if (TRANSPORT !== "imessage") return false;
  const client = getAdvancedImessageClient(params.app);
  if (!client?.messages?.sendText) return false;

  try {
    await client.messages.sendText(params.chatGuid, params.message, {
      clientMessageId: params.clientMessageId,
    });
    await sendAppCardsThroughClient(
      client,
      params.chatGuid,
      params.appCards,
      params.clientMessageId,
    );
    await sendAttachmentsThroughClient(
      client,
      params.chatGuid,
      params.attachments,
      params.clientMessageId,
    );
    return true;
  } catch (err) {
    console.warn(
      `[glass-imessage] Failed to send by chat GUID ${params.chatGuid}:`,
      err,
    );
    return false;
  }
}

function normalizePhone(raw: string): string {
  if (raw.includes("@")) return raw.trim().toLowerCase();
  const cleaned = raw.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function deterministicTerminalGroupGuid(participants: string[]): string {
  const key = participants.map(normalizePhone).sort().join(",");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `terminal-group-${Math.abs(hash)}`;
}

function getAdvancedImessageClient(app: SpectrumInstance, space?: Space): AdvancedImessageClient | undefined {
  const runtime = app.__internal.platforms.get("iMessage");
  const client = runtime?.client;
  if (!client) return undefined;
  if (Array.isArray(client)) {
    const phone = readStringField(space, ["phone"]);
    const entry =
      client.find((candidate: unknown) => {
        const record = candidate as Record<string, unknown>;
        return typeof record.phone === "string" && record.phone === phone;
      }) ?? client[0];
    const record = entry as Record<string, unknown> | undefined;
    return record?.client as AdvancedImessageClient | undefined;
  }
  return client as AdvancedImessageClient;
}

async function getChatSnapshot(app: SpectrumInstance, space: Space) {
  const chatGuid = readStringField(space, ["id"]);
  if (!chatGuid || TRANSPORT !== "imessage") {
    return {
      chatGuid,
      isGroup: readStringField(space, ["type"]) === "group",
      participants: [] as Array<{ address: string }>,
      participantsUnavailable: false,
    };
  }

  const fallbackIsGroup = readStringField(space, ["type"]) === "group";
  try {
    const client = getAdvancedImessageClient(app, space);
    const chat = await client?.chats?.get(chatGuid);
    if (!chat) {
      return {
        chatGuid,
        isGroup: fallbackIsGroup,
        participants: [] as Array<{ address: string }>,
        participantsUnavailable: fallbackIsGroup,
      };
    }
    const participants = (chat.participants ?? []).map((participant) => ({
      address: participant.address,
    }));
    return {
      chatGuid,
      isGroup: chat.isGroup === true,
      chatTitle: chat.displayName,
      participants,
      participantsUnavailable: chat.isGroup === true && participants.length === 0,
    };
  } catch (err) {
    console.warn(`[glass-imessage] Failed to fetch chat snapshot for ${chatGuid}:`, err);
    return {
      chatGuid,
      isGroup: fallbackIsGroup,
      participants: [] as Array<{ address: string }>,
      participantsUnavailable: fallbackIsGroup,
    };
  }
}

async function startSpectrum(): Promise<SpectrumInstance> {
  if (TRANSPORT === "terminal") {
    return await Spectrum({
      providers: [
        terminal.config({
          commands: [
            { name: "/whoami", description: "Show the configured test phone" },
          ],
        }),
      ],
    });
  }

  return await Spectrum({
    projectId: PROJECT_ID!,
    projectSecret: PROJECT_SECRET!,
    providers: [imessage.config()],
  });
}

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[glass-imessage] Connecting to Spectrum ${TRANSPORT} provider...`);

  const app = await startSpectrum();
  const activeSpacesByPhone = new Map<string, Space>();
  const activeSpacesByChatGuid = new Map<string, Space>();

  console.log("[glass-imessage] Connected. Waiting for messages...");

  // ── Outbound HTTP server ──────────────────────────────────────────────────
  // POST /send { toPhone, message } — sends proactive text via the active
  // Spectrum provider. For an active inbound exchange, this reuses the same
  // space so follow-up messages stay in the same iMessage conversation as
  // final responses and attachments. Otherwise it falls back to a proactive send.
  // Protected by the same IMESSAGE_WORKER_SECRET used for inbound verification.
  const httpPorts = getHttpPorts();
  const handleHttpRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        service: "glass-imessage-worker",
        transport: TRANSPORT,
        imessageEnabled: IMESSAGE_ENABLED,
        convexSiteConfigured: Boolean(CONVEX_SITE_URL),
        workerSecretConfigured: Boolean(WORKER_SECRET),
        photonConfigured: Boolean(PROJECT_ID && PROJECT_SECRET),
        httpPorts,
      }));
      return;
    }

    if (req.method !== "POST" || requestUrl.pathname !== "/send") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const authHeader = req.headers["authorization"] ?? "";
    if (WORKER_SECRET && authHeader !== `Bearer ${WORKER_SECRET}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const body = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer | string) => { data += chunk.toString(); });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    let payload: {
      toPhone?: string;
      chatGuid?: string;
      participants?: string[];
      message?: string;
      title?: string;
      clientMessageId?: string;
      attachments?: ImessageResponseAttachment[];
      appCards?: ImessageAppCard[];
    };
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const messageText = payload.message?.trim() ||
      (payload.appCards?.length
        ? "Glass shared a link."
        : payload.attachments?.length
          ? "Glass shared attachment(s)."
          : "");
    if ((!payload.toPhone && !payload.chatGuid && !payload.participants?.length) || !messageText) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "toPhone, chatGuid, or participants and message/appCards/attachments are required" }));
      return;
    }

    if (!claimSendIdempotencyKey(payload.clientMessageId)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, duplicate: true }));
      return;
    }

    try {
      if (payload.participants?.length) {
        const participants = [...new Set(payload.participants.map(normalizePhone).filter(Boolean))];
        if (participants.length < 2) {
          releaseSendIdempotencyKey(payload.clientMessageId);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "At least two participants are required for a group chat" }));
          return;
        }

        if (TRANSPORT === "terminal") {
          const terminalClient = terminal(app);
          const space = await terminalClient.space.get(TERMINAL_SPACE_ID);
          await space.send(`[new group: ${participants.join(", ")}] ${messageText}`);
          await sendOutboundAppCards(space, payload.appCards);
          await sendOutboundAttachments(space, payload.attachments);
          const chatGuid = deterministicTerminalGroupGuid(participants);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            chatGuid,
            isGroup: true,
            participants: participants.map((address) => ({ address })),
          }));
          completeSendIdempotencyKey(payload.clientMessageId);
          return;
        }

        const imessageClient = getAdvancedImessageClient(app);
        if (!imessageClient?.chats?.create) {
          releaseSendIdempotencyKey(payload.clientMessageId);
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "iMessage group creation is not available" }));
          return;
        }

        const created = await imessageClient.chats.create(participants, {
          message: messageText,
          clientMessageId: payload.clientMessageId,
        });
        if (payload.appCards?.length) {
          console.warn("[glass-imessage] App cards are not available during new group creation");
        }
        if (payload.attachments?.length) {
          console.warn("[glass-imessage] Attachment send is not available during new group creation");
        }
        const chatGuid = created.chat.guid;
        if (payload.title?.trim() && imessageClient.groups?.setDisplayName) {
          await imessageClient.groups.setDisplayName(chatGuid, payload.title.trim(), {
            clientMessageId: payload.clientMessageId
              ? `${payload.clientMessageId}:title`
              : undefined,
          });
        }
        const returnedParticipants = created.chat.participants?.length
          ? created.chat.participants.map((participant) => ({
              address: normalizePhone(participant.address),
            }))
          : participants.map((address) => ({ address }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          chatGuid,
          isGroup: true,
          participants: returnedParticipants,
        }));
        completeSendIdempotencyKey(payload.clientMessageId);
        return;
      }

      const activeChatSpace = payload.chatGuid
        ? activeSpacesByChatGuid.get(payload.chatGuid)
        : undefined;
      if (activeChatSpace) {
        await activeChatSpace.send(messageText);
        await sendOutboundAppCards(activeChatSpace, payload.appCards);
        await sendOutboundAttachments(activeChatSpace, payload.attachments);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        completeSendIdempotencyKey(payload.clientMessageId);
        return;
      }

      if (payload.chatGuid) {
        const sentByChatGuid = await sendByChatGuid({
          app,
          chatGuid: payload.chatGuid,
          message: messageText,
          attachments: payload.attachments,
          appCards: payload.appCards,
          clientMessageId: payload.clientMessageId,
        });
        if (sentByChatGuid) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          completeSendIdempotencyKey(payload.clientMessageId);
          return;
        }
      }

      if (!payload.toPhone) {
        releaseSendIdempotencyKey(payload.clientMessageId);
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active chat space" }));
        return;
      }

      const toPhone = normalizePhone(payload.toPhone);
      const activeSpace = activeSpacesByPhone.get(toPhone);
      if (activeSpace) {
        await activeSpace.send(messageText);
        await sendOutboundAppCards(activeSpace, payload.appCards);
        await sendOutboundAttachments(activeSpace, payload.attachments);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        completeSendIdempotencyKey(payload.clientMessageId);
        return;
      }

      if (TRANSPORT === "terminal") {
        const terminalClient = terminal(app);
        const space = await terminalClient.space.get(TERMINAL_SPACE_ID);
        await space.send(messageText);
        await sendOutboundAppCards(space, payload.appCards);
        await sendOutboundAttachments(space, payload.attachments);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        completeSendIdempotencyKey(payload.clientMessageId);
        return;
      }

      const imessageClient = imessage(app);
      const user = await imessageClient.user(payload.toPhone);
      const space = await imessageClient.space.create(user);
      await space.send(messageText);
      await sendOutboundAppCards(space, payload.appCards);
      await sendOutboundAttachments(space, payload.attachments);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      completeSendIdempotencyKey(payload.clientMessageId);
    } catch (err) {
      releaseSendIdempotencyKey(payload.clientMessageId);
      console.error("[glass-imessage] Failed to send outbound message:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to send message" }));
    }
  };

  const httpServers = httpPorts.map((port) => ({
    port,
    server: http.createServer(handleHttpRequest),
  }));
  for (const { port, server } of httpServers) {
    server.listen(port, () => {
      console.log(`[glass-imessage] Outbound HTTP server listening on port ${port}`);
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[glass-imessage] Shutting down...");
    for (const { server } of httpServers) {
      server.close();
    }
    await app.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  for await (const [space, message] of app.messages) {
    if (TRANSPORT === "imessage" && message.platform !== "iMessage") continue;
    if (TRANSPORT === "terminal" && message.platform !== "terminal") continue;

    const rawSenderId = message.sender?.id;
    if (!rawSenderId) {
      console.warn("[glass-imessage] Ignoring inbound message without sender");
      continue;
    }
    const senderId =
      TRANSPORT === "terminal"
        ? (TERMINAL_FROM_PHONE || rawSenderId)
        : rawSenderId;
    const fromPhone = normalizePhone(senderId);
    activeSpacesByPhone.set(fromPhone, space);
    const chatSnapshot = await getChatSnapshot(app, space);
    console.log("[glass-imessage] Received inbound message", {
      fromPhone,
      chatGuid: chatSnapshot.chatGuid,
      isGroup: chatSnapshot.isGroup,
      platform: message.platform,
      contentType: message.content.type,
    });
    if (chatSnapshot.chatGuid) {
      activeSpacesByChatGuid.set(chatSnapshot.chatGuid, space);
    }
    const sourceMessageId = readStringField(message, [
      "id",
      "messageId",
      "guid",
      "externalId",
      "eventId",
    ]);
    const receivedAt = readTimestamp(message, [
      "timestamp",
      "createdAt",
      "sentAt",
      "receivedAt",
      "date",
    ]) ?? Date.now();

    // Ignore non-text/attachment messages
    if (message.content.type !== "text" && message.content.type !== "attachment") {
      continue;
    }

    // Extract text (may be empty if attachment-only)
    const messageText =
      message.content.type === "text"
        ? message.content.text
        : "";

    // Skip empty messages with no text
    if (!messageText && message.content.type !== "attachment") continue;

    // Process asynchronously so the typing indicator runs while we wait
    void (async () => {
      try {
        if (TRANSPORT === "terminal" && messageText.trim() === "/whoami") {
          await space.send(`Terminal messages are routed as ${fromPhone}`);
          return;
        }

        await space.responding(async () => {
          // Collect attachment if present
          const attachments: ImessageAttachment[] = [];
          if (message.content.type === "attachment") {
            const { mimeType, name } = message.content;
            const bytes = await message.content.read();
            attachments.push({
              data: Buffer.from(bytes).toString("base64"),
              mimeType,
              name: name ?? "attachment",
            });
          }

          const result = await sendToConvex(CONVEX_SITE_URL!, WORKER_SECRET, {
            fromPhone,
            messageText: messageText || "(attachment)",
            chatGuid: chatSnapshot.chatGuid,
            isGroup: chatSnapshot.isGroup,
            chatTitle: chatSnapshot.chatTitle,
            participantsUnavailable: chatSnapshot.participantsUnavailable,
            participants: [
              ...chatSnapshot.participants,
              ...(chatSnapshot.participants.some((p) => normalizePhone(p.address) === fromPhone)
                ? []
                : [{ address: fromPhone }]),
            ],
            sourceMessageId,
            receivedAt,
            attachments: attachments.length > 0 ? attachments : undefined,
          });

          // Send the text response
          if (result.response) {
            await sendReplyOrFallback(space, message, result.response);
          }

          await sendOutboundAppCards(space, result.appCards, message);

          // Send any file attachments (e.g. COI PDFs)
          await sendOutboundAttachments(space, result.attachments);

          if (result.leaveGroup && result.chatGuid && TRANSPORT === "imessage") {
            try {
              const client = getAdvancedImessageClient(app, space);
              await client?.groups?.leave(result.chatGuid);
              activeSpacesByChatGuid.delete(result.chatGuid);
            } catch (err) {
              console.warn(`[glass-imessage] Failed to leave group ${result.chatGuid}:`, err);
            }
          }
        });
      } catch (err) {
        console.error("[glass-imessage] Error processing message:", err);
        // Attempt to send a fallback message
        try {
          await space.send(imessageProcessingFallbackMessage(err));
        } catch {
          // Ignore secondary errors
        }
      }
    })();
  }
}

main().catch((err) => {
  console.error("[glass-imessage] Fatal error:", err);
  process.exit(1);
});
