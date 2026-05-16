import { createHash, createHmac } from "crypto";
import dayjs from "dayjs";
import { Output, generateText as aiGenerateText } from "ai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
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

type WorkerState = {
  sourceKind: "upload" | "agent_email";
  fileId?: string;
  fileName?: string;
  orgId: string;
  userId: string;
  policyFileId?: string;
  clSdkCheckpointFileId?: string;
  externalWorker?: boolean;
};

type ClaimedJob = {
  policyId: string;
  leaseId: string;
  leaseExpiresAt: number;
  state: WorkerState;
  fileUrl: string;
  clSdkCheckpoint?: PipelineCheckpoint<ExtractionState>;
  docling?: {
    enabled: boolean;
  };
  modelSettings?: WorkerModelSettings;
};

type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "moonshot"
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

type DoclingMeta = {
  parserBackend: "docling";
  parserVersion?: string;
  parsedMarkdown: string;
  docTagsJson?: unknown;
  parsedAt: number;
  parsingMs?: number;
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
      doclingMeta?: DoclingMeta;
    },
    AckResult
  >("actions/policyExtraction.js:completeExternalExtract"),
  failExternalJob: makeFunctionReference<
    "action",
    { secret: string; policyId: string; leaseId: string; state?: WorkerState; error: string },
    AckResult
  >("actions/policyExtraction.js:failExternalJob"),
};

const CONVEX_URL = requiredEnv("CONVEX_URL");
const SECRET = requiredEnv("EXTRACTION_WORKER_SECRET");
const WORKER_ID = process.env.EXTRACTION_WORKER_ID ?? `extraction-worker-${process.pid}`;
const POLL_MS = readBoundedIntEnv("EXTRACTION_WORKER_POLL_MS", 5000, 500, 60_000);
const IDLE_LOG_MS = readBoundedIntEnv("EXTRACTION_WORKER_IDLE_LOG_MS", 60_000, 5_000, 10 * 60_000);
const HEARTBEAT_MS = readBoundedIntEnv("EXTRACTION_WORKER_HEARTBEAT_MS", 30_000, 5_000, 5 * 60_000);

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
    "moonshot",
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
    case "moonshot":
      return createMoonshotAI(apiKey ? { apiKey } : undefined)(route.model);
    case "deepseek":
      return createDeepSeek(apiKey ? { apiKey } : undefined)(route.model);
  }
}

function modelTaskForTaskKind(taskKind?: string): ModelTask {
  if (taskKind === "extraction_classify") return "classification";
  return "extraction";
}

function getModelForTaskKind(taskKind: string | undefined, settings?: WorkerModelSettings): LanguageModel {
  const task = modelTaskForTaskKind(taskKind);
  const configuredRoute = settings?.routes?.[task];
  const route =
    configuredRoute && isModelProvider(configuredRoute.provider)
      ? configuredRoute
      : DEFAULT_ROUTES[task];
  const apiKey = settings?.providerKeys?.[route.provider];
  return routeToModel(route, apiKey);
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

type WorkerDoclingConfig = {
  enabled: boolean;
  url?: string;
  secret?: string;
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

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function bytesCacheKey(bytes: Uint8Array): string {
  return `${bytes.byteLength}:${Buffer.from(bytes.subarray(0, 64)).toString("base64")}`;
}

function omitPdfProviderOptions(
  providerOptions?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!providerOptions) return undefined;
  const { pdfBase64: _pdfBase64, pdfBytes: _pdfBytes, pdfUrl: _pdfUrl, fileId: _fileId, ...rest } =
    providerOptions as ExtractionProviderOptions & { fileId?: string };
  return rest;
}

async function parseWithDocling(config: WorkerDoclingConfig, pdfBytes: Uint8Array, mimeType = "application/pdf") {
  if (!config.url || !config.secret) {
    throw new Error("Docling is enabled but DOCLING_URL or DOCLING_HMAC_SECRET is not configured on the extraction worker");
  }

  const body = Buffer.from(pdfBytes);
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const timestamp = Math.floor(dayjs().valueOf() / 1000).toString();
  const signature = createHmac("sha256", config.secret)
    .update(`${timestamp}.${bodyHash}`)
    .digest("hex");
  const endpoint = new URL("/v1/parse", config.url).toString();

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": mimeType,
          "X-Docling-Timestamp": timestamp,
          "X-Docling-Signature": signature,
        },
        body,
      });
      if (response.status >= 500 && attempt === 0) {
        lastError = new Error(`Docling parse failed with ${response.status}: ${await response.text()}`);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Docling parse failed with ${response.status}: ${await response.text()}`);
      }
      const json = await response.json() as {
        markdown?: unknown;
        docTagsJson?: unknown;
        parserVersion?: unknown;
        parsingMs?: unknown;
      };
      if (typeof json.markdown !== "string" || json.markdown.length === 0) {
        throw new Error("Docling parse response did not include markdown");
      }
      return {
        markdown: json.markdown,
        docTagsJson: json.docTagsJson,
        parserVersion: typeof json.parserVersion === "string" ? json.parserVersion : undefined,
        parsingMs: typeof json.parsingMs === "number" ? json.parsingMs : undefined,
      };
    } catch (error) {
      lastError = error;
      if (attempt > 0) break;
      if (error instanceof Error && !error.message.includes("fetch")) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function maybeApplyDocling(
  prompt: string,
  providerOptions: Record<string, unknown> | undefined,
  docling: WorkerDoclingConfig | undefined,
  cache: Map<string, Promise<DoclingMeta>>,
  onDoclingMeta?: (meta: DoclingMeta) => void,
): Promise<{ prompt: string; providerOptions?: Record<string, unknown> }> {
  if (!docling?.enabled) return { prompt, providerOptions };
  const options = providerOptions as ExtractionProviderOptions | undefined;
  const pdfBytes = options?.pdfBytes ?? (options?.pdfBase64 ? base64ToBytes(options.pdfBase64) : undefined);
  if (!pdfBytes) return { prompt, providerOptions };

  const cacheKey = bytesCacheKey(pdfBytes);
  let parsePromise = cache.get(cacheKey);
  if (!parsePromise) {
    parsePromise = parseWithDocling(docling, pdfBytes, options?.mimeType ?? "application/pdf")
      .then((parsed) => ({
        parserBackend: "docling" as const,
        parserVersion: parsed.parserVersion,
        parsedMarkdown: parsed.markdown,
        docTagsJson: parsed.docTagsJson,
        parsingMs: parsed.parsingMs,
        parsedAt: dayjs().valueOf(),
      }));
    cache.set(cacheKey, parsePromise);
  }
  const meta = await parsePromise;
  onDoclingMeta?.(meta);

  return {
    prompt: `${prompt}

Parsed PDF markdown from Docling:

${meta.parsedMarkdown}`,
    providerOptions: omitPdfProviderOptions(providerOptions),
  };
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

function buildWorkerExtractor(opts: {
  log: (message: string) => Promise<void>;
  onCheckpointSave: (checkpoint: PipelineCheckpoint<ExtractionState>) => Promise<void>;
  onDoclingMeta?: (meta: DoclingMeta) => void;
  docling?: WorkerDoclingConfig;
  modelSettings?: WorkerModelSettings;
}) {
  const doclingCache = new Map<string, Promise<DoclingMeta>>();
  const generateText: GenerateText = async (params) => {
    const taskKind = readTaskKind(params);
    const doclingInput = await maybeApplyDocling(
      params.prompt,
      params.providerOptions,
      opts.docling,
      doclingCache,
      opts.onDoclingMeta,
    );
    const result = await generateWithFallback({
      model: getModelForTaskKind(taskKind, opts.modelSettings),
      system: params.system,
      ...buildPromptInput(doclingInput.prompt, doclingInput.providerOptions),
      maxOutputTokens: getEffectiveMaxTokens(params.prompt, params.maxTokens),
      providerOptions: doclingInput.providerOptions as ProviderOptions | undefined,
    }, taskKind);
    return {
      text: result.text,
      usage: mapUsage(result.usage),
    };
  };

  const generateObject: GenerateObject = async (params) => {
    const taskKind = readTaskKind(params);
    const doclingInput = await maybeApplyDocling(
      params.prompt,
      params.providerOptions,
      opts.docling,
      doclingCache,
      opts.onDoclingMeta,
    );
    try {
      const result = await generateWithFallback({
        model: getModelForTaskKind(taskKind, opts.modelSettings),
        system: params.system,
        ...buildPromptInput(doclingInput.prompt, doclingInput.providerOptions),
        output: Output.object({ schema: params.schema }),
        maxOutputTokens: getEffectiveMaxTokens(params.prompt, params.maxTokens),
        providerOptions: doclingInput.providerOptions as ProviderOptions | undefined,
      }, taskKind);
      return {
        object: result.output!,
        usage: mapUsage(result.usage),
      };
    } catch (error) {
      const isSectionsExtractor = params.prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER);
      if (isSectionsExtractor && errorMessage(error).includes("No output generated")) {
        return { object: { sections: [] }, usage: undefined };
      }
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
  doclingMeta?: DoclingMeta,
): Promise<void> {
  const resultSourceSpans = Array.isArray((result as unknown as { sourceSpans?: unknown[] }).sourceSpans)
    ? (result as unknown as { sourceSpans: Array<Record<string, unknown>> }).sourceSpans
    : [];
  const resultSourceChunks = Array.isArray((result as unknown as { sourceChunks?: unknown[] }).sourceChunks)
    ? (result as unknown as { sourceChunks: Array<Record<string, unknown>> }).sourceChunks
    : [];

  const sourceSpans = resultSourceSpans.length > 0
    ? resultSourceSpans
    : fallbackSource.sourceSpans as unknown as Array<Record<string, unknown>>;
  const sourceChunks = resultSourceChunks.length > 0
    ? resultSourceChunks
    : fallbackSource.sourceChunks as unknown as Array<Record<string, unknown>>;

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
    doclingMeta,
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
    const fallbackSource = await buildPdfSourceSpans({
      pdfBytes,
      documentId: job.policyId,
      sourceKind: "policy_pdf",
    });
    if (fallbackSource.sourceSpans.length > 0) {
      await logJob(job, `Prepared ${fallbackSource.sourceSpans.length} raw source spans for source-grounded extraction`);
    }

    let doclingMeta: DoclingMeta | undefined;
    const extractor = buildWorkerExtractor({
      log: async (message) => logJob(job, message),
      onCheckpointSave: async (checkpoint) => {
        await saveCheckpoint(job, checkpoint);
      },
      onDoclingMeta: (meta) => {
        doclingMeta = meta;
      },
      docling: {
        enabled: job.docling?.enabled === true,
        url: process.env.DOCLING_URL,
        secret: process.env.DOCLING_HMAC_SECRET,
      },
      modelSettings: job.modelSettings,
    });

    if (job.clSdkCheckpoint) {
      await logJob(job, `Resuming extraction from cl-sdk phase "${job.clSdkCheckpoint.phase}"`);
    }

    const result = await extractor.extract(
      pdfBytes,
      job.policyId,
      {
        ...(job.clSdkCheckpoint ? { resumeFrom: job.clSdkCheckpoint } : {}),
        ...(fallbackSource.sourceSpans.length > 0
          ? { sourceSpans: fallbackSource.sourceSpans as unknown as Array<Record<string, unknown>> }
          : {}),
      },
    );

    await completeJob(job, result, fallbackSource, doclingMeta);
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
  let lastIdleLogAt = 0;
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
  console.log("Extraction worker shutting down");
}

main().catch((error) => {
  console.error("Extraction worker crashed:", error);
  process.exitCode = 1;
});
