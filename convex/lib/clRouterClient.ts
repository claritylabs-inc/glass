"use node";

import {
  MODEL_TASKS,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./modelCatalog";

const CL_ROUTER_TENANT_ID = "glass";
const DEFAULT_CL_ROUTER_TIMEOUT_MS = 180_000;
const MIN_CL_ROUTER_TIMEOUT_MS = 30_000;
const MAX_CL_ROUTER_TIMEOUT_MS = 900_000;

/** All model tasks implemented by the cl-router v1 API contract. */
export const CL_ROUTER_SUPPORTED_TASKS = MODEL_TASKS;

const SUPPORTED_TASK_SET = new Set<ModelTask>(CL_ROUTER_SUPPORTED_TASKS);

export type ClRouterEnvironment = Readonly<Record<string, string | undefined>>;

export type ClRouterSettingsSnapshot = {
  routes?: Record<string, ModelRoute>;
  routeSources?: Record<string, string>;
  providerKeys?: Partial<Record<ModelProvider, string>>;
};

export type ClRouterTraceMetadata = {
  traceId?: string;
  parentRequestId?: string;
  label?: string;
  phase?: string;
  channel?: string;
  [key: string]: unknown;
};

export type ClRouterUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens?: number;
};

export type ClRouterRoutingMetadata = {
  decision: string;
  candidatesConsidered: ModelRoute[];
  policyVersion: string | null;
  cacheStickinessApplied: boolean;
  routeSource?: string;
  attemptCount: number;
  shadowMode?: boolean;
  wouldHaveChosen?: ModelRoute & { decision: string };
  wouldHaveMatched?: boolean;
};

export type ClRouterResponseMetadata = {
  requestId: string;
  model: ModelRoute;
  routing: ClRouterRoutingMetadata;
  usage: ClRouterUsage;
  costUsd: number | null;
  costStatus: "priced" | "unpriced";
};

export type ClRouterMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "file"; data: string; mediaType: string; filename?: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: unknown };

export type ClRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ClRouterMessagePart[];
};

export type ClRouterGenerateRequest = {
  task: ModelTask;
  taskKind?: string;
  tenantId?: string;
  orgId?: string;
  settings?: ClRouterSettingsSnapshot | null;
  system?: string;
  messages?: ClRouterMessage[];
  prompt?: string;
  schema?: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  sessionKey?: string;
  tools?: ClRouterToolDefinition[];
  toolChoice?: ClRouterToolChoice;
  routing?: { pin?: ModelRoute; allowFallback?: boolean };
  trace?: ClRouterTraceMetadata;
};

export type ClRouterToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type ClRouterToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; toolName: string };

export type ClRouterGenerateResponse = ClRouterResponseMetadata & {
  output: unknown;
  finishReason?: string;
};

export type ClRouterStreamEvent =
  | { type: "text-delta"; id: string; delta: string }
  | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: unknown;
  }
  | ({ type: "done"; finishReason: string } & ClRouterResponseMetadata)
  | {
    type: "error";
    error: { code: string; message: string; retryable: boolean };
  };

export type ClRouterGenerateStreamResponse = {
  events: AsyncIterable<ClRouterStreamEvent>;
  headers: Headers;
};

export type ClRouterEmbedRequest = {
  tenantId?: string;
  orgId?: string;
  settings?: ClRouterSettingsSnapshot | null;
  texts: string[];
  dimensions?: number;
  trace?: ClRouterTraceMetadata;
};

export type ClRouterEmbedResponse = ClRouterResponseMetadata & {
  embeddings: number[][];
};

export type ClRouterTranscribeRequest = {
  tenantId?: string;
  orgId?: string;
  settings?: ClRouterSettingsSnapshot | null;
  data: Uint8Array;
  filename: string;
  mediaType: string;
  prompt?: string;
  trace?: ClRouterTraceMetadata;
};

export type ClRouterTranscribeResponse = ClRouterResponseMetadata & {
  text: string;
  durationSeconds?: number;
};

export type ClRouterFeedbackRequest = {
  requestId: string;
  tenantId?: string;
  idempotencyKey: string;
  signals: {
    reviewCorrectionCount?: number;
    reviewedFieldCount?: number;
    ungroundedStripCount?: number;
    sensitiveFieldCount?: number;
    escalationCount?: number;
    humanEditCount?: number;
    editedFieldCount?: number;
    qualityScore?: number;
  };
  trace?: ClRouterTraceMetadata;
};

export type ClRouterErrorKind =
  | "configuration"
  | "connection"
  | "timeout"
  | "aborted"
  | "server"
  | "client"
  | "invalid_response";

export class ClRouterRequestError extends Error {
  readonly kind: ClRouterErrorKind;
  readonly status?: number;

  constructor(kind: ClRouterErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ClRouterRequestError";
    this.kind = kind;
    if (options?.status !== undefined) this.status = options.status;
  }
}

export type ClRouterClientOptions = {
  environment?: ClRouterEnvironment;
  fetch?: typeof fetch;
  abortSignal?: AbortSignal;
};

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function configuredTasks(environment: ClRouterEnvironment): Set<string> {
  return new Set(
    (environment.CL_ROUTER_TASKS ?? "")
      .split(",")
      .map((task) => task.trim())
      .filter(Boolean),
  );
}

export function isClRouterTaskFlagged(
  task: ModelTask,
  environment: ClRouterEnvironment = process.env,
): boolean {
  const tasks = configuredTasks(environment);
  return tasks.has("*") || tasks.has(task);
}

export function shouldUseClRouterForTask(
  task: ModelTask,
  environment: ClRouterEnvironment = process.env,
): boolean {
  return SUPPORTED_TASK_SET.has(task) && isClRouterTaskFlagged(task, environment);
}

export function shouldUseClRouterForCall(
  task: ModelTask,
  taskKind?: string,
  environment: ClRouterEnvironment = process.env,
): boolean {
  if (!SUPPORTED_TASK_SET.has(task)) return false;
  const tasks = configuredTasks(environment);
  if (tasks.has("*") || tasks.has(task) || (taskKind && tasks.has(taskKind))) {
    return true;
  }
  return Boolean(
    taskKind?.startsWith("extraction_") && tasks.has("extraction"),
  );
}

function clRouterTimeoutMs(environment: ClRouterEnvironment): number {
  const parsed = Number.parseInt(
    environment.CL_ROUTER_TIMEOUT_MS ?? environment.MODEL_CALL_TIMEOUT_MS ?? "",
    10,
  );
  if (!Number.isFinite(parsed)) return DEFAULT_CL_ROUTER_TIMEOUT_MS;
  return Math.min(MAX_CL_ROUTER_TIMEOUT_MS, Math.max(MIN_CL_ROUTER_TIMEOUT_MS, parsed));
}

function clientConfig(environment: ClRouterEnvironment) {
  const rawUrl = clean(environment.CL_ROUTER_URL)?.replace(/\/+$/, "");
  const secret = clean(environment.CL_ROUTER_SECRET);
  if (!rawUrl || !secret) {
    throw new ClRouterRequestError(
      "configuration",
      "CL_ROUTER_URL and CL_ROUTER_SECRET are required when a router task is enabled",
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new ClRouterRequestError(
      "configuration",
      "CL_ROUTER_URL must be a valid HTTP or HTTPS URL",
      { cause: error },
    );
  }
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new ClRouterRequestError(
      "configuration",
      "CL_ROUTER_URL must use HTTPS unless it targets loopback localhost, 127.0.0.1, or ::1",
    );
  }
  return { url: url.toString().replace(/\/+$/, ""), secret, timeoutMs: clRouterTimeoutMs(environment) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModelRoute(value: unknown): value is ModelRoute {
  return (
    isRecord(value) &&
    typeof value.provider === "string" && value.provider.length > 0 &&
    typeof value.model === "string" && value.model.length > 0
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readUsage(value: unknown): ClRouterUsage | null {
  if (!isRecord(value)) return null;
  const inputTokens = value.inputTokens;
  const outputTokens = value.outputTokens;
  const cachedInputTokens = value.cachedInputTokens;
  const cacheWriteTokens = value.cacheWriteTokens ?? 0;
  if (
    !isNonNegativeInteger(inputTokens) ||
    !isNonNegativeInteger(outputTokens) ||
    !isNonNegativeInteger(cachedInputTokens) ||
    !isNonNegativeInteger(cacheWriteTokens) ||
    cachedInputTokens + cacheWriteTokens > inputTokens ||
    (value.reasoningTokens !== undefined && !isNonNegativeInteger(value.reasoningTokens))
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    ...(typeof value.reasoningTokens === "number"
      ? { reasoningTokens: value.reasoningTokens }
      : {}),
  };
}

function readRouting(value: unknown): ClRouterRoutingMetadata | null {
  if (!isRecord(value)) return null;
  const candidates = value.candidatesConsidered;
  if (
    typeof value.decision !== "string" ||
    !Array.isArray(candidates) ||
    !candidates.every(isModelRoute) ||
    !(typeof value.policyVersion === "string" || value.policyVersion === null) ||
    typeof value.cacheStickinessApplied !== "boolean" ||
    !isNonNegativeInteger(value.attemptCount) ||
    value.attemptCount < 1
  ) {
    return null;
  }
  const wouldHaveChosen = value.wouldHaveChosen;
  const wouldHaveChosenDecision = isRecord(wouldHaveChosen) &&
    typeof wouldHaveChosen.decision === "string"
    ? wouldHaveChosen.decision
    : undefined;
  if (
    (value.shadowMode !== undefined && typeof value.shadowMode !== "boolean") ||
    (value.wouldHaveMatched !== undefined && typeof value.wouldHaveMatched !== "boolean") ||
    (wouldHaveChosen !== undefined && (
      !isModelRoute(wouldHaveChosen) ||
      wouldHaveChosenDecision === undefined
    ))
  ) {
    return null;
  }
  return {
    decision: value.decision,
    candidatesConsidered: candidates,
    policyVersion: value.policyVersion,
    cacheStickinessApplied: value.cacheStickinessApplied,
    attemptCount: value.attemptCount,
    ...(typeof value.routeSource === "string" ? { routeSource: value.routeSource } : {}),
    ...(typeof value.shadowMode === "boolean" ? { shadowMode: value.shadowMode } : {}),
    ...(wouldHaveChosen !== undefined
      ? { wouldHaveChosen: {
          provider: wouldHaveChosen.provider,
          model: wouldHaveChosen.model,
          decision: wouldHaveChosenDecision!,
        } }
      : {}),
    ...(typeof value.wouldHaveMatched === "boolean"
      ? { wouldHaveMatched: value.wouldHaveMatched }
      : {}),
  };
}

function readResponseMetadata(value: Record<string, unknown>): ClRouterResponseMetadata | null {
  const usage = readUsage(value.usage);
  const routing = readRouting(value.routing);
  if (
    typeof value.requestId !== "string" || value.requestId.length === 0 ||
    !isModelRoute(value.model) ||
    !usage ||
    !routing ||
    !(
      value.costUsd === null ||
      (typeof value.costUsd === "number" && Number.isFinite(value.costUsd) && value.costUsd >= 0)
    ) ||
    (value.costStatus !== "priced" && value.costStatus !== "unpriced")
  ) {
    return null;
  }
  return {
    requestId: value.requestId,
    model: value.model,
    usage,
    routing,
    costUsd: value.costUsd,
    costStatus: value.costStatus,
  };
}

async function clRouterFetch(
  path: string,
  init: RequestInit,
  options: ClRouterClientOptions,
): Promise<unknown> {
  const environment = options.environment ?? process.env;
  const config = clientConfig(environment);
  const fetchImplementation = options.fetch ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (options.abortSignal?.aborted) controller.abort();
  else options.abortSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    let response: Response;
    try {
      response = await fetchImplementation(`${config.url}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.secret}`,
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new ClRouterRequestError(
        timedOut
          ? "timeout"
          : options.abortSignal?.aborted
            ? "aborted"
            : "connection",
        timedOut
          ? "cl-router request timed out"
          : options.abortSignal?.aborted
            ? "cl-router request aborted"
            : "cl-router connection failed",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ClRouterRequestError(
        response.status >= 500 ? "server" : "client",
        `cl-router returned HTTP ${response.status}`,
        { status: response.status },
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new ClRouterRequestError(
        "invalid_response",
        "cl-router returned invalid JSON",
        { cause: error },
      );
    }
  } finally {
    clearTimeout(timer);
    options.abortSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function postJson(
  path: string,
  body: unknown,
  options: ClRouterClientOptions,
): Promise<unknown> {
  return clRouterFetch(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}

function requestPayload<T extends {
  tenantId?: string;
  settings?: ClRouterSettingsSnapshot | null;
}>(request: T): Omit<T, "settings"> & {
  tenantId: string;
  settings?: ClRouterSettingsSnapshot;
} {
  const { settings, ...rest } = request;
  return {
    ...rest,
    tenantId: request.tenantId ?? CL_ROUTER_TENANT_ID,
    ...(settings ? { settings } : {}),
  };
}

function invalidStreamResponse(message: string, cause?: unknown): ClRouterRequestError {
  return new ClRouterRequestError(
    "invalid_response",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function parseStreamEventBlock(block: string): ClRouterStreamEvent | null {
  const lines = block.split(/\r?\n/);
  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (!eventName && dataLines.length === 0) return null;
  if (!eventName || dataLines.length === 0) {
    throw invalidStreamResponse("cl-router returned a malformed SSE event");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch (error) {
    throw invalidStreamResponse("cl-router returned invalid SSE JSON", error);
  }
  if (!isRecord(payload) || payload.type !== eventName) {
    throw invalidStreamResponse("cl-router SSE event name and payload do not match");
  }
  switch (payload.type) {
    case "text-delta":
      if (typeof payload.id !== "string" || typeof payload.delta !== "string") {
        throw invalidStreamResponse("cl-router returned an invalid text stream event");
      }
      return { type: "text-delta", id: payload.id, delta: payload.delta };
    case "tool-call":
      if (
        typeof payload.toolCallId !== "string" ||
        !payload.toolCallId ||
        typeof payload.toolName !== "string" ||
        !payload.toolName ||
        !("input" in payload)
      ) {
        throw invalidStreamResponse("cl-router returned an invalid tool-call stream event");
      }
      return {
        type: "tool-call",
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        input: payload.input,
      };
    case "done": {
      const metadata = readResponseMetadata(payload);
      if (!metadata || typeof payload.finishReason !== "string") {
        throw invalidStreamResponse("cl-router returned an invalid done stream event");
      }
      return { type: "done", finishReason: payload.finishReason, ...metadata };
    }
    case "error":
      if (
        !isRecord(payload.error) ||
        typeof payload.error.code !== "string" ||
        typeof payload.error.message !== "string" ||
        typeof payload.error.retryable !== "boolean"
      ) {
        throw invalidStreamResponse("cl-router returned an invalid error stream event");
      }
      return {
        type: "error",
        error: {
          code: payload.error.code,
          message: payload.error.message,
          retryable: payload.error.retryable,
        },
      };
    default:
      throw invalidStreamResponse("cl-router returned an unknown stream event");
  }
}

export async function clRouterGenerateStream(
  request: ClRouterGenerateRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateStreamResponse> {
  const environment = options.environment ?? process.env;
  const config = clientConfig(environment);
  const fetchImplementation = options.fetch ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (options.abortSignal?.aborted) controller.abort();
  else options.abortSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const cleanup = () => {
    clearTimeout(timer);
    options.abortSignal?.removeEventListener("abort", abortFromCaller);
  };

  let response: Response;
  try {
    response = await fetchImplementation(`${config.url}/v1/generate/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(requestPayload(request)),
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    throw new ClRouterRequestError(
      timedOut
        ? "timeout"
        : options.abortSignal?.aborted
          ? "aborted"
          : "connection",
      timedOut
        ? "cl-router request timed out"
        : options.abortSignal?.aborted
          ? "cl-router request aborted"
          : "cl-router connection failed",
      { cause: error },
    );
  }
  if (!response.ok) {
    cleanup();
    throw new ClRouterRequestError(
      response.status >= 500 ? "server" : "client",
      `cl-router returned HTTP ${response.status}`,
      { status: response.status },
    );
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    cleanup();
    throw invalidStreamResponse("cl-router returned a non-SSE stream response");
  }
  if (!response.body) {
    cleanup();
    throw invalidStreamResponse("cl-router returned an empty stream response");
  }

  const events = (async function* (): AsyncIterable<ClRouterStreamEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const delimiter = /\r?\n\r?\n/.exec(buffer);
          if (!delimiter || delimiter.index === undefined) break;
          const block = buffer.slice(0, delimiter.index);
          buffer = buffer.slice(delimiter.index + delimiter[0].length);
          const event = parseStreamEventBlock(block);
          if (event) yield event;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        const event = parseStreamEventBlock(buffer);
        if (event) yield event;
      }
    } catch (error) {
      if (error instanceof ClRouterRequestError) throw error;
      throw new ClRouterRequestError(
        timedOut
          ? "timeout"
          : options.abortSignal?.aborted
            ? "aborted"
            : "connection",
        timedOut
          ? "cl-router stream timed out"
          : options.abortSignal?.aborted
            ? "cl-router stream aborted"
            : "cl-router stream connection failed",
        { cause: error },
      );
    } finally {
      cleanup();
      reader.releaseLock();
    }
  })();

  return { events, headers: response.headers };
}

export function isClRouterDirectFallbackError(error: unknown): boolean {
  return (
    error instanceof ClRouterRequestError &&
    (error.kind === "connection" || error.kind === "timeout" || error.kind === "server")
  );
}

export async function withClRouterDirectFallback<T>(options: {
  router: () => Promise<T>;
  direct: () => Promise<T>;
  onFallback?: (error: ClRouterRequestError) => void;
}): Promise<T> {
  try {
    return await options.router();
  } catch (error) {
    if (!isClRouterDirectFallbackError(error)) throw error;
    options.onFallback?.(error as ClRouterRequestError);
    return options.direct();
  }
}

export async function clRouterGenerate(
  request: ClRouterGenerateRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateResponse> {
  const payload = await postJson(
    "/v1/generate",
    requestPayload(request),
    options,
  );
  if (!isRecord(payload)) {
    throw new ClRouterRequestError("invalid_response", "cl-router generate response is invalid");
  }
  const metadata = readResponseMetadata(payload);
  if (!metadata || !("output" in payload)) {
    throw new ClRouterRequestError("invalid_response", "cl-router generate response is invalid");
  }
  return {
    ...metadata,
    output: payload.output,
    ...(typeof payload.finishReason === "string"
      ? { finishReason: payload.finishReason }
      : {}),
  };
}

export async function clRouterEmbed(
  request: ClRouterEmbedRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterEmbedResponse> {
  const payload = await postJson(
    "/v1/embed",
    requestPayload(request),
    options,
  );
  if (!isRecord(payload)) {
    throw new ClRouterRequestError("invalid_response", "cl-router embed response is invalid");
  }
  const metadata = readResponseMetadata(payload);
  if (
    !metadata ||
    !Array.isArray(payload.embeddings) ||
    !payload.embeddings.every(
      (embedding) => Array.isArray(embedding) && embedding.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    )
  ) {
    throw new ClRouterRequestError("invalid_response", "cl-router embed response is invalid");
  }
  const embeddings = payload.embeddings as number[][];
  if (
    embeddings.length !== request.texts.length ||
    (request.dimensions !== undefined &&
      embeddings.some((embedding) => embedding.length !== request.dimensions))
  ) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router embed response dimensions do not match the request",
    );
  }
  return { ...metadata, embeddings };
}

export async function clRouterTranscribe(
  request: ClRouterTranscribeRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterTranscribeResponse> {
  const metadata = {
    tenantId: request.tenantId ?? CL_ROUTER_TENANT_ID,
    ...(request.orgId ? { orgId: request.orgId } : {}),
    ...(request.settings ? { settings: request.settings } : {}),
    ...(request.prompt ? { prompt: request.prompt } : {}),
    filename: request.filename,
    mediaType: request.mediaType,
    ...(request.trace ? { trace: request.trace } : {}),
  };
  const form = new FormData();
  form.append("request", JSON.stringify(metadata));
  const fileBytes = new Uint8Array(request.data.byteLength);
  fileBytes.set(request.data);
  form.append(
    "file",
    new Blob([fileBytes.buffer], { type: request.mediaType }),
    request.filename,
  );
  const payload = await clRouterFetch(
    "/v1/transcribe",
    { method: "POST", body: form },
    options,
  );
  if (!isRecord(payload)) {
    throw new ClRouterRequestError("invalid_response", "cl-router transcription response is invalid");
  }
  const responseMetadata = readResponseMetadata(payload);
  if (!responseMetadata || typeof payload.text !== "string") {
    throw new ClRouterRequestError("invalid_response", "cl-router transcription response is invalid");
  }
  return {
    ...responseMetadata,
    text: payload.text,
    ...(typeof payload.durationSeconds === "number"
      ? { durationSeconds: payload.durationSeconds }
      : {}),
  };
}

export async function sendClRouterFeedback(
  request: ClRouterFeedbackRequest,
  options: ClRouterClientOptions = {},
): Promise<{ accepted: true; duplicate: boolean }> {
  const payload = await postJson(
    "/v1/feedback",
    { ...request, tenantId: request.tenantId ?? CL_ROUTER_TENANT_ID },
    options,
  );
  if (
    !isRecord(payload) ||
    payload.accepted !== true ||
    typeof payload.duplicate !== "boolean"
  ) {
    throw new ClRouterRequestError("invalid_response", "cl-router feedback response is invalid");
  }
  return { accepted: true, duplicate: payload.duplicate };
}
