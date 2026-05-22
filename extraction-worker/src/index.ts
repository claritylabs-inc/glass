import dayjs from "dayjs";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Output, generateText as aiGenerateText } from "ai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import { createOpenAI } from "@ai-sdk/openai";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  createExtractor,
  type GenerateObject,
  type GenerateText,
  type ExtractionResult,
  type ExtractionState,
  type ModelCapabilities,
  type PipelineCheckpoint,
} from "@claritylabs/cl-sdk";
import { EXTRACTION_MODEL_CAPABILITIES } from "./modelCapabilities.js";
import { buildPdfSourceSpans } from "./pdfSourceSpans.js";
import { convertPdfWithDocling } from "./docling.js";

type WorkerState = {
  sourceKind: "upload" | "agent_email";
  fileId?: string;
  fileName?: string;
  orgId: string;
  userId: string;
  policyFileId?: string;
  clSdkCheckpointFileId?: string;
  traceId?: string;
  externalWorker?: boolean;
};

type ClaimedJob = {
  policyId: string;
  leaseId: string;
  leaseExpiresAt: number;
  state: WorkerState;
  fileUrl: string;
  clSdkCheckpoint?: PipelineCheckpoint<ExtractionState>;
  modelSettings?: WorkerModelSettings;
};

type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "deepseek";

type ModelTask = "extraction" | "classification";

type WorkerModelRoute = {
  provider: ModelProvider;
  model: string;
};

type WorkerModelSettings = {
  routes?: Partial<Record<ModelTask | string, WorkerModelRoute>>;
  providerKeys?: Partial<Record<ModelProvider | string, string>>;
};

type AckResult = {
  ok: boolean;
  leaseExpiresAt?: number;
  checkpointFileId?: string;
};

const actions = {
  claimExternalJob: makeFunctionReference<
    "action",
    { secret: string; workerId?: string },
    ClaimedJob | null
  >("actions/policyExtraction.js:claimExternalJob"),
  heartbeatExternalJob: makeFunctionReference<
    "action",
    { secret: string; policyId: string; leaseId: string },
    AckResult
  >("actions/policyExtraction.js:heartbeatExternalJob"),
  logExternalJob: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      message: string;
      phase?: string;
      level?: "info" | "warn" | "error";
    },
    AckResult
  >("actions/policyExtraction.js:logExternalJob"),
  saveExternalCheckpoint: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      state: WorkerState;
      checkpoint: PipelineCheckpoint<ExtractionState>;
    },
    AckResult
  >("actions/policyExtraction.js:saveExternalCheckpoint"),
  completeExternalExtract: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      state: WorkerState;
      document: unknown;
      chunks: unknown[];
      sourceSpans: Array<Record<string, unknown>>;
      sourceChunks: Array<Record<string, unknown>>;
      tokenUsage?: unknown;
      performanceReport?: unknown;
      checkpoint?: PipelineCheckpoint<ExtractionState>;
    },
    AckResult
  >("actions/policyExtraction.js:completeExternalExtract"),
  failExternalJob: makeFunctionReference<
    "action",
    { secret: string; policyId: string; leaseId: string; state?: WorkerState; error: string },
    AckResult
  >("actions/policyExtraction.js:failExternalJob"),
  recordExternalTraceEvent: makeFunctionReference<
    "action",
    {
      secret: string;
      traceId?: string;
      kind: "model_call" | "worker" | "phase" | "embedding_batch" | "artifact";
      phase?: string;
      label?: string;
      task?: string;
      taskKind?: string;
      provider?: string;
      model?: string;
      routeSource?: string;
      transport?: string;
      attempt?: number;
      status?: string;
      durationMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      error?: string;
      details?: unknown;
    },
    AckResult
  >("actions/policyExtraction.js:recordExternalTraceEvent"),
};

const CONVEX_URL = requiredEnv("CONVEX_URL");
const SECRET = requiredEnv("EXTRACTION_WORKER_SECRET");
const WORKER_ID = process.env.EXTRACTION_WORKER_ID ?? `extraction-worker-${process.pid}`;
const POLL_MS = readBoundedIntEnv("EXTRACTION_WORKER_POLL_MS", 5000, 500, 60_000);
const IDLE_LOG_MS = readBoundedIntEnv("EXTRACTION_WORKER_IDLE_LOG_MS", 60_000, 5_000, 10 * 60_000);
const HEARTBEAT_MS = readBoundedIntEnv("EXTRACTION_WORKER_HEARTBEAT_MS", 30_000, 5_000, 5 * 60_000);
const HTTP_PORT = readOptionalIntEnv("PORT") ?? readOptionalIntEnv("DOCLING_HTTP_PORT");
const HTTP_MAX_BODY_BYTES = readBoundedIntEnv("DOCLING_HTTP_MAX_BODY_BYTES", 50 * 1024 * 1024, 1024, 250 * 1024 * 1024);
const DOCLING_MAX_PAGES = readOptionalIntEnv("DOCLING_MAX_PAGES");
const DOCLING_MAX_FILE_SIZE = readOptionalIntEnv("DOCLING_MAX_FILE_SIZE_BYTES");

const convex = new ConvexHttpClient(CONVEX_URL);

let shuttingDown = false;
process.on("SIGTERM", () => {
  shuttingDown = true;
});
process.on("SIGINT", () => {
  shuttingDown = true;
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function readOptionalIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs(): number {
  return dayjs().valueOf();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapUsage(usage?: { inputTokens?: number; outputTokens?: number }) {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
}

function readTaskKind(params: { taskKind?: unknown }): string | undefined {
  return typeof params.taskKind === "string" ? params.taskKind : undefined;
}

const DEFAULT_ROUTES: Record<ModelTask, WorkerModelRoute> = {
  classification: { provider: "openai", model: "gpt-5.4-nano" },
  extraction: { provider: "openai", model: "gpt-5.4-nano" },
};

function isModelProvider(value: string): value is ModelProvider {
  return [
    "openai",
    "anthropic",
    "google",
    "xai",
    "mistral",
    "cohere",
    "deepseek",
  ].includes(value);
}

function routeToModel(route: WorkerModelRoute, apiKey?: string): LanguageModel {
  switch (route.provider) {
    case "openai":
      return createOpenAI(apiKey ? { apiKey } : undefined)(route.model);
    case "anthropic":
      return createAnthropic(apiKey ? { apiKey } : undefined)(route.model);
    case "google":
      return createGoogleGenerativeAI(apiKey ? { apiKey } : undefined)(route.model);
    case "xai":
      return createXai(apiKey ? { apiKey } : undefined)(route.model);
    case "mistral":
      return createMistral(apiKey ? { apiKey } : undefined)(route.model);
    case "cohere":
      return createCohere(apiKey ? { apiKey } : undefined)(route.model);
    case "deepseek":
      return createDeepSeek(apiKey ? { apiKey } : undefined)(route.model);
  }
}

function modelTaskForTaskKind(taskKind?: string): ModelTask {
  if (taskKind === "extraction_classify") return "classification";
  return "extraction";
}

function getModelForTaskKind(taskKind: string | undefined, settings?: WorkerModelSettings): {
  model: LanguageModel;
  route: WorkerModelRoute;
  routeSource: string;
  transport: "direct";
} {
  const task = modelTaskForTaskKind(taskKind);
  const configuredRoute = settings?.routes?.[task];
  const route =
    configuredRoute && isModelProvider(configuredRoute.provider)
      ? configuredRoute
      : DEFAULT_ROUTES[task];
  const apiKey = settings?.providerKeys?.[route.provider];
  return {
    model: routeToModel(route, apiKey),
    route,
    routeSource: configuredRoute ? "configured" : "default",
    transport: "direct",
  };
}

function getFallbackModel(taskKind?: string): LanguageModel | null {
  if (
    taskKind === "extraction_review" ||
    taskKind === "extraction_referential_lookup"
  ) {
    return routeToModel({ provider: "openai", model: "gpt-5.4-mini" });
  }
  return null;
}

const EXTRACTION_MAX_TOKEN_OVERRIDES: Record<string, number> = {
  coveredReasons: 24576,
  exclusions: 8192,
};

const SECTIONS_EXTRACTOR_PROMPT_MARKER =
  "Extract ALL sections, clauses, endorsements, and schedules from this document";

const POLICY_PERIOD_EXTRACTION_GUIDANCE = `

Critical policy period rule:
- Treat "Effective Date", "Effective Date / Time", "Policy Effective Date", "From", "Start Date", and close variants as the policy period start.
- Treat "Expiration Date", "Expiry Date", "Expiration Date / Time", "Policy Expiration Date", "To", "End Date", and close variants as the policy period end.
- When these labels appear inside a POLICY PERIOD / POLICY TERM / PERIOD OF INSURANCE table, populate top-level effectiveDate and expirationDate from them even if the table does not literally repeat "policy period" on each row.
- Do not leave effectiveDate or expirationDate unknown when declaration-page policy-period rows are visible.`;

function addPolicyPeriodGuidance(prompt: string): string {
  if (!prompt.includes("effectiveDate") && !prompt.includes("expirationDate")) {
    return prompt;
  }
  if (prompt.includes("Critical policy period rule:")) return prompt;
  return `${prompt}${POLICY_PERIOD_EXTRACTION_GUIDANCE}`;
}

function getEffectiveMaxTokens(prompt: string, maxTokens: number): number {
  if (prompt.includes("Extract ALL covered reasons from this document")) {
    return Math.max(maxTokens, EXTRACTION_MAX_TOKEN_OVERRIDES.coveredReasons);
  }
  if (prompt.includes("Extract ALL exclusions from this document")) {
    return Math.max(maxTokens, EXTRACTION_MAX_TOKEN_OVERRIDES.exclusions);
  }
  return maxTokens;
}

type ExtractionImage = {
  imageBase64: string;
  mimeType: string;
};

type ExtractionProviderOptions = Record<string, unknown> & {
  pdfBase64?: string;
  pdfUrl?: URL | string;
  pdfBytes?: Uint8Array;
  mimeType?: string;
  images?: ExtractionImage[];
};

function buildPdfFilePart(opts: {
  pdfUrl?: URL | string;
  pdfBytes?: Uint8Array;
  pdfBase64?: string;
  mimeType?: string;
}) {
  const mediaType = opts.mimeType ?? "application/pdf";
  const filename = "document.pdf";
  if (opts.pdfUrl) {
    const url = opts.pdfUrl instanceof URL ? opts.pdfUrl : new URL(opts.pdfUrl);
    return { type: "file" as const, data: url, mediaType, filename };
  }
  if (opts.pdfBytes) {
    return { type: "file" as const, data: opts.pdfBytes, mediaType, filename };
  }
  if (opts.pdfBase64) {
    return { type: "file" as const, data: opts.pdfBase64, mediaType, filename };
  }
  return null;
}

function extractEmbeddedPdf(prompt: string): { text: string; pdfBase64: string } | null {
  const match = prompt.match(/^([\s\S]+?\n)(JVBER[A-Za-z0-9+/=\s]{200,})$/);
  if (!match) return null;
  return {
    text: match[1].trim(),
    pdfBase64: match[2].replace(/\s/g, ""),
  };
}

function buildPromptInput(prompt: string, providerOptions?: Record<string, unknown>) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  if (options?.images?.length) {
    return {
      messages: [
        {
          role: "user" as const,
          content: [
            ...options.images.map((img) => ({
              type: "image" as const,
              image: img.imageBase64,
              mediaType: img.mimeType,
            })),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    };
  }

  const pdfPart = buildPdfFilePart({
    pdfUrl: options?.pdfUrl,
    pdfBytes: options?.pdfBytes,
    pdfBase64: options?.pdfBase64,
    mimeType: options?.mimeType,
  });

  if (pdfPart) {
    return {
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: prompt }, pdfPart],
        },
      ],
    };
  }

  const embedded = extractEmbeddedPdf(prompt);
  if (embedded) {
    return {
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: embedded.text },
            {
              type: "file" as const,
              data: embedded.pdfBase64,
              mediaType: "application/pdf",
              filename: "document.pdf",
            },
          ],
        },
      ],
    };
  }

  return { prompt };
}


async function generateWithFallback(
  options: Parameters<typeof aiGenerateText>[0],
  taskKind?: string,
) {
  try {
    return await aiGenerateText(options);
  } catch (error) {
    const fallback = getFallbackModel(taskKind);
    if (!fallback || /api key is missing/i.test(errorMessage(error))) throw error;
    return await aiGenerateText({
      ...options,
      model: fallback,
    });
  }
}

async function recordTraceEvent(job: Pick<ClaimedJob, "state">, event: {
  kind: "model_call" | "worker" | "phase" | "embedding_batch" | "artifact";
  phase?: string;
  label?: string;
  task?: string;
  taskKind?: string;
  provider?: string;
  model?: string;
  routeSource?: string;
  transport?: string;
  attempt?: number;
  status?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  details?: unknown;
}) {
  if (!job.state.traceId) return;
  try {
    await convex.action(actions.recordExternalTraceEvent, {
      secret: SECRET,
      traceId: job.state.traceId,
      ...event,
    });
  } catch {
    // Extraction telemetry should never fail the worker.
  }
}

function buildWorkerExtractor(opts: {
  job: ClaimedJob;
  log: (message: string) => Promise<void>;
  onCheckpointSave: (checkpoint: PipelineCheckpoint<ExtractionState>) => Promise<void>;
  modelSettings?: WorkerModelSettings;
}) {
  const generateText: GenerateText = async (params) => {
    const taskKind = readTaskKind(params);
    const guidedPrompt = addPolicyPeriodGuidance(params.prompt);
    const route = getModelForTaskKind(taskKind, opts.modelSettings);
    const startedAt = nowMs();
    try {
      const result = await generateWithFallback({
        model: route.model,
        system: params.system,
        ...buildPromptInput(guidedPrompt, params.providerOptions),
        maxOutputTokens: getEffectiveMaxTokens(guidedPrompt, params.maxTokens),
        providerOptions: params.providerOptions as ProviderOptions | undefined,
      }, taskKind);
      const usage = mapUsage(result.usage);
      await recordTraceEvent(opts.job, {
        kind: "model_call",
        label: "external generateText",
        task: modelTaskForTaskKind(taskKind),
        taskKind,
        provider: route.route.provider,
        model: route.route.model,
        routeSource: route.routeSource,
        transport: route.transport,
        attempt: 1,
        status: "complete",
        durationMs: nowMs() - startedAt,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      return {
        text: result.text,
        usage,
      };
    } catch (error) {
      await recordTraceEvent(opts.job, {
        kind: "model_call",
        label: "external generateText",
        task: modelTaskForTaskKind(taskKind),
        taskKind,
        provider: route.route.provider,
        model: route.route.model,
        routeSource: route.routeSource,
        transport: route.transport,
        attempt: 1,
        status: "error",
        durationMs: nowMs() - startedAt,
        error: errorMessage(error),
      });
      throw error;
    }
  };

  const generateObject: GenerateObject = async (params) => {
    const taskKind = readTaskKind(params);
    const guidedPrompt = addPolicyPeriodGuidance(params.prompt);
    const route = getModelForTaskKind(taskKind, opts.modelSettings);
    const startedAt = nowMs();
    try {
      const result = await generateWithFallback({
        model: route.model,
        system: params.system,
        ...buildPromptInput(guidedPrompt, params.providerOptions),
        output: Output.object({ schema: params.schema }),
        maxOutputTokens: getEffectiveMaxTokens(guidedPrompt, params.maxTokens),
        providerOptions: params.providerOptions as ProviderOptions | undefined,
      }, taskKind);
      const usage = mapUsage(result.usage);
      await recordTraceEvent(opts.job, {
        kind: "model_call",
        label: "external generateObject",
        task: modelTaskForTaskKind(taskKind),
        taskKind,
        provider: route.route.provider,
        model: route.route.model,
        routeSource: route.routeSource,
        transport: route.transport,
        attempt: 1,
        status: "complete",
        durationMs: nowMs() - startedAt,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      return {
        object: result.output!,
        usage,
      };
    } catch (error) {
      const isSectionsExtractor = guidedPrompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER);
      if (isSectionsExtractor && errorMessage(error).includes("No output generated")) {
        await recordTraceEvent(opts.job, {
          kind: "model_call",
          label: "external generateObject",
          task: modelTaskForTaskKind(taskKind),
          taskKind,
          provider: route.route.provider,
          model: route.route.model,
          routeSource: route.routeSource,
          transport: route.transport,
          attempt: 1,
          status: "error",
          durationMs: nowMs() - startedAt,
          error: errorMessage(error),
        });
        return { object: { sections: [] }, usage: undefined };
      }
      await recordTraceEvent(opts.job, {
        kind: "model_call",
        label: "external generateObject",
        task: modelTaskForTaskKind(taskKind),
        taskKind,
        provider: route.route.provider,
        model: route.route.model,
        routeSource: route.routeSource,
        transport: route.transport,
        attempt: 1,
        status: "error",
        durationMs: nowMs() - startedAt,
        error: errorMessage(error),
      });
      throw error;
    }
  };

  const concurrency = readBoundedIntEnv("EXTRACTION_CONCURRENCY", 6, 1, 8);
  return createExtractor({
    generateText,
    generateObject,
    concurrency,
    pageMapConcurrency: readBoundedIntEnv("EXTRACTION_PAGE_MAP_CONCURRENCY", concurrency, 1, 8),
    extractorConcurrency: readBoundedIntEnv("EXTRACTION_EXTRACTOR_CONCURRENCY", concurrency, 1, 8),
    formatConcurrency: readBoundedIntEnv("EXTRACTION_FORMAT_CONCURRENCY", concurrency, 1, 8),
    maxReviewRounds: readBoundedIntEnv("EXTRACTION_MAX_REVIEW_ROUNDS", 1, 0, 2),
    reviewMode: readReviewModeEnv("EXTRACTION_REVIEW_MODE", "auto"),
    log: opts.log,
    onProgress: opts.log,
    onCheckpointSave: opts.onCheckpointSave,
    modelCapabilities: EXTRACTION_MODEL_CAPABILITIES as ModelCapabilities,
  });
}

function readReviewModeEnv(name: string, fallback: "always" | "auto" | "skip"): "always" | "auto" | "skip" {
  const raw = process.env[name];
  if (raw === "always" || raw === "auto" || raw === "skip") return raw;
  return fallback;
}

async function logJob(
  job: Pick<ClaimedJob, "policyId">,
  message: string,
  level: "info" | "warn" | "error" = "info",
): Promise<void> {
  await convex.action(actions.logExternalJob, {
    secret: SECRET,
    policyId: job.policyId,
    message,
    phase: "worker",
    level,
  });
}

async function fetchPdfBytes(fileUrl: string): Promise<Uint8Array> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch source PDF: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > HTTP_MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (header === `Bearer ${SECRET}`) return true;
  return req.headers["x-extraction-worker-secret"] === SECRET;
}

async function handleConvertRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAuthorized(req)) {
    jsonResponse(res, 401, { error: "Unauthorized" });
    return;
  }
  const body = await readJsonBody(req);
  const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
  if (!pdfBase64) {
    jsonResponse(res, 400, { error: "Missing pdfBase64" });
    return;
  }

  const pdfBytes = Buffer.from(pdfBase64, "base64");
  const converted = await convertPdfWithDocling(pdfBytes, {
    maxPages: DOCLING_MAX_PAGES,
    maxFileSize: DOCLING_MAX_FILE_SIZE,
  });
  jsonResponse(res, 200, {
    ok: true,
    document: converted.document,
    metadata: converted.metadata,
  });
}

function startHttpServer(): { close: () => void } | null {
  if (!HTTP_PORT) return null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      jsonResponse(res, 200, { ok: true, workerId: WORKER_ID });
      return;
    }
    if (req.method === "POST" && url.pathname === "/docling/convert") {
      handleConvertRequest(req, res).catch((error) => {
        console.error("Docling HTTP conversion failed:", error);
        jsonResponse(res, 500, { error: errorMessage(error) });
      });
      return;
    }
    jsonResponse(res, 404, { error: "Not found" });
  });
  server.listen(HTTP_PORT, () => {
    console.log(`Docling conversion endpoint listening on port ${HTTP_PORT}`);
  });
  return {
    close: () => server.close(),
  };
}

async function heartbeat(job: ClaimedJob): Promise<void> {
  const result = await convex.action(actions.heartbeatExternalJob, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
  });
  if (!result.ok) {
    throw new Error(`Lost external extraction lease for ${job.policyId}`);
  }
}

async function saveCheckpoint(
  job: ClaimedJob,
  checkpoint: PipelineCheckpoint<ExtractionState>,
): Promise<void> {
  const result = await convex.action(actions.saveExternalCheckpoint, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
    state: job.state,
    checkpoint,
  });
  if (!result.ok) {
    throw new Error(`Failed to persist checkpoint for ${job.policyId}`);
  }
  job.state = {
    ...job.state,
    clSdkCheckpointFileId: result.checkpointFileId,
    externalWorker: true,
  };
}

async function completeJob(
  job: ClaimedJob,
  result: ExtractionResult,
  fallbackSource: Awaited<ReturnType<typeof buildPdfSourceSpans>>,
): Promise<void> {
  const resultSourceSpans = Array.isArray((result as unknown as { sourceSpans?: unknown[] }).sourceSpans)
    ? (result as unknown as { sourceSpans: Array<Record<string, unknown>> }).sourceSpans
    : [];
  const resultSourceChunks = Array.isArray((result as unknown as { sourceChunks?: unknown[] }).sourceChunks)
    ? (result as unknown as { sourceChunks: Array<Record<string, unknown>> }).sourceChunks
    : [];

  const rawSourceSpans = fallbackSource.sourceSpans as unknown as Array<Record<string, unknown>>;
  const rawSourceChunks = fallbackSource.sourceChunks as unknown as Array<Record<string, unknown>>;
  const sourceSpans = resultSourceSpans.length > 0
    ? [...resultSourceSpans, ...rawSourceSpans]
    : rawSourceSpans;
  const sourceChunks = resultSourceChunks.length > 0
    ? [...resultSourceChunks, ...rawSourceChunks]
    : rawSourceChunks;

  const completed = await convex.action(actions.completeExternalExtract, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
    state: job.state,
    document: result.document,
    chunks: result.chunks,
    sourceSpans,
    sourceChunks,
    tokenUsage: result.tokenUsage,
    performanceReport: result.performanceReport,
    checkpoint: result.checkpoint,
  });
  if (!completed.ok) {
    throw new Error(`Convex rejected completion for ${job.policyId}`);
  }
}

async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  await convex.action(actions.failExternalJob, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
    state: job.state,
    error: errorMessage(error),
  });
}

async function processJob(job: ClaimedJob): Promise<void> {
  console.log(`[${job.policyId}] claimed external extraction job`);
  await logJob(job, `External worker ${WORKER_ID} started extraction`);
  const heartbeatTimer = setInterval(() => {
    heartbeat(job).catch((error) => {
      console.error(`[${job.policyId}] heartbeat failed:`, error);
    });
  }, HEARTBEAT_MS);

  try {
    const pdfBytes = await fetchPdfBytes(job.fileUrl);
    await logJob(job, `External worker fetched PDF (${pdfBytes.byteLength} bytes)`);

    const extractor = buildWorkerExtractor({
      job,
      log: async (message) => logJob(job, message),
      onCheckpointSave: async (checkpoint) => {
        await saveCheckpoint(job, checkpoint);
      },
      modelSettings: job.modelSettings,
    });

    if (job.clSdkCheckpoint) {
      await logJob(job, `Resuming extraction from cl-sdk phase "${job.clSdkCheckpoint.phase}"`);
    }

    const fallbackSource = await buildPdfSourceSpans({
      pdfBytes,
      documentId: job.policyId,
      sourceKind: "policy_pdf",
    });
    if (fallbackSource.sourceSpans.length > 0) {
      await logJob(job, `Prepared ${fallbackSource.sourceSpans.length} raw source spans for source-grounded extraction`);
    }

    let result: ExtractionResult;
    const extractStartedAt = nowMs();
    await recordTraceEvent(job, {
      kind: "phase",
      phase: "external_extract",
      label: "external_extract",
      status: "started",
    });
    try {
      const converted = await convertPdfWithDocling(pdfBytes, {
        maxPages: DOCLING_MAX_PAGES,
        maxFileSize: DOCLING_MAX_FILE_SIZE,
      });
      await logJob(
        job,
        `Docling preprocessor parsed PDF in ${converted.metadata.parsingMs ?? 0}ms; running cl-sdk on DoclingDocument`,
      );
      result = await extractor.extract(
        {
          kind: "docling_document",
          document: converted.document,
          sourceKind: "policy_pdf",
        },
        job.policyId,
        {
          ...(job.clSdkCheckpoint ? { resumeFrom: job.clSdkCheckpoint } : {}),
        },
      );
    } catch (error) {
      await logJob(
        job,
        `Docling preprocessor unavailable; falling back to PDF extraction (${errorMessage(error)})`,
        "warn",
      );
      result = await extractor.extract(
        pdfBytes,
        job.policyId,
        {
          ...(job.clSdkCheckpoint ? { resumeFrom: job.clSdkCheckpoint } : {}),
          ...(fallbackSource.sourceSpans.length > 0
            ? { sourceSpans: fallbackSource.sourceSpans as unknown as Array<Record<string, unknown>> }
            : {}),
        },
      );
    }
    await recordTraceEvent(job, {
      kind: "phase",
      phase: "external_extract",
      label: "external_extract",
      status: "complete",
      durationMs: nowMs() - extractStartedAt,
    });

    await completeJob(job, result, fallbackSource);
    console.log(`[${job.policyId}] completed external extraction`);
  } catch (error) {
    console.error(`[${job.policyId}] extraction failed:`, error);
    await failJob(job, error);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function claimJob(): Promise<ClaimedJob | null> {
  return await convex.action(actions.claimExternalJob, {
    secret: SECRET,
    workerId: WORKER_ID,
  });
}

async function main(): Promise<void> {
  console.log(`Glass extraction worker ${WORKER_ID} connected to ${CONVEX_URL}`);
  const httpServer = startHttpServer();
  let lastIdleLogAt = 0;
  try {
    while (!shuttingDown) {
      const job = await claimJob();
      if (job) {
        await processJob(job);
        continue;
      }

      const now = nowMs();
      if (now - lastIdleLogAt >= IDLE_LOG_MS) {
        console.log("No extraction jobs available");
        lastIdleLogAt = now;
      }
      await sleep(POLL_MS);
    }
  } finally {
    httpServer?.close();
  }
  console.log("Extraction worker shutting down");
}

main().catch((error) => {
  console.error("Extraction worker crashed:", error);
  process.exitCode = 1;
});
