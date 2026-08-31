"use node";

import {
  MODEL_TASKS,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./modelCatalog";

// Preserve Spot's original opaque routing key so production policy history,
// controls, ratings, affinity, and telemetry remain one continuous tenant.
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

export type ClRouterFailureAttempt = {
  attempt: number;
  provider: ModelProvider;
  model: string;
  outcome: "error" | "timeout";
  errorCode?: string;
};

export type ClRouterAssetReference = {
  url: string;
  mediaType: string;
  filename?: string;
  sizeBytes: number;
  sha256?: string;
};

export async function clRouterAssetReferenceFromUrl(options: {
  url: URL;
  mediaType: string;
  filename?: string;
  sizeBytes?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<ClRouterAssetReference> {
  if (options.url.protocol !== "https:") {
    throw new ClRouterRequestError(
      "configuration",
      "Referenced router assets require HTTPS URLs",
    );
  }
  let sizeBytes = options.sizeBytes;
  if (sizeBytes === undefined) {
    const response = await (options.fetch ?? globalThis.fetch)(options.url, {
      method: "HEAD",
      redirect: "manual",
    });
    if (!response.ok) {
      throw new ClRouterRequestError(
        "connection",
        `Unable to inspect referenced router asset (${response.status})`,
      );
    }
    sizeBytes = Number(response.headers.get("content-length"));
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new ClRouterRequestError(
      "configuration",
      "Referenced router assets require a positive content length",
    );
  }
  return {
    url: options.url.toString(),
    mediaType: options.mediaType,
    ...(options.filename ? { filename: options.filename } : {}),
    sizeBytes,
  };
}

export type ClRouterMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "image"; source: ClRouterAssetReference }
  | { type: "file"; data: string; mediaType: string; filename?: string }
  | { type: "file"; source: ClRouterAssetReference }
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
  executionBudgetMs?: number;
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
    error: {
      code: string;
      message: string;
      retryable: boolean;
      executionStarted?: boolean;
      requestId?: string;
      attempts?: ClRouterFailureAttempt[];
    };
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
  audio: ClRouterAssetReference;
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
  source?: "web" | "slack" | "imessage" | "operator_extraction" | "system";
  signals: {
    rating?: "up" | "down";
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

export const CL_ROUTER_FAILURE_CODES = [
  "router_unavailable",
  "router_candidates_exhausted",
  "router_budget_exhausted",
  "router_rejected",
  "router_internal",
] as const;

export type ClRouterFailureCode = typeof CL_ROUTER_FAILURE_CODES[number];

const CL_ROUTER_FAILURE_CODE_SET = new Set<string>(CL_ROUTER_FAILURE_CODES);

export class ClRouterRequestError extends Error {
  readonly kind: ClRouterErrorKind;
  readonly status?: number;
  readonly routerCode?: ClRouterFailureCode;
  readonly retryable?: boolean;
  readonly executionStarted?: boolean;
  readonly requestId?: string;
  readonly attempts: readonly ClRouterFailureAttempt[];

  constructor(kind: ClRouterErrorKind, message: string, options?: {
    status?: number;
    cause?: unknown;
    routerCode?: ClRouterFailureCode;
    retryable?: boolean;
    executionStarted?: boolean;
    requestId?: string;
    attempts?: readonly ClRouterFailureAttempt[];
  }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ClRouterRequestError";
    this.kind = kind;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.routerCode !== undefined) this.routerCode = options.routerCode;
    if (options?.retryable !== undefined) this.retryable = options.retryable;
    if (options?.executionStarted !== undefined) this.executionStarted = options.executionStarted;
    if (options?.requestId !== undefined) this.requestId = options.requestId;
    this.attempts = options?.attempts ?? [];
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

export function isClRouterConfigured(
  environment: ClRouterEnvironment = process.env,
): boolean {
  return Boolean(
    clean(environment.CL_ROUTER_URL) && clean(environment.CL_ROUTER_SECRET),
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
  if (taskKind === "query_reason" && isClRouterConfigured(environment)) {
    return true;
  }
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

export function isClRouterFailureCode(value: unknown): value is ClRouterFailureCode {
  return typeof value === "string" && CL_ROUTER_FAILURE_CODE_SET.has(value);
}

function readClRouterFailure(
  value: unknown,
): Pick<ClRouterRequestError, "routerCode" | "retryable" | "executionStarted" | "requestId" | "attempts"> & {
  message: string;
} | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const error = value.error;
  if (
    !isClRouterFailureCode(error.code) ||
    typeof error.message !== "string" ||
    typeof error.retryable !== "boolean" ||
    typeof error.executionStarted !== "boolean" ||
    (error.requestId !== undefined && typeof error.requestId !== "string")
  ) {
    return null;
  }
  return {
    routerCode: error.code,
    message: error.message,
    retryable: error.retryable,
    executionStarted: error.executionStarted,
    ...(typeof error.requestId === "string" ? { requestId: error.requestId } : {}),
    attempts: readFailureAttempts(error.attempts),
  };
}

async function responseFailure(response: Response): Promise<ClRouterRequestError> {
  let failure: ReturnType<typeof readClRouterFailure> = null;
  try {
    failure = readClRouterFailure(await response.json());
  } catch {
    // The status still determines the untyped transport error below.
  }
  if (failure) {
    const { message, ...metadata } = failure;
    return new ClRouterRequestError(
      response.status >= 500 ? "server" : "client",
      message,
      { status: response.status, ...metadata },
    );
  }
  return new ClRouterRequestError(
    response.status >= 500 ? "server" : "client",
    `cl-router returned HTTP ${response.status}`,
    { status: response.status },
  );
}

function isModelRoute(value: unknown): value is ModelRoute {
  return (
    isRecord(value) &&
    typeof value.provider === "string" && value.provider.length > 0 &&
    typeof value.model === "string" && value.model.length > 0
  );
}

function readFailureAttempts(value: unknown): ClRouterFailureAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ClRouterFailureAttempt[] => {
    if (!isRecord(item)) return [];
    const attempt = item.attempt;
    const outcome = item.outcome;
    const failureErrorCode = item.errorCode;
    if (
      !isModelRoute(item) ||
      !isNonNegativeInteger(attempt) ||
      attempt === 0 ||
      (outcome !== "error" && outcome !== "timeout") ||
      (failureErrorCode !== undefined && typeof failureErrorCode !== "string")
    ) {
      return [];
    }
    return [{
      attempt,
      provider: item.provider,
      model: item.model,
      outcome,
      ...(typeof failureErrorCode === "string"
        ? { errorCode: failureErrorCode }
        : {}),
    }];
  });
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
    if (!response.ok) throw await responseFailure(response);
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

function generateRequestPayload(
  request: ClRouterGenerateRequest,
  environment: ClRouterEnvironment,
): ReturnType<typeof requestPayload<ClRouterGenerateRequest>> {
  const timeoutMs = clRouterTimeoutMs(environment);
  return requestPayload({
    ...request,
    executionBudgetMs: request.executionBudgetMs ?? Math.max(100, timeoutMs - 1_000),
  });
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
        typeof payload.error.retryable !== "boolean" ||
        (payload.error.executionStarted !== undefined &&
          typeof payload.error.executionStarted !== "boolean") ||
        (payload.error.requestId !== undefined && typeof payload.error.requestId !== "string")
      ) {
        throw invalidStreamResponse("cl-router returned an invalid error stream event");
      }
      return {
        type: "error",
        error: {
          code: payload.error.code,
          message: payload.error.message,
          retryable: payload.error.retryable,
          ...(typeof payload.error.executionStarted === "boolean"
            ? { executionStarted: payload.error.executionStarted }
            : {}),
          ...(typeof payload.error.requestId === "string"
            ? { requestId: payload.error.requestId }
            : {}),
          attempts: readFailureAttempts(payload.error.attempts),
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
      body: JSON.stringify(generateRequestPayload(request, environment)),
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
    throw await responseFailure(response);
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

const PROVEN_PRE_EXECUTION_CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function nestedErrorCode(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isRecord(value)) return undefined;
  if (typeof value.code === "string") return value.code;
  return nestedErrorCode(value.cause, depth + 1);
}

function isProductionEnvironment(environment: ClRouterEnvironment): boolean {
  return clean(environment.SPOT_ENV)?.toLowerCase() === "production";
}

export function isClRouterDirectFallbackError(
  error: unknown,
  environment: ClRouterEnvironment = process.env,
): boolean {
  if (!isProductionEnvironment(environment) || !(error instanceof ClRouterRequestError)) {
    return false;
  }
  if (
    error.routerCode === "router_unavailable" &&
    error.executionStarted === false
  ) {
    return true;
  }
  return error.kind === "connection" &&
    PROVEN_PRE_EXECUTION_CONNECTION_CODES.has(nestedErrorCode(error.cause) ?? "");
}

export async function withClRouterDirectFallback<T>(options: {
  router: () => Promise<T>;
  direct: () => Promise<T>;
  onFallback?: (error: ClRouterRequestError) => void;
  environment?: ClRouterEnvironment;
}): Promise<T> {
  try {
    return await options.router();
  } catch (error) {
    if (!isClRouterDirectFallbackError(error, options.environment ?? process.env)) throw error;
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
    generateRequestPayload(request, options.environment ?? process.env),
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
  const payload = await postJson(
    "/v1/transcribe",
    requestPayload(request),
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
