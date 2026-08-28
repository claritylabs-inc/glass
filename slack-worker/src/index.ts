import http from "node:http";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import dayjs from "dayjs";
import { SendIdempotency, type SendResult } from "./idempotency.js";

type SendRequest = {
  clientMessageId: string;
  teamId: string;
  channelId: string;
  threadTs?: string;
  mrkdwnText: string;
  blocks?: SlackBlock[];
  attachments?: Array<{ url: string; filename: string; contentType: string }>;
};
type SlackBlock = Record<string, unknown>;
type UpdateRequest = {
  teamId: string;
  channelId: string;
  messageTs: string;
  mrkdwnText: string;
  blocks?: SlackBlock[];
};
type StatusRequest = {
  teamId: string;
  channelId: string;
  threadTs: string;
  status: string;
};
type ReactionRequest = {
  teamId: string;
  channelId: string;
  messageTs: string;
  name: string;
};
type StreamStartRequest = {
  teamId: string;
  channelId: string;
  threadTs: string;
  recipientUserId: string;
  recipientTeamId: string;
  status?: string;
};
type StreamAppendRequest = {
  teamId: string;
  channelId: string;
  messageTs: string;
  markdownText?: string;
  tasks?: Array<{
    id: string;
    title: string;
    status: "pending" | "in_progress" | "complete" | "error";
  }>;
};
type StreamStopRequest = StreamAppendRequest & {
  blocks?: SlackBlock[];
};
type EphemeralRequest = {
  teamId: string;
  channelId: string;
  userId: string;
  threadTs?: string;
  text: string;
};
type OpenViewRequest = {
  teamId: string;
  triggerId: string;
  privateMetadata: string;
};

type AttachmentRequest = { teamId: string; fileId: string };
type ActorRequest = { teamId: string; userId: string };
type ConnectChannelRequest = {
  clientSlug: string;
  inviteEmail: string;
  operatorUserIds?: string[];
  existingChannelId?: string;
  existingChannelName?: string;
};
type ListChannelsRequest = {
  teamId: string;
  currentChannelId?: string;
  currentChannelName?: string;
};
type JoinChannelRequest = { teamId: string; channelId: string };
type LeaveChannelRequest = { teamId: string; channelId: string };
type ReconcileRequest = { teamId: string; channelIds?: string[] };
type SlackChannel = {
  id: string;
  name: string;
  isMember: boolean;
  isPrivate: boolean;
  isShared: boolean;
};
type SlackChannelPayload = {
  id?: string;
  name?: string;
  is_archived?: boolean;
  is_member?: boolean;
  is_private?: boolean;
  is_shared?: boolean;
  is_ext_shared?: boolean;
  is_org_shared?: boolean;
};
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
  email?: string;
  isBot: boolean;
  botUserId?: string;
};
type SlackResponse = {
  ok?: boolean;
  error?: string;
  not_in_channel?: boolean;
};
type SlackAuthTestResponse = SlackResponse & {
  team_id?: string;
  user_id?: string;
  bot_id?: string;
};
type SlackFile = {
  id?: string;
  shares?: Record<string, Record<string, Array<{ ts?: string }>>>;
};

const REQUEST_TIMEOUT_MS = 20_000;
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
const installationInFlight = new Map<string, Promise<SlackInstallation>>();
const actorCache = new Map<
  string,
  { actor: ActorResolution; expiresAt: number }
>();
const actorInFlight = new Map<string, Promise<ActorResolution>>();
const mockFailedAttachments = new Set<string>();
const mockJoinedChannelIds = new Set<string>();
const mockLeftChannelIds = new Set<string>();
const mockCurrentChannelsByTeam = new Map<string, SlackChannel>();

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
  if (
    !input.mrkdwnText.trim() &&
    !input.blocks?.length &&
    !input.attachments?.length
  ) {
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
    const code = !response.ok
      ? "installation_unavailable"
      : payload.teamId !== teamId
        ? "workspace_mismatch"
        : "installation_invalid";
    throw new SlackProviderError(
      payload.error ?? "Slack installation lookup failed",
      code,
      response.status >= 500,
    );
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
  const pending = installationInFlight.get(teamId);
  if (pending) return pending;
  const request = fetchCustomerInstallation(teamId);
  installationInFlight.set(teamId, request);
  try {
    return await request;
  } finally {
    installationInFlight.delete(teamId);
  }
}

const DEFINITIVE_SLACK_ERRORS = new Set([
  "account_inactive",
  "channel_not_found",
  "invalid_auth",
  "is_archived",
  "missing_scope",
  "not_allowed_token_type",
  "not_authed",
  "org_login_required",
  "not_in_channel",
  "token_expired",
  "token_revoked",
]);

class SlackProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SlackProviderError";
  }
}

async function readSlackApiResponse<T extends SlackResponse>(
  method: string,
  response: Response,
): Promise<T> {
  const payload = (await response.json()) as T;
  if (method === "conversations.leave" && payload.not_in_channel === true) {
    return payload;
  }
  if (!response.ok || !payload.ok) {
    const retryAfter = response.headers.get("retry-after");
    const code = payload.error ?? `http_${response.status}`;
    throw new SlackProviderError(
      `${code}${retryAfter ? `; retry after ${retryAfter}s` : ""}`,
      code,
      response.status >= 500 || !DEFINITIVE_SLACK_ERRORS.has(code),
    );
  }
  return payload;
}

async function reconcileSlack(input: ReconcileRequest) {
  if (!input.teamId?.trim()) throw new Error("teamId is required");
  const channelIds = Array.from(
    new Set((input.channelIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ).slice(0, 25);
  if (mode === "mock") {
    return {
      teamId: input.teamId,
      botUserId: "U-GLASS",
      channels: channelIds.map((id) => ({
        id,
        ok: true,
        name:
          mockCurrentChannelsByTeam.get(input.teamId)?.id === id
            ? mockCurrentChannelsByTeam.get(input.teamId)?.name
            : id.toLowerCase(),
        isArchived: false,
        isMember: !mockLeftChannelIds.has(id),
        isPrivate: true,
        isShared: true,
        isExtShared: true,
        isOrgShared: false,
      })),
    };
  }

  const installation = await slackInstallation(input.teamId);
  const authorization = await slackFormApi<SlackAuthTestResponse>(
    "auth.test",
    installation.botToken,
    {},
  );
  if (authorization.team_id && authorization.team_id !== input.teamId) {
    throw new SlackProviderError(
      "auth.test returned a different workspace",
      "workspace_mismatch",
      false,
    );
  }
  const channels = await Promise.all(
    channelIds.map(async (channelId) => {
      try {
        const result = await slackFormApi<
          SlackResponse & { channel?: SlackChannelPayload }
        >("conversations.info", installation.botToken, {
          channel: channelId,
          include_num_members: false,
        });
        const channel = result.channel;
        return {
          id: channelId,
          ok: true as const,
          name: channel?.name,
          isArchived: Boolean(channel?.is_archived),
          isMember: Boolean(channel?.is_member),
          isPrivate: Boolean(channel?.is_private),
          isShared: Boolean(channel?.is_shared),
          isExtShared: Boolean(channel?.is_ext_shared),
          isOrgShared: Boolean(channel?.is_org_shared),
        };
      } catch (error) {
        if (!(error instanceof SlackProviderError)) throw error;
        return {
          id: channelId,
          ok: false as const,
          errorCode: error.code,
          retryable: error.retryable,
        };
      }
    }),
  );
  return {
    teamId: input.teamId,
    botUserId: authorization.user_id ?? installation.botUserId,
    channels,
  };
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
  return await readSlackApiResponse<T>(method, response);
}

async function slackFormApi<T extends SlackResponse>(
  method: string,
  token: string,
  body: Record<string, string | number | boolean>,
): Promise<T> {
  const response = await fetch(`${slackApiBaseUrl}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(
      Object.entries(body).map(([key, value]) => [key, String(value)]),
    ),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return await readSlackApiResponse<T>(method, response);
}

function slackClientMessageId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20),
  ].join("-");
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
  const upload = await slackFormApi<
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
  // Completing the external upload is the provider's commit point. Slack can
  // populate file shares asynchronously, so a missing message timestamp here
  // must not turn a successful share into a retry that uploads the file again.
  try {
    const info = await slackFormApi<SlackResponse & { file?: SlackFile }>(
      "files.info",
      args.token,
      { file: upload.file_id },
    );
    return slackFileMessageTs(info.file, args.channelId);
  } catch (error) {
    console.warn("Slack file share metadata is not available yet", error);
    return undefined;
  }
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
  if (input.mrkdwnText.trim() || input.blocks?.length) {
    const sent = await slackApi<SlackResponse & { ts?: string }>(
      "chat.postMessage",
      installation.botToken,
      {
        channel: input.channelId,
        text: input.mrkdwnText,
        ...(input.blocks?.length ? { blocks: input.blocks } : {}),
        mrkdwn: true,
        unfurl_links: false,
        unfurl_media: false,
        client_msg_id: slackClientMessageId(input.clientMessageId),
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

function streamTaskChunks(tasks: StreamAppendRequest["tasks"]) {
  return (tasks ?? []).map((task) => ({
    type: "task_update",
    id: task.id,
    title: task.title.slice(0, 256),
    status: task.status,
  }));
}

async function updateSlackMessage(input: UpdateRequest) {
  if (mode === "mock") return { messageId: input.messageTs };
  const installation = await slackInstallation(input.teamId);
  const updated = await slackApi<SlackResponse & { ts?: string }>(
    "chat.update",
    installation.botToken,
    {
      channel: input.channelId,
      ts: input.messageTs,
      text: input.mrkdwnText,
      blocks: input.blocks ?? [],
    },
  );
  return { messageId: updated.ts ?? input.messageTs };
}

async function setSlackStatus(input: StatusRequest) {
  if (mode === "mock") return { ok: true };
  const installation = await slackInstallation(input.teamId);
  await slackApi<SlackResponse>(
    "assistant.threads.setStatus",
    installation.botToken,
    {
      channel_id: input.channelId,
      thread_ts: input.threadTs,
      status: input.status.slice(0, 100),
    },
  );
  return { ok: true };
}

async function addSlackReaction(input: ReactionRequest) {
  if (mode === "mock") return { ok: true };
  const installation = await slackInstallation(input.teamId);
  try {
    await slackApi<SlackResponse>("reactions.add", installation.botToken, {
      channel: input.channelId,
      timestamp: input.messageTs,
      name: input.name,
    });
  } catch (error) {
    if (
      !(error instanceof SlackProviderError) ||
      error.code !== "already_reacted"
    ) {
      throw error;
    }
  }
  return { ok: true };
}

async function removeSlackReaction(input: ReactionRequest) {
  if (mode === "mock") return { ok: true };
  const installation = await slackInstallation(input.teamId);
  try {
    await slackApi<SlackResponse>("reactions.remove", installation.botToken, {
      channel: input.channelId,
      timestamp: input.messageTs,
      name: input.name,
    });
  } catch (error) {
    if (
      !(error instanceof SlackProviderError) ||
      error.code !== "no_reaction"
    ) {
      throw error;
    }
  }
  return { ok: true };
}

async function startSlackStream(input: StreamStartRequest) {
  if (mode === "mock") return { messageId: `mock-stream-${input.threadTs}` };
  const installation = await slackInstallation(input.teamId);
  const started = await slackApi<SlackResponse & { ts?: string }>(
    "chat.startStream",
    installation.botToken,
    {
      channel: input.channelId,
      thread_ts: input.threadTs,
      recipient_user_id: input.recipientUserId,
      recipient_team_id: input.recipientTeamId,
      chunks: [
        {
          type: "task_update",
          id: "glass-review",
          title: (input.status ?? "Reviewing your request").slice(0, 256),
          status: "in_progress",
        },
      ],
      task_display_mode: "timeline",
    },
  );
  if (!started.ts)
    throw new Error("Slack did not return a streaming message timestamp");
  return { messageId: started.ts };
}

async function appendSlackStream(input: StreamAppendRequest) {
  const taskChunks = streamTaskChunks(input.tasks);
  if (!input.markdownText?.trim() && taskChunks.length === 0) {
    throw new Error("markdownText or tasks are required");
  }
  if (mode === "mock") return { messageId: input.messageTs };
  const installation = await slackInstallation(input.teamId);
  await slackApi<SlackResponse>("chat.appendStream", installation.botToken, {
    channel: input.channelId,
    ts: input.messageTs,
    ...(input.markdownText?.trim()
      ? { markdown_text: input.markdownText }
      : {}),
    ...(taskChunks.length ? { chunks: taskChunks } : {}),
  });
  return { messageId: input.messageTs };
}

async function stopSlackStream(input: StreamStopRequest) {
  if (mode === "mock") return { messageId: input.messageTs };
  const installation = await slackInstallation(input.teamId);
  const taskChunks = streamTaskChunks(input.tasks);
  if (
    !input.markdownText?.trim() &&
    !input.blocks?.length &&
    taskChunks.length === 0
  ) {
    throw new Error("markdownText, blocks, or tasks are required");
  }
  const stopped = await slackApi<SlackResponse & { ts?: string }>(
    "chat.stopStream",
    installation.botToken,
    {
      channel: input.channelId,
      ts: input.messageTs,
      ...(input.markdownText?.trim()
        ? { markdown_text: input.markdownText }
        : {}),
      ...(input.blocks?.length ? { blocks: input.blocks } : {}),
      ...(taskChunks.length ? { chunks: taskChunks } : {}),
    },
  );
  return { messageId: stopped.ts ?? input.messageTs };
}

async function postEphemeral(input: EphemeralRequest) {
  if (mode === "mock") return { messageId: `mock-ephemeral-${input.userId}` };
  const installation = await slackInstallation(input.teamId);
  const sent = await slackApi<SlackResponse & { message_ts?: string }>(
    "chat.postEphemeral",
    installation.botToken,
    {
      channel: input.channelId,
      user: input.userId,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    },
  );
  return { messageId: sent.message_ts };
}

async function openFeedbackView(input: OpenViewRequest) {
  if (mode === "mock") return { viewId: `mock-view-${input.triggerId}` };
  const installation = await slackInstallation(input.teamId);
  const opened = await slackApi<SlackResponse & { view?: { id?: string } }>(
    "views.open",
    installation.botToken,
    {
      trigger_id: input.triggerId,
      view: {
        type: "modal",
        callback_id: "glass_negative_feedback",
        private_metadata: input.privateMetadata,
        title: { type: "plain_text", text: "Help Glass improve" },
        submit: { type: "plain_text", text: "Send feedback" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "glass_feedback_comment_block",
            optional: true,
            label: { type: "plain_text", text: "What could be better?" },
            element: {
              type: "plain_text_input",
              action_id: "glass_feedback_comment",
              multiline: true,
              max_length: 2000,
              placeholder: {
                type: "plain_text",
                text: "Missing context, incorrect details, or anything else",
              },
            },
          },
        ],
      },
    },
  );
  return { viewId: opened.view?.id };
}

async function fetchSlackAttachment(input: AttachmentRequest) {
  if (mode === "mock") {
    throw new Error("Mock mode has no remote Slack attachments");
  }
  const token = (await slackInstallation(input.teamId)).botToken;
  const info = await slackFormApi<
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
  const pending = actorInFlight.get(cacheKey);
  if (pending) return await pending;
  const request = (async (): Promise<ActorResolution> => {
    const installation = await slackInstallation(input.teamId);
    const payload = await slackFormApi<
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
            email?: string;
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
      email: actor.profile?.email,
      isBot: actor.is_bot === true || actor.is_app_user === true,
      botUserId: installation.botUserId,
    };
    actorCache.set(cacheKey, {
      actor: resolved,
      expiresAt: dayjs().add(5, "minute").valueOf(),
    });
    return resolved;
  })();
  actorInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    actorInFlight.delete(cacheKey);
  }
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

async function listConversationMembers(token: string, channelId: string) {
  const memberIds = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await slackFormApi<
      SlackResponse & {
        members?: string[];
        response_metadata?: { next_cursor?: string };
      }
    >("conversations.members", token, {
      channel: channelId,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const memberId of result.members ?? []) memberIds.add(memberId);
    cursor = result.response_metadata?.next_cursor?.trim() || undefined;
  } while (cursor);
  return memberIds;
}

async function createConnectChannel(input: ConnectChannelRequest) {
  const operatorUserIds = Array.from(
    new Set(
      (input.operatorUserIds ?? [])
        .map((userId) => userId.trim())
        .filter(Boolean),
    ),
  ).slice(0, 250);
  if (mode === "mock") {
    const name = input.existingChannelName ?? channelName(input.clientSlug);
    return {
      channelId: input.existingChannelId ?? `mock-${name}`,
      channelName: name,
      inviteId: "mock-invite",
      reusedChannel: Boolean(input.existingChannelId),
      operatorInvites: {
        requested: operatorUserIds.length,
        succeeded: true,
      },
      supportInvite: { succeeded: true, pending: true },
    };
  }
  if (!clarityTeamId) {
    throw new Error("Clarity Slack installation is not configured");
  }
  const installation = await slackInstallation(clarityTeamId);
  const desiredName = channelName(input.clientSlug);
  let channelId = input.existingChannelId?.trim();
  let resolvedName = input.existingChannelName?.trim() || desiredName;
  let reusedChannel = Boolean(channelId);
  if (!channelId) {
    try {
      const created = await slackApi<
        SlackResponse & { channel?: { id?: string; name?: string } }
      >("conversations.create", installation.botToken, {
        name: desiredName,
        is_private: true,
      });
      channelId = created.channel?.id;
      resolvedName = created.channel?.name ?? desiredName;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("name_taken")
      ) {
        throw error;
      }
      const existing = (
        await listSlackChannels({ teamId: clarityTeamId })
      ).channels.find((channel) => channel.name === desiredName);
      if (!existing) throw error;
      channelId = existing.id;
      resolvedName = existing.name;
      reusedChannel = true;
    }
  }
  if (!channelId)
    throw new Error("Slack did not return the created channel ID");

  let operatorInviteError: string | undefined;
  if (operatorUserIds.length > 0) {
    try {
      const existingMembers = await listConversationMembers(
        installation.botToken,
        channelId,
      );
      const missingOperatorIds = operatorUserIds.filter(
        (userId) => !existingMembers.has(userId),
      );
      if (missingOperatorIds.length > 0) {
        await slackApi<SlackResponse>(
          "conversations.invite",
          installation.botToken,
          {
            channel: channelId,
            users: missingOperatorIds.join(","),
            force: true,
          },
        );
      }
    } catch (error) {
      operatorInviteError =
        error instanceof Error ? error.message : String(error);
    }
  }

  let inviteId: string | undefined;
  let supportInviteError: string | undefined;
  let supportInvitePending = false;
  try {
    const invited = await slackApi<SlackResponse & { invite_id?: string }>(
      "conversations.inviteShared",
      installation.botToken,
      {
        channel: channelId,
        emails: [input.inviteEmail],
        external_limited: false,
      },
    );
    inviteId = invited.invite_id;
    supportInvitePending = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("connection_limit_exceeded_pending")) {
      supportInvitePending = true;
    } else {
      supportInviteError = message;
    }
  }
  return {
    channelId,
    channelName: resolvedName,
    inviteId,
    reusedChannel,
    operatorInvites: {
      requested: operatorUserIds.length,
      succeeded: !operatorInviteError,
      error: operatorInviteError,
    },
    supportInvite: {
      succeeded: !supportInviteError,
      pending: supportInvitePending,
      error: supportInviteError,
    },
  };
}

function slackChannel(
  channel: SlackChannelPayload,
  isMember = channel.is_member === true,
): SlackChannel | undefined {
  if (!channel.id || !channel.name) return undefined;
  return {
    id: channel.id,
    name: channel.name,
    isMember,
    isPrivate: channel.is_private === true,
    isShared:
      channel.is_shared === true ||
      channel.is_ext_shared === true ||
      channel.is_org_shared === true,
  };
}

function mockSlackChannels(input: ListChannelsRequest) {
  if (input.currentChannelId && input.currentChannelName) {
    mockCurrentChannelsByTeam.set(input.teamId, {
      id: input.currentChannelId,
      name: input.currentChannelName,
      isMember: true,
      isPrivate: true,
      isShared: true,
    });
  }
  const currentChannel = mockCurrentChannelsByTeam.get(input.teamId);
  const channels: SlackChannel[] = [
    ...(currentChannel ? [currentChannel] : []),
    {
      id: `mock-${input.teamId}-general`,
      name: "general",
      isMember:
        mockJoinedChannelIds.has(`mock-${input.teamId}-general`) &&
        !mockLeftChannelIds.has(`mock-${input.teamId}-general`),
      isPrivate: false,
      isShared: false,
    },
    {
      id: `mock-${input.teamId}-policies`,
      name: "policy-updates",
      isMember: !mockLeftChannelIds.has(`mock-${input.teamId}-policies`),
      isPrivate: false,
      isShared: false,
    },
  ];
  return channels.filter(
    (channel, index) =>
      channels.findIndex((candidate) => candidate.id === channel.id) === index,
  );
}

async function listSlackChannels(input: ListChannelsRequest) {
  if (!input.teamId?.trim()) throw new Error("teamId is required");
  if (mode === "mock") {
    return { channels: mockSlackChannels(input) };
  }

  const installation = await slackInstallation(input.teamId);
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const result = await slackFormApi<
      SlackResponse & {
        channels?: SlackChannelPayload[];
        response_metadata?: { next_cursor?: string };
      }
    >("conversations.list", installation.botToken, {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const channel of result.channels ?? []) {
      const normalized = slackChannel(channel);
      if (!normalized || channel.is_archived) continue;
      if ((normalized.isPrivate || normalized.isShared) && !normalized.isMember)
        continue;
      channels.push(normalized);
    }
    cursor = result.response_metadata?.next_cursor?.trim() || undefined;
  } while (cursor);

  return {
    channels: channels.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function joinSlackChannel(input: JoinChannelRequest) {
  if (!input.teamId?.trim() || !input.channelId?.trim()) {
    throw new Error("teamId and channelId are required");
  }
  const available = await listSlackChannels({ teamId: input.teamId });
  const channel = available.channels.find(
    (candidate) => candidate.id === input.channelId,
  );
  if (!channel) throw new Error("Slack channel is not visible to Glass");
  if (channel.isPrivate || channel.isShared) {
    throw new Error("Only public workspace channels can be joined from Glass");
  }
  if (channel.isMember) return { channel };

  if (mode === "mock") {
    mockJoinedChannelIds.add(channel.id);
    mockLeftChannelIds.delete(channel.id);
    return { channel: { ...channel, isMember: true } };
  }

  const installation = await slackInstallation(input.teamId);
  const result = await slackApi<
    SlackResponse & { channel?: SlackChannelPayload }
  >("conversations.join", installation.botToken, {
    channel: input.channelId,
  });
  const joined = slackChannel(result.channel ?? {}, true);
  if (!joined) throw new Error("Slack did not return the joined channel");
  return { channel: joined };
}

async function leaveSlackChannel(input: LeaveChannelRequest) {
  if (!input.teamId?.trim() || !input.channelId?.trim()) {
    throw new Error("teamId and channelId are required");
  }
  const available = await listSlackChannels({ teamId: input.teamId });
  const channel = available.channels.find(
    (candidate) => candidate.id === input.channelId,
  );
  if (!channel) throw new Error("Slack channel is not visible to Glass");
  if (channel.isPrivate || channel.isShared) {
    throw new Error("Private and Slack Connect channels are managed in Slack");
  }
  if (!channel.isMember) return { channel };

  if (mode === "mock") {
    mockJoinedChannelIds.delete(channel.id);
    mockLeftChannelIds.add(channel.id);
    return { channel: { ...channel, isMember: false } };
  }

  const installation = await slackInstallation(input.teamId);
  await slackApi<SlackResponse>("conversations.leave", installation.botToken, {
    channel: input.channelId,
  });
  return { channel: { ...channel, isMember: false } };
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
      channelInventoryEnabled: mode === "mock" || tokenBrokerConfigured,
      publicChannelJoinEnabled: mode === "mock" || tokenBrokerConfigured,
      blockKitEnabled: tokenBrokerConfigured,
      messageUpdatesEnabled: tokenBrokerConfigured,
      reactionsEnabled: tokenBrokerConfigured,
      agentStatusEnabled: tokenBrokerConfigured,
      streamingEnabled: tokenBrokerConfigured,
      interactivityResponsesEnabled: tokenBrokerConfigured,
      feedbackModalsEnabled: tokenBrokerConfigured,
      reconciliationEnabled: tokenBrokerConfigured,
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
    if (request.method === "POST" && request.url === "/reconcile") {
      return json(
        response,
        200,
        await reconcileSlack(await readJson<ReconcileRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/message/update") {
      return json(
        response,
        200,
        await updateSlackMessage(await readJson<UpdateRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/thread/status") {
      return json(
        response,
        200,
        await setSlackStatus(await readJson<StatusRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/reaction/add") {
      return json(
        response,
        200,
        await addSlackReaction(await readJson<ReactionRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/reaction/remove") {
      return json(
        response,
        200,
        await removeSlackReaction(await readJson<ReactionRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/stream/start") {
      return json(
        response,
        200,
        await startSlackStream(await readJson<StreamStartRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/stream/append") {
      return json(
        response,
        200,
        await appendSlackStream(await readJson<StreamAppendRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/stream/stop") {
      return json(
        response,
        200,
        await stopSlackStream(await readJson<StreamStopRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/ephemeral") {
      return json(
        response,
        200,
        await postEphemeral(await readJson<EphemeralRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/view/open") {
      return json(
        response,
        200,
        await openFeedbackView(await readJson<OpenViewRequest>(request)),
      );
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
    if (request.method === "POST" && request.url === "/channels/join") {
      return json(
        response,
        200,
        await joinSlackChannel(await readJson<JoinChannelRequest>(request)),
      );
    }
    if (request.method === "POST" && request.url === "/channels/leave") {
      return json(
        response,
        200,
        await leaveSlackChannel(await readJson<LeaveChannelRequest>(request)),
      );
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    const providerError =
      error instanceof SlackProviderError ? error : undefined;
    return json(
      response,
      providerError ? (providerError.retryable ? 503 : 409) : 500,
      providerError
        ? {
            error: providerError.message,
            providerErrorCode: providerError.code,
            retryable: providerError.retryable,
          }
        : { error: error instanceof Error ? error.message : String(error) },
    );
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
