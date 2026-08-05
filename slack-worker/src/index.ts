import http from "node:http";
import { Buffer } from "node:buffer";
import dayjs from "dayjs";
import { Spectrum, attachment, markdown, type ContentInput } from "spectrum-ts";
import { slack } from "@spectrum-ts/slack";
import { SendIdempotency, type SendResult } from "./idempotency.js";

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
type SlackInstallation = {
  teamId: string;
  botToken: string;
  botUserId?: string;
};
type ActorResolution = {
  teamId: string;
  userId: string;
  displayName?: string;
  isBot: boolean;
  botUserId?: string;
};

const REQUEST_TIMEOUT_MS = 20_000;
const mode = process.env.SLACK_WORKER_MODE === "mock" ? "mock" : "slack";
const glassEnv = process.env.GLASS_ENV ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? "local";
const workerSecret = process.env.SLACK_WORKER_SECRET?.trim() ?? "";
const projectId = process.env.PHOTON_PROJECT_ID?.trim();
const projectSecret = process.env.PHOTON_PROJECT_SECRET?.trim();
const clarityTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
const idempotency = new SendIdempotency();
const installationCache = new Map<
  string,
  { installation: SlackInstallation; expiresAt: number }
>();
const actorCache = new Map<
  string,
  { actor: ActorResolution; expiresAt: number }
>();
const mockFailedAttachments = new Set<string>();

if (!workerSecret) {
  console.error("SLACK_WORKER_SECRET is required");
  process.exit(1);
}
function livePhotonConfig() {
  if (!projectId || !projectSecret) {
    console.error("PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET are required in live mode");
    process.exit(1);
  }
  return { projectId, projectSecret };
}

const photonConfig = mode === "slack" ? livePhotonConfig() : null;
const spectrum =
  photonConfig
    ? await Spectrum({
        projectId: photonConfig.projectId,
        projectSecret: photonConfig.projectSecret,
        providers: [slack.config({})],
      })
    : null;
const slackClient = spectrum ? slack(spectrum) : null;

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

function sentMessageId(message: { id: string }) {
  const timestamp = (message as { ts?: unknown }).ts;
  return typeof timestamp === "string" ? timestamp : message.id;
}

async function sendContent(
  space: Awaited<ReturnType<NonNullable<typeof slackClient>["space"]["get"]>>,
  content: ContentInput,
  threadTs?: string,
) {
  if (!threadTs) return await space.send(content);
  const target = await space.getMessage(threadTs);
  if (!target) throw new Error("Slack thread root was not found");
  return await target.reply(content);
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
  if (!slackClient) throw new Error("Slack client is unavailable");
  const space = await slackClient.space.get(input.channelId, {
    teamId: input.teamId,
  });
  let messageId: string | undefined;
  if (input.text.trim()) {
    const sent = await sendContent(space, markdown(input.text), input.threadTs);
    if (sent) messageId = sentMessageId(sent);
  }
  const attachmentFailures: SendResult["attachmentFailures"] = [];
  for (const file of input.attachments ?? []) {
    try {
      const sent = await sendContent(
        space,
        attachment(new URL(file.url), {
          name: file.filename,
          mimeType: file.contentType,
        }),
        input.threadTs,
      );
      if (!messageId && sent) messageId = sentMessageId(sent);
    } catch (error) {
      attachmentFailures.push({
        filename: file.filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { messageId, attachmentFailures };
}

function photonAuthorization() {
  if (!photonConfig) throw new Error("Photon is unavailable in mock mode");
  return `Basic ${Buffer.from(`${photonConfig.projectId}:${photonConfig.projectSecret}`).toString("base64")}`;
}

async function slackInstallation(teamId: string) {
  if (!photonConfig) throw new Error("Photon is unavailable in mock mode");
  const cached = installationCache.get(teamId);
  if (cached && cached.expiresAt > dayjs().valueOf()) {
    return cached.installation;
  }
  const response = await fetch(
    `https://spectrum.photon.codes/projects/${encodeURIComponent(photonConfig.projectId)}/slack/installations`,
    {
      headers: { Authorization: photonAuthorization() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const payload = (await response.json()) as {
    data?: { installations?: SlackInstallation[] };
    message?: string;
  };
  if (!response.ok) throw new Error(payload.message ?? "Photon installation lookup failed");
  const installation = payload.data?.installations?.find(
    (candidate) => candidate.teamId === teamId,
  );
  if (!installation?.botToken) throw new Error("Slack installation was not found");
  installationCache.set(teamId, {
    installation,
    expiresAt: dayjs().add(5, "minute").valueOf(),
  });
  return installation;
}

async function botToken(teamId: string) {
  return (await slackInstallation(teamId)).botToken;
}

async function fetchSlackAttachment(input: AttachmentRequest) {
  if (mode === "mock") throw new Error("Mock mode has no remote Slack attachments");
  const token = await botToken(input.teamId);
  const infoResponse = await fetch(
    `https://slack.com/api/files.info?file=${encodeURIComponent(input.fileId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const info = (await infoResponse.json()) as {
    ok?: boolean;
    error?: string;
    file?: { url_private_download?: string; url_private?: string };
  };
  const url = info.file?.url_private_download ?? info.file?.url_private;
  if (!infoResponse.ok || !info.ok || !url) {
    throw new Error(info.error ?? "Slack file metadata is unavailable");
  }
  const fileResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!fileResponse.ok) throw new Error(`Slack file download failed (${fileResponse.status})`);
  return {
    bytes: Buffer.from(await fileResponse.arrayBuffer()),
    contentType: fileResponse.headers.get("content-type") ?? "application/octet-stream",
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
  const response = await fetch("https://slack.com/api/users.info", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${installation.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ user: input.userId }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    user?: {
      id?: string;
      team_id?: string;
      name?: string;
      real_name?: string;
      is_bot?: boolean;
      is_app_user?: boolean;
      profile?: { display_name?: string; real_name?: string; team?: string };
    };
  };
  const actor = payload.user;
  const teamId = actor?.team_id ?? actor?.profile?.team;
  if (!response.ok || !payload.ok || !actor?.id || !teamId) {
    throw new Error(payload.error ?? "Slack actor metadata is unavailable");
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

async function slackApi<T extends { ok?: boolean; error?: string }>(
  method: string,
  token: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`https://slack.com/api/${method}`, {
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
    throw new Error(payload.error ?? `${method} failed (${response.status})`);
  }
  return payload;
}

async function createConnectChannel(input: ConnectChannelRequest) {
  if (mode === "mock") {
    const name = channelName(input.clientSlug);
    return { channelId: `mock-${name}`, channelName: name, inviteId: "mock-invite" };
  }
  if (!clarityTeamId) throw new Error("SLACK_CLARITY_TEAM_ID is not configured");
  const token = await botToken(clarityTeamId);
  const name = channelName(input.clientSlug);
  const created = await slackApi<{
    ok: boolean;
    channel?: { id?: string; name?: string };
  }>("conversations.create", token, { name, is_private: true });
  const channelId = created.channel?.id;
  if (!channelId) throw new Error("Slack did not return the created channel ID");
  const invited = await slackApi<{ ok: boolean; invite_id?: string }>(
    "conversations.inviteShared",
    token,
    { channel: channelId, emails: [input.inviteEmail], external_limited: false },
  );
  return {
    channelId,
    channelName: created.channel?.name ?? name,
    inviteId: invited.invite_id,
  };
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, {
      ok: true,
      service: "glass-slack-worker",
      glassEnv,
      mode,
      workerSecretConfigured: Boolean(workerSecret),
      photonConfigured: Boolean(projectId && projectSecret),
      outboundEnabled: mode === "mock" || Boolean(slackClient),
      attachmentRetrievalEnabled: mode === "slack" && Boolean(projectId && projectSecret),
      actorResolutionEnabled: mode === "mock" || Boolean(projectId && projectSecret),
      connectProvisioningEnabled: mode === "mock" || Boolean(clarityTeamId),
    });
  }
  if (!authorized(request)) return json(response, 401, { error: "Unauthorized" });

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
      if (!input.inviteEmail?.trim()) throw new Error("inviteEmail is required");
      return json(response, 200, await createConnectChannel(input));
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
  await spectrum?.stop();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
