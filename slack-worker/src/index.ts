import http from "node:http";
import { Buffer } from "node:buffer";
import dayjs from "dayjs";
import { SendIdempotency, type SendResult } from "./idempotency.js";
import { toSlackMrkdwn } from "./mrkdwn.js";

type SendRequest = {
  clientMessageId: string;
  teamId: string;
  channelId: string;
  threadTs?: string;
  text: string;
  attachments?: Array<{ url: string; filename: string; contentType: string }>;
};

type AttachmentRequest = { teamId: string; fileId: string };
type ActorRequest = { teamId: string; userId: string };
type ConnectChannelRequest = { clientSlug: string; inviteEmail: string };
type ListChannelsRequest = {
  teamId: string;
  currentChannelId?: string;
  currentChannelName?: string;
};
type SlackChannel = { id: string; name: string };
type SlackInstallation = {
  teamId: string;
  botToken: string;
  botUserId?: string;
  expiresAt?: number;
};
type ActorResolution = {
  teamId: string;
  userId: string;
  displayName?: string;
  isBot: boolean;
  botUserId?: string;
};
type SlackResponse = { ok?: boolean; error?: string };
type SlackFile = {
  id?: string;
  shares?: Record<string, Record<string, Array<{ ts?: string }>>>;
};

const REQUEST_TIMEOUT_MS = 20_000;
const INSTALLATION_CACHE_MS = 5 * 60 * 1_000;
const mode = process.env.SLACK_WORKER_MODE === "mock" ? "mock" : "slack";
const glassEnv =
  process.env.GLASS_ENV ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? "local";
const workerSecret = process.env.SLACK_WORKER_SECRET?.trim() ?? "";
const convexSiteUrl = process.env.CONVEX_SITE_URL?.trim().replace(/\/$/, "");
const slackApiBaseUrl =
  process.env.SLACK_API_BASE_URL?.trim().replace(/\/$/, "") ??
  "https://slack.com/api";
const clarityTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
const idempotency = new SendIdempotency();
const installationCache = new Map<
  string,
  { installation: SlackInstallation; expiresAt: number }
>();
const installationInFlight = new Map<string, Promise<SlackInstallation>>();
const actorCache = new Map<
  string,
  { actor: ActorResolution; expiresAt: number }
>();
const mockFailedAttachments = new Set<string>();

if (!workerSecret) {
  console.error("SLACK_WORKER_SECRET is required");
  process.exit(1);
}
if (mode === "slack" && !convexSiteUrl) {
  console.error("CONVEX_SITE_URL is required in live mode");
  process.exit(1);
}

function authorized(request: http.IncomingMessage) {
  return request.headers.authorization === `Bearer ${workerSecret}`;
}

async function readJson<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function validateSend(input: SendRequest) {
  if (!input.clientMessageId || !input.teamId || !input.channelId) {
    throw new Error("clientMessageId, teamId, and channelId are required");
  }
  if (!input.text.trim() && !input.attachments?.length) {
    throw new Error("A message or attachment is required");
  }
}

async function fetchCustomerInstallation(
  teamId: string,
): Promise<SlackInstallation> {
  const response = await fetch(`${convexSiteUrl}/slack-worker/installation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ teamId }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json()) as Partial<SlackInstallation> & {
    error?: string;
  };
  if (!response.ok || !payload.botToken || payload.teamId !== teamId) {
    throw new Error(payload.error ?? "Slack installation lookup failed");
  }
  return {
    teamId,
    botToken: payload.botToken,
    botUserId: payload.botUserId,
    expiresAt: payload.expiresAt,
  };
}

async function slackInstallation(teamId: string): Promise<SlackInstallation> {
  if (mode === "mock") {
    return { teamId, botToken: "mock", botUserId: "U-GLASS" };
  }
  const cached = installationCache.get(teamId);
  if (cached && cached.expiresAt > dayjs().valueOf()) {
    return cached.installation;
  }
  const pending = installationInFlight.get(teamId);
  if (pending) return await pending;
  const request = fetchCustomerInstallation(teamId);
  installationInFlight.set(teamId, request);
  try {
    const installation = await request;
    const cacheUntil = Math.min(
      dayjs().add(INSTALLATION_CACHE_MS, "millisecond").valueOf(),
      installation.expiresAt
        ? dayjs(installation.expiresAt).subtract(1, "minute").valueOf()
        : Number.POSITIVE_INFINITY,
    );
    installationCache.set(teamId, { installation, expiresAt: cacheUntil });
    return installation;
  } finally {
    installationInFlight.delete(teamId);
  }
}

async function slackApi<T extends SlackResponse>(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${slackApiBaseUrl}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json()) as T;
  if (!response.ok || !payload.ok) {
    const retryAfter = response.headers.get("retry-after");
    throw new Error(
      `${payload.error ?? `${method} failed (${response.status})`}${retryAfter ? `; retry after ${retryAfter}s` : ""}`,
    );
  }
  return payload;
}

function slackFileMessageTs(file: SlackFile | undefined, channelId: string) {
  if (!file?.shares) return undefined;
  for (const scope of ["private", "public"]) {
    const messages = file.shares[scope]?.[channelId];
    const timestamp = messages?.find((message) => message.ts)?.ts;
    if (timestamp) return timestamp;
  }
  return undefined;
}

async function uploadSlackFile(args: {
  token: string;
  channelId: string;
  threadTs?: string;
  url: string;
  filename: string;
  contentType: string;
}) {
  const source = await fetch(args.url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!source.ok) {
    throw new Error(`Attachment download failed (${source.status})`);
  }
  const bytes = Buffer.from(await source.arrayBuffer());
  const upload = await slackApi<
    SlackResponse & { upload_url?: string; file_id?: string }
  >("files.getUploadURLExternal", args.token, {
    filename: args.filename,
    length: bytes.length,
  });
  if (!upload.upload_url || !upload.file_id) {
    throw new Error("Slack did not return an external file upload URL");
  }
  const uploaded = await fetch(upload.upload_url, {
    method: "POST",
    headers: {
      "Content-Type": args.contentType || "application/octet-stream",
      "Content-Length": String(bytes.length),
    },
    body: bytes,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!uploaded.ok) {
    throw new Error(`Slack file upload failed (${uploaded.status})`);
  }
  const completed = await slackApi<SlackResponse & { files?: SlackFile[] }>(
    "files.completeUploadExternal",
    args.token,
    {
      files: [{ id: upload.file_id, title: args.filename }],
      channel_id: args.channelId,
      ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
    },
  );
  if (args.threadTs) return args.threadTs;
  const completedFile = completed.files?.find(
    (file) => file.id === upload.file_id,
  );
  const completedTs = slackFileMessageTs(completedFile, args.channelId);
  if (completedTs) return completedTs;
  const info = await slackApi<SlackResponse & { file?: SlackFile }>(
    "files.info",
    args.token,
    { file: upload.file_id },
  );
  const messageTs = slackFileMessageTs(info.file, args.channelId);
  if (!messageTs) {
    throw new Error("Slack did not return the uploaded file message timestamp");
  }
  return messageTs;
}

async function sendSlack(input: SendRequest): Promise<SendResult> {
  validateSend(input);
  if (mode === "mock") {
    const attachmentFailures = (input.attachments ?? []).flatMap((file) => {
      const key = `${input.clientMessageId}:${file.filename}`;
      if (!file.url.includes("/fail-once") || mockFailedAttachments.has(key)) {
        return [];
      }
      mockFailedAttachments.add(key);
      return [{ filename: file.filename, error: "Mock attachment failure" }];
    });
    return {
      messageId:
        attachmentFailures.length === 0
          ? `mock-${input.clientMessageId}`
          : undefined,
      attachmentFailures,
    };
  }

  const installation = await slackInstallation(input.teamId);
  let messageId: string | undefined;
  if (input.text.trim()) {
    const sent = await slackApi<SlackResponse & { ts?: string }>(
      "chat.postMessage",
      installation.botToken,
      {
        channel: input.channelId,
        text: toSlackMrkdwn(input.text),
        mrkdwn: true,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      },
    );
    if (!sent.ts) throw new Error("Slack did not return a message timestamp");
    messageId = sent.ts;
  }

  const attachmentFailures: SendResult["attachmentFailures"] = [];
  for (const file of input.attachments ?? []) {
    try {
      const uploadedTs = await uploadSlackFile({
        token: installation.botToken,
        channelId: input.channelId,
        threadTs: input.threadTs,
        ...file,
      });
      messageId ??= uploadedTs;
    } catch (error) {
      attachmentFailures.push({
        filename: file.filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { messageId, attachmentFailures };
}

async function fetchSlackAttachment(input: AttachmentRequest) {
  if (mode === "mock") {
    throw new Error("Mock mode has no remote Slack attachments");
  }
  const token = (await slackInstallation(input.teamId)).botToken;
  const info = await slackApi<
    SlackResponse & {
      file?: { url_private_download?: string; url_private?: string };
    }
  >("files.info", token, { file: input.fileId });
  const url = info.file?.url_private_download ?? info.file?.url_private;
  if (!url) throw new Error("Slack file metadata is unavailable");
  const fileResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!fileResponse.ok) {
    throw new Error(`Slack file download failed (${fileResponse.status})`);
  }
  return {
    bytes: Buffer.from(await fileResponse.arrayBuffer()),
    contentType:
      fileResponse.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function resolveSlackActor(input: ActorRequest) {
  if (!input.teamId || !input.userId) {
    throw new Error("teamId and userId are required");
  }
  if (mode === "mock") {
    return {
      teamId: input.teamId,
      userId: input.userId,
      displayName: input.userId,
      isBot: false,
      botUserId: "U-GLASS",
    };
  }
  const cacheKey = `${input.teamId}:${input.userId}`;
  const cached = actorCache.get(cacheKey);
  if (cached && cached.expiresAt > dayjs().valueOf()) return cached.actor;
  const installation = await slackInstallation(input.teamId);
  const payload = await slackApi<
    SlackResponse & {
      user?: {
        id?: string;
        team_id?: string;
        name?: string;
        real_name?: string;
        is_bot?: boolean;
        is_app_user?: boolean;
        profile?: {
          display_name?: string;
          real_name?: string;
          team?: string;
        };
      };
    }
  >("users.info", installation.botToken, { user: input.userId });
  const actor = payload.user;
  const teamId = actor?.team_id ?? actor?.profile?.team;
  if (!actor?.id || !teamId) {
    throw new Error("Slack actor metadata is unavailable");
  }
  const resolved = {
    teamId,
    userId: actor.id,
    displayName:
      actor.profile?.display_name ||
      actor.profile?.real_name ||
      actor.real_name ||
      actor.name,
    isBot: actor.is_bot === true || actor.is_app_user === true,
    botUserId: installation.botUserId,
  };
  actorCache.set(cacheKey, {
    actor: resolved,
    expiresAt: dayjs().add(5, "minute").valueOf(),
  });
  return resolved;
}

function channelName(clientSlug: string) {
  const slug = clientSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  if (!slug) throw new Error("A valid client slug is required");
  return `glass-${slug}`;
}

async function createConnectChannel(input: ConnectChannelRequest) {
  if (mode === "mock") {
    const name = channelName(input.clientSlug);
    return {
      channelId: `mock-${name}`,
      channelName: name,
      inviteId: "mock-invite",
    };
  }
  if (!clarityTeamId) {
    throw new Error("Clarity Slack installation is not configured");
  }
  const installation = await slackInstallation(clarityTeamId);
  const name = channelName(input.clientSlug);
  const created = await slackApi<
    SlackResponse & { channel?: { id?: string; name?: string } }
  >("conversations.create", installation.botToken, { name, is_private: true });
  const channelId = created.channel?.id;
  if (!channelId)
    throw new Error("Slack did not return the created channel ID");
  const invited = await slackApi<SlackResponse & { invite_id?: string }>(
    "conversations.inviteShared",
    installation.botToken,
    {
      channel: channelId,
      emails: [input.inviteEmail],
      external_limited: false,
    },
  );
  return {
    channelId,
    channelName: created.channel?.name ?? name,
    inviteId: invited.invite_id,
  };
}

async function listSlackChannels(input: ListChannelsRequest) {
  if (!input.teamId?.trim()) throw new Error("teamId is required");
  if (mode === "mock") {
    const channels: SlackChannel[] = [
      ...(input.currentChannelId && input.currentChannelName
        ? [
            {
              id: input.currentChannelId,
              name: input.currentChannelName,
            },
          ]
        : []),
      { id: `mock-${input.teamId}-general`, name: "general" },
      { id: `mock-${input.teamId}-policies`, name: "policy-updates" },
    ];
    return {
      channels: channels.filter(
        (channel, index) =>
          channels.findIndex((candidate) => candidate.id === channel.id) ===
          index,
      ),
    };
  }

  const installation = await slackInstallation(input.teamId);
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const result = await slackApi<
      SlackResponse & {
        channels?: Array<{
          id?: string;
          name?: string;
          is_archived?: boolean;
          is_member?: boolean;
        }>;
        response_metadata?: { next_cursor?: string };
      }
    >("conversations.list", installation.botToken, {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const channel of result.channels ?? []) {
      if (
        channel.id &&
        channel.name &&
        !channel.is_archived &&
        channel.is_member
      ) {
        channels.push({ id: channel.id, name: channel.name });
      }
    }
    cursor = result.response_metadata?.next_cursor?.trim() || undefined;
  } while (cursor);

  return {
    channels: channels.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    const tokenBrokerConfigured =
      mode === "mock" || Boolean(convexSiteUrl && workerSecret);
    return json(response, 200, {
      ok: true,
      service: "glass-slack-worker",
      glassEnv,
      mode,
      workerSecretConfigured: Boolean(workerSecret),
      tokenBrokerConfigured,
      clarityTeamConfigured: mode === "mock" || Boolean(clarityTeamId),
      outboundEnabled: tokenBrokerConfigured,
      attachmentRetrievalEnabled: mode === "slack" && tokenBrokerConfigured,
      actorResolutionEnabled: mode === "mock" || tokenBrokerConfigured,
      connectProvisioningEnabled:
        mode === "mock" || Boolean(clarityTeamId && tokenBrokerConfigured),
    });
  }
  if (!authorized(request))
    return json(response, 401, { error: "Unauthorized" });

  try {
    if (request.method === "POST" && request.url === "/send") {
      const input = await readJson<SendRequest>(request);
      const claim = idempotency.claim(input.clientMessageId);
      if (!claim.claimed) {
        if (claim.result) return json(response, 200, claim.result);
        return json(response, 202, { sending: true });
      }
      try {
        const result = await sendSlack(input);
        if (result.attachmentFailures.length > 0) {
          idempotency.release(input.clientMessageId);
        } else {
          idempotency.complete(input.clientMessageId, result);
        }
        return json(response, 200, result);
      } catch (error) {
        idempotency.release(input.clientMessageId);
        throw error;
      }
    }
    if (request.method === "POST" && request.url === "/attachment") {
      const input = await readJson<AttachmentRequest>(request);
      const file = await fetchSlackAttachment(input);
      response.writeHead(200, { "Content-Type": file.contentType });
      response.end(file.bytes);
      return;
    }
    if (request.method === "POST" && request.url === "/actor") {
      return json(
        response,
        200,
        await resolveSlackActor(await readJson<ActorRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/connect-channel") {
      const input = await readJson<ConnectChannelRequest>(request);
      if (!input.inviteEmail?.trim())
        throw new Error("inviteEmail is required");
      return json(response, 200, await createConnectChannel(input));
    }
    if (request.method === "POST" && request.url === "/channels") {
      const result = await listSlackChannels(
        await readJson<ListChannelsRequest>(request),
      );
      return json(response, 200, result);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const port = Number(process.env.PORT ?? "3002");
server.listen(port, () => {
  console.log(`Glass Slack worker listening on ${port} (${mode})`);
});

async function shutdown() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
