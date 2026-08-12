import dayjs from "dayjs";
import { createRequire } from "module";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Output, generateText as aiGenerateText, jsonSchema } from "ai";
import type { LanguageModel } from "ai";
import { zodSchema, type ProviderOptions } from "@ai-sdk/provider-utils";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  ACORD_LOB_CODES,
  createExtractor,
  resolveAcordCoverageCode,
  stableHash,
  toLobCodes,
  type GenerateObject,
  type ExtractOptions,
  type ExtractionResult,
  type ExtractionSectionResult,
  type ExtractionSectionStore,
  type ModelCapabilities,
  type ModelTaskKind,
} from "@claritylabs/cl-sdk";
import {
  DIRECT_MODEL_PROVIDERS,
  MODEL_ROUTING,
  SPECIAL_MODEL_ROUTES,
  directProviderModelForRoute,
  fallbackRouteForCall,
  modelSupportsImageInput,
  primaryRouteForCall,
  type DirectModelProvider,
} from "@claritylabs/cl-router-policy";
import { modelCapabilitiesForRoute } from "./modelCapabilities.js";
import {
  normalizeJsonSchemaForFireworks,
  structuredOutputSchemaForProvider,
} from "./fireworksStructuredOutput.js";
import {
  buildPdfSourceSpans,
  buildPdfTextSupplements,
  orderSourceSpansForPreview,
  type WorkerSourceChunk,
  type WorkerSourceSpan,
} from "./pdfSourceSpans.js";
import {
  convertPdfWithLiteParse,
  LITEPARSE_MAX_QUEUED_DOCUMENTS,
  LITEPARSE_NATIVE_CONCURRENCY,
  type PageScreenshot,
} from "./liteparse.js";
import { resolveConvexStorageUrl } from "./convexStorageUrl.js";
import {
  ClRouterProtocolError,
  createClRouterClient,
  isClRouterTaskEnabled,
  parseClRouterTaskFlags,
  shouldFallBackFromClRouter,
  type ClRouterGenerateResponse,
  type ClRouterProviderAssets,
} from "./clRouterClient.js";
import { applyCarrierIdentityGuidance } from "./extractionPromptGuidance.js";
import { watchClientDisconnect } from "./httpRequestCancellation.js";
import { createPdfWorkAdmission } from "./pdfWorkAdmission.js";
import { resolveWorkerRuntimeAccess } from "./railwayRuntime.js";
import { preparePdfSourceWithLiteParseFallback } from "./pdfSourceFallback.js";

type WorkerState = {
  sourceKind: "upload" | "agent_email";
  fileId?: string;
  fileName?: string;
  orgId: string;
  userId: string;
  policyFileId?: string;
  traceId?: string;
  externalWorker?: boolean;
  coverageRecovery?: { enabled: boolean; forcedByOperator?: boolean };
};

type ClaimedJob = {
  policyId: string;
  leaseId: string;
  leaseExpiresAt: number;
  state: WorkerState;
  fileUrl: string;
  modelSettings?: WorkerModelSettings;
};

type ClaimedPreviewJob = ClaimedJob;

type ModelProvider = DirectModelProvider;

type ModelTask =
  | "extraction"
  | "extraction_preview"
  | "extraction_coverage_recovery"
  | "classification";

type WorkerModelRoute = {
  provider: ModelProvider;
  model: string;
};

type WorkerRouteSource = "broker" | "global" | "static" | "configured" | "default" | "fallback";

type WorkerModelSettings = {
  routes?: Partial<Record<ModelTask | string, WorkerModelRoute>>;
  routeSources?: Partial<Record<ModelTask | string, WorkerRouteSource | string>>;
  providerKeys?: Partial<Record<ModelProvider | string, string>>;
};

type ResolvedWorkerModelRoute = {
  task: ModelTask;
  model: LanguageModel;
  route: WorkerModelRoute;
  routeSource: WorkerRouteSource;
  transport: "direct";
  capabilities: ModelCapabilities;
  providerOptions?: ProviderOptions;
};

type TraceableModelRoute = {
  task: ModelTask;
  route: { provider: string; model: string };
  routeSource: string;
  transport: string;
};

type ModelCallTrace = {
  label?: string;
  extractorName?: string;
  startPage?: number;
  endPage?: number;
  batchIndex?: number;
  batchCount?: number;
  phase?: string;
  sourceBacked?: boolean;
};

type AckResult = {
  ok: boolean;
  leaseExpiresAt?: number;
  replayed?: boolean;
};

type CompletionPayloadSaveResult = {
  storageId: string;
  byteLength: number;
  logSaved?: boolean;
  logError?: string;
};

type ResumableExtractionArtifact = {
  artifactId: string;
  kind: "source_bundle" | "section_result";
  url: string | null;
  sourceFingerprint?: string;
  extractorVersion?: string;
  sectionId?: string;
  metadata?: unknown;
};

const require = createRequire(import.meta.url);
const workerPackage = require("../package.json") as {
  version?: string;
  dependencies?: Record<string, string>;
};
const WORKER_PROTOCOL_VERSION = process.env.EXTRACTION_WORKER_PROTOCOL_VERSION === "source-tree-v2"
  ? "source-tree-v2"
  : "source-tree-v1";

const actions = {
  saveExternalCompletionPayload: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      payload: unknown;
    },
    CompletionPayloadSaveResult
  >("externalExtractionPayload:saveExternalCompletionPayload"),
  createExternalCompletionUploadUrl: makeFunctionReference<
    "action",
    {
      secret: string;
    },
    { uploadUrl: string }
  >("externalExtractionPayload:createExternalCompletionUploadUrl"),
  finalizeExternalCompletionPayload: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      storageId: string;
      byteLength: number;
    },
    CompletionPayloadSaveResult
  >("externalExtractionPayload:finalizeExternalCompletionPayload"),
  claimExternalJob: makeFunctionReference<
    "action",
    {
      secret: string;
      workerId?: string;
      workerVersion?: string;
      workerProtocolVersion?: string;
      clSdkVersion?: string;
    },
    ClaimedJob | null
  >("actions/policyExtraction.js:claimExternalJob"),
  claimExternalPreviewJob: makeFunctionReference<
    "action",
    {
      secret: string;
      workerId?: string;
      workerVersion?: string;
      workerProtocolVersion?: string;
      clSdkVersion?: string;
    },
    ClaimedPreviewJob | null
  >("actions/policyExtraction.js:claimExternalPreviewJob"),
  heartbeatExternalJob: makeFunctionReference<
    "action",
    { secret: string; policyId: string; leaseId: string },
    AckResult
  >("actions/policyExtraction.js:heartbeatExternalJob"),
  heartbeatExternalPreviewJob: makeFunctionReference<
    "action",
    { secret: string; policyId: string; leaseId: string },
    AckResult
  >("actions/policyExtraction.js:heartbeatExternalPreviewJob"),
  logExternalJob: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      message: string;
      phase?: string;
      level?: "info" | "warn" | "error";
    },
    AckResult
  >("actions/policyExtraction.js:logExternalJob"),
  createExternalExtractionArtifactUploadUrl: makeFunctionReference<
    "action",
    { secret: string },
    { uploadUrl: string }
  >("actions/policyExtraction.js:createExternalExtractionArtifactUploadUrl"),
  finalizeExternalExtractionArtifact: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      kind: "source_bundle" | "section_result";
      storageId: string;
      sourceFingerprint: string;
      extractorVersion: string;
      sectionId?: string;
      metadata?: unknown;
    },
    { ok: boolean; artifactId?: string }
  >("actions/policyExtraction.js:finalizeExternalExtractionArtifact"),
  getExternalExtractionResumeArtifacts: makeFunctionReference<
    "action",
    { secret: string; policyId: string; leaseId: string },
    { ok: boolean; runId?: string; artifacts: ResumableExtractionArtifact[] }
  >("actions/policyExtraction.js:getExternalExtractionResumeArtifacts"),
  completeExternalExtract: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      state: WorkerState;
      payloadStorageId?: string;
      document?: unknown;
      chunks?: unknown[];
      sourceSpans?: Array<Record<string, unknown>>;
      sourceChunks?: Array<Record<string, unknown>>;
      sourceTree?: Array<Record<string, unknown>>;
      operationalProfile?: unknown;
      warnings?: string[];
      tokenUsage?: unknown;
      performanceReport?: unknown;
      protocolVersion?: "source-tree-v1" | "source-tree-v2";
      extractorVersion?: string;
      sections?: unknown[];
    },
    AckResult
  >("actions/policyExtraction.js:completeExternalExtract"),
  completeExternalExtractFromStoredPayload: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      state: WorkerState;
    },
    AckResult
  >("actions/policyExtraction.js:completeExternalExtractFromStoredPayload"),
  completeExternalPreview: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      state: WorkerState;
      fields: unknown;
      previewVersion: string;
      previewModel?: string;
    },
    AckResult
  >("actions/policyExtraction.js:completeExternalPreview"),
  failExternalJob: makeFunctionReference<
    "action",
    { secret: string; policyId: string; leaseId: string; state?: WorkerState; error: string },
    AckResult
  >("actions/policyExtraction.js:failExternalJob"),
  failExternalPreviewJob: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
      leaseId: string;
      state?: WorkerState;
      error: string;
      previewVersion?: string;
    },
    AckResult
  >("actions/policyExtraction.js:failExternalPreviewJob"),
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
const GLASS_ENV =
  process.env.GLASS_ENV ??
  process.env.RAILWAY_ENVIRONMENT_NAME ??
  "local";
const WORKER_ID = process.env.EXTRACTION_WORKER_ID ?? `extraction-worker-${process.pid}`;
const WORKER_VERSION = process.env.EXTRACTION_WORKER_VERSION ?? workerPackage.version ?? "unknown";
const WORKER_CL_SDK_VERSION =
  process.env.EXTRACTION_WORKER_CL_SDK_VERSION
  ?? workerPackage.dependencies?.["@claritylabs/cl-sdk"]
  ?? "unknown";
const RUNTIME_ACCESS = resolveWorkerRuntimeAccess(process.env);
const POLL_MS = readBoundedIntEnv("EXTRACTION_WORKER_POLL_MS", 5000, 500, 60_000);
const IDLE_LOG_MS = readBoundedIntEnv("EXTRACTION_WORKER_IDLE_LOG_MS", 60_000, 5_000, 10 * 60_000);
const HEARTBEAT_MS = readBoundedIntEnv("EXTRACTION_WORKER_HEARTBEAT_MS", 30_000, 5_000, 5 * 60_000);
const HTTP_PORT =
  readOptionalIntEnv("PORT") ?? readOptionalIntEnv("LITEPARSE_HTTP_PORT");
const HTTP_MAX_BODY_BYTES = readBoundedIntEnv(
  "LITEPARSE_HTTP_MAX_BODY_BYTES",
  50 * 1024 * 1024,
  1024,
  250 * 1024 * 1024,
);
const LITEPARSE_MAX_PAGES = readOptionalIntEnv("LITEPARSE_MAX_PAGES");
const LITEPARSE_MAX_FILE_SIZE = readOptionalIntEnv(
  "LITEPARSE_MAX_FILE_SIZE_BYTES",
);
const MODEL_CALL_TIMEOUT_MS = readBoundedIntEnv("MODEL_CALL_TIMEOUT_MS", 180_000, 30_000, 15 * 60_000);
const CL_ROUTER_TASK_FLAGS = parseClRouterTaskFlags(process.env.CL_ROUTER_TASKS);
const CL_ROUTER_TIMEOUT_MS = readBoundedIntEnv(
  "CL_ROUTER_TIMEOUT_MS",
  MODEL_CALL_TIMEOUT_MS,
  5_000,
  15 * 60_000,
);
const CL_ROUTER_TENANT_ID = cleanEnv(process.env.CL_ROUTER_TENANT_ID) ?? "glass";
const clRouter = CL_ROUTER_TASK_FLAGS.size > 0
  ? createClRouterClient({
      baseUrl: requiredEnv("CL_ROUTER_URL"),
      secret: requiredEnv("CL_ROUTER_SECRET"),
      timeoutMs: CL_ROUTER_TIMEOUT_MS,
    })
  : null;
const POLICY_PREVIEW_VERSION = "policy-preview-v2";
const POLICY_PREVIEW_TEXT_LIMIT = readBoundedIntEnv(
  "EXTRACTION_PREVIEW_TEXT_LIMIT",
  120_000,
  20_000,
  300_000,
);
const POLICY_PREVIEW_MAX_COVERAGES = readBoundedIntEnv(
  "EXTRACTION_PREVIEW_MAX_COVERAGES",
  24,
  1,
  100,
);
const PREVIEW_JOB_CONCURRENCY = readBoundedIntEnv(
  "EXTRACTION_PREVIEW_CONCURRENCY",
  2,
  1,
  8,
);
const EXTRACTION_JOB_CONCURRENCY = readBoundedIntEnv(
  "EXTRACTION_JOB_CONCURRENCY",
  8,
  1,
  1000,
);
const PDF_WORK_MAX_ACTIVE = readBoundedIntEnv(
  "EXTRACTION_PDF_WORK_MAX_ACTIVE",
  Math.min(12, LITEPARSE_MAX_QUEUED_DOCUMENTS + 1),
  2,
  LITEPARSE_MAX_QUEUED_DOCUMENTS + 1,
);
const PDF_WORK_MAX_FULL_ACTIVE = readBoundedIntEnv(
  "EXTRACTION_PDF_WORK_MAX_FULL_ACTIVE",
  Math.min(8, PDF_WORK_MAX_ACTIVE),
  1,
  PDF_WORK_MAX_ACTIVE,
);

const convex = new ConvexHttpClient(CONVEX_URL);
const pdfWorkAdmission = createPdfWorkAdmission({
  maxActive: PDF_WORK_MAX_ACTIVE,
  maxFullActive: PDF_WORK_MAX_FULL_ACTIVE,
});
const shutdownController = new AbortController();

let shuttingDown = false;
process.on("SIGTERM", () => {
  shuttingDown = true;
  shutdownController.abort();
});
process.on("SIGINT", () => {
  shuttingDown = true;
  shutdownController.abort();
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

function modelAbortSignal() {
  return AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS);
}

async function withModelCallTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("The operation was aborted due to timeout"));
        }, MODEL_CALL_TIMEOUT_MS + 1000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    void promise.catch(() => {});
  }
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

function selectPageImages(
  screenshots: PageScreenshot[] | undefined,
  trace: ModelCallTrace | undefined,
): { images?: ExtractionImage[] } {
  if (!screenshots?.length) return {};
  const startPage = typeof trace?.startPage === "number" ? trace.startPage : undefined;
  const endPage = typeof trace?.endPage === "number" ? trace.endPage : startPage;
  if (!startPage || !endPage) return {};
  const maxImages = readBoundedIntEnv("EXTRACTION_MULTIMODAL_MAX_IMAGES", 2, 0, 6);
  if (maxImages <= 0) return {};
  const images = screenshots
    .filter((shot) => shot.page >= startPage && shot.page <= endPage)
    .slice(0, maxImages)
    .map((shot) => ({
      imageBase64: shot.imageBase64,
      mimeType: shot.mimeType,
    }));
  return images.length > 0 ? { images } : {};
}

function enrichProviderOptions(
  providerOptions: unknown,
  screenshots: PageScreenshot[] | undefined,
  trace: ModelCallTrace | undefined,
): Record<string, unknown> {
  return {
    ...((providerOptions as Record<string, unknown> | undefined) ?? {}),
    ...selectPageImages(screenshots, trace),
  };
}

function readSourceKind(value: unknown): "policy_pdf" | "email" | "attachment" | "manual_note" {
  if (
    value === "policy_pdf"
    || value === "email"
    || value === "attachment"
    || value === "manual_note"
  ) {
    return value;
  }
  return "policy_pdf";
}

const WORKER_STATIC_ROUTES: Record<ModelTask, WorkerModelRoute> = {
  classification: MODEL_ROUTING.classification,
  extraction: MODEL_ROUTING.extraction,
  extraction_preview: MODEL_ROUTING.extraction_preview,
  extraction_coverage_recovery: MODEL_ROUTING.extraction_coverage_recovery,
};

const WORKER_COVERAGE_CLEANUP_ROUTE: WorkerModelRoute =
  SPECIAL_MODEL_ROUTES.extraction_coverage_cleanup;

const WORKER_QUALITY_ROUTE: WorkerModelRoute =
  SPECIAL_MODEL_ROUTES.extraction_quality;

const WORKER_FALLBACK_ROUTE: WorkerModelRoute =
  SPECIAL_MODEL_ROUTES.fallback;

const WORKER_MODEL_PROVIDERS = new Set<ModelProvider>(DIRECT_MODEL_PROVIDERS);
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

function isModelProvider(value: string): value is ModelProvider {
  return WORKER_MODEL_PROVIDERS.has(value as ModelProvider);
}

function isWorkerModelRoute(value: unknown): value is WorkerModelRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as Record<string, unknown>;
  return (
    typeof route.provider === "string" &&
    isModelProvider(route.provider) &&
    typeof route.model === "string" &&
    route.model.length > 0
  );
}

function readRouteSource(value: unknown): WorkerRouteSource | undefined {
  if (
    value === "broker" ||
    value === "global" ||
    value === "static" ||
    value === "configured" ||
    value === "default" ||
    value === "fallback"
  ) {
    return value;
  }
  return undefined;
}

function providerModel(provider: ModelProvider, model: string, apiKey?: string): LanguageModel {
  switch (provider) {
    case "openai":
      return (apiKey ? createOpenAI({ apiKey }) : createOpenAI())(model);
    case "anthropic":
      return (apiKey ? createAnthropic({ apiKey }) : createAnthropic())(model);
    case "google":
      return (apiKey ? createGoogleGenerativeAI({ apiKey }) : createGoogleGenerativeAI())(model);
    case "xai":
      return (apiKey ? createXai({ apiKey }) : createXai())(model);
    case "mistral":
      return (apiKey ? createMistral({ apiKey }) : createMistral())(model);
    case "cohere":
      return (apiKey ? createCohere({ apiKey }) : createCohere())(model);
    case "fireworks":
      return createOpenAICompatible({
        name: "fireworks",
        baseURL: FIREWORKS_BASE_URL,
        apiKey: apiKey ?? process.env.FIREWORKS_API_KEY,
        includeUsage: true,
        supportsStructuredOutputs: true,
      })(model);
    case "deepseek":
      return (apiKey ? createDeepSeek({ apiKey }) : createDeepSeek())(model);
  }
}

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function directProviderApiKey(provider: ModelProvider): string | undefined {
  switch (provider) {
    case "openai":
      return cleanEnv(process.env.OPENAI_API_KEY);
    case "anthropic":
      return cleanEnv(process.env.ANTHROPIC_API_KEY);
    case "google":
      return cleanEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
        ?? cleanEnv(process.env.GOOGLE_API_KEY);
    case "xai":
      return cleanEnv(process.env.XAI_API_KEY);
    case "mistral":
      return cleanEnv(process.env.MISTRAL_API_KEY);
    case "cohere":
      return cleanEnv(process.env.COHERE_API_KEY);
    case "fireworks":
      return cleanEnv(process.env.FIREWORKS_API_KEY);
    case "deepseek":
      return cleanEnv(process.env.DEEPSEEK_API_KEY);
  }
}

function getProviderOptionsForRoute(route: WorkerModelRoute): ProviderOptions | undefined {
  if (route.provider === "openai" && route.model === "gpt-5.5") {
    return { openai: { reasoningEffort: "none" } };
  }
  return undefined;
}

function mergeProviderOptions(
  ...options: Array<ProviderOptions | undefined>
): ProviderOptions | undefined {
  const merged: Record<string, unknown> = {};
  for (const option of options) {
    if (!option) continue;
    for (const [provider, value] of Object.entries(option)) {
      const existing = merged[provider];
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        existing &&
        typeof existing === "object" &&
        !Array.isArray(existing)
      ) {
        merged[provider] = {
          ...(existing as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      } else {
        merged[provider] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? (merged as ProviderOptions) : undefined;
}

function routeDirectApiKey(route: WorkerModelRoute, apiKey?: string): string | undefined {
  return cleanEnv(apiKey) ?? directProviderApiKey(route.provider);
}

function routeHasDirectAccess(route: WorkerModelRoute, apiKey?: string): boolean {
  return !!directProviderModelForRoute(route) && !!routeDirectApiKey(route, apiKey);
}

function routeTransport(_route: WorkerModelRoute, _apiKey?: string): "direct" {
  return "direct";
}

function routeToModel(route: WorkerModelRoute, apiKey?: string): LanguageModel {
  const nativeModel = directProviderModelForRoute(route);
  if (!nativeModel) {
    throw new Error(
      `Model route ${route.provider}/${route.model} is not supported by the direct ${route.provider} provider. Configure a directly supported provider/model route instead.`,
    );
  }
  const directApiKey = routeDirectApiKey(route, apiKey);
  if (!directApiKey) {
    throw new Error(
      `Direct ${route.provider} API key is missing for model route ${route.provider}/${route.model}. AI Gateway is not a fallback for extraction worker model routing.`,
    );
  }
  return providerModel(route.provider, nativeModel, directApiKey);
}

function modelTaskForTaskKind(taskKind?: string): ModelTask {
  if (taskKind === "extraction_preview") return "extraction_preview";
  if (taskKind === "extraction_classify") return "classification";
  if (taskKind === "extraction_coverage_recovery") return "extraction_coverage_recovery";
  return "extraction";
}

function apiKeyForRoute(
  route: WorkerModelRoute,
  routeSource: WorkerRouteSource,
  settings?: WorkerModelSettings,
): string | undefined {
  if (routeSource === "broker" || routeSource === "configured") {
    return cleanEnv(settings?.providerKeys?.[route.provider]);
  }
  return undefined;
}

function resolveConfiguredRoute(
  routeId: string,
  defaultRoute: WorkerModelRoute,
  defaultRouteSource: WorkerRouteSource,
  settings?: WorkerModelSettings,
): {
  route: WorkerModelRoute;
  routeSource: WorkerRouteSource;
  apiKey?: string;
} {
  const settingsRoute = settings?.routes?.[routeId];
  const configuredRoute = isWorkerModelRoute(settingsRoute) ? settingsRoute : undefined;
  const configuredRouteSource = readRouteSource(settings?.routeSources?.[routeId]);
  const routeSource = configuredRouteSource ?? "configured";
  const configuredApiKey = configuredRoute
    ? apiKeyForRoute(configuredRoute, routeSource, settings)
    : undefined;
  const canUseConfiguredRoute =
    !!configuredRoute &&
    routeHasDirectAccess(configuredRoute, configuredApiKey);
  if (canUseConfiguredRoute) {
    return {
      route: configuredRoute,
      routeSource,
      apiKey: configuredApiKey,
    };
  }
  return { route: defaultRoute, routeSource: defaultRouteSource };
}

function resolveConfiguredFallbackRoute(settings?: WorkerModelSettings) {
  return resolveConfiguredRoute("fallback", WORKER_FALLBACK_ROUTE, "fallback", settings);
}

function resolveConfiguredQualityRoute(settings?: WorkerModelSettings) {
  return resolveConfiguredRoute(
    "extraction_quality",
    WORKER_QUALITY_ROUTE,
    "static",
    settings,
  );
}

function resolveConfiguredCoverageCleanupRoute(settings?: WorkerModelSettings) {
  return resolveConfiguredRoute(
    "extraction_coverage_cleanup",
    WORKER_COVERAGE_CLEANUP_ROUTE,
    "static",
    settings,
  );
}

function resolveModelForTaskKind(
  taskKind: string | undefined,
  settings?: WorkerModelSettings,
): ResolvedWorkerModelRoute {
  const task = modelTaskForTaskKind(taskKind);
  const settingsRoute = settings?.routes?.[task];
  const configuredRoute = isWorkerModelRoute(settingsRoute) ? settingsRoute : undefined;
  const configuredRouteSource = readRouteSource(settings?.routeSources?.[task]);
  const configuredSource = configuredRouteSource ?? "configured";
  const configuredApiKey = configuredRoute
    ? apiKeyForRoute(configuredRoute, configuredSource, settings)
    : undefined;
  const canUseConfiguredRoute =
    !!configuredRoute &&
    routeHasDirectAccess(configuredRoute, configuredApiKey);
  const baseRoute = canUseConfiguredRoute ? configuredRoute : WORKER_STATIC_ROUTES[task];
  const quality = resolveConfiguredQualityRoute(settings);
  const useQualityPrimary = primaryRouteForCall({
    task,
    taskKind,
    qualityRoute: quality.route,
  }) !== null;
  const coverageCleanup = taskKind === "extraction_coverage_cleanup"
    ? resolveConfiguredCoverageCleanupRoute(settings)
    : null;
  const route = coverageCleanup?.route ?? (useQualityPrimary ? quality.route : baseRoute);
  const routeSource = coverageCleanup?.routeSource ?? (useQualityPrimary
    ? quality.routeSource
    : canUseConfiguredRoute
    ? configuredSource
    : "default");
  const apiKey = coverageCleanup
      ? coverageCleanup.apiKey
    : useQualityPrimary
      ? quality.apiKey
      : canUseConfiguredRoute
        ? configuredApiKey
        : apiKeyForRoute(route, routeSource, settings);
  return {
    model: routeToModel(route, apiKey),
    task,
    route,
    routeSource,
    transport: routeTransport(route, apiKey),
    capabilities: modelCapabilitiesForRoute(route.model),
    providerOptions: getProviderOptionsForRoute(route),
  };
}

function resolveFallbackModel(
  task: ModelTask,
  taskKind: string | undefined,
  primaryRoute: WorkerModelRoute,
  settings?: WorkerModelSettings,
): ResolvedWorkerModelRoute | null {
  const fallback = resolveConfiguredFallbackRoute(settings);
  if (!fallbackRouteForCall({
    task,
    taskKind,
    primaryRoute,
    fallbackRoute: fallback.route,
  })) {
    return null;
  }
  return {
    task,
    model: routeToModel(fallback.route, fallback.apiKey),
    route: fallback.route,
    routeSource: fallback.routeSource,
    transport: routeTransport(fallback.route, fallback.apiKey),
    capabilities: modelCapabilitiesForRoute(fallback.route.model),
    providerOptions: getProviderOptionsForRoute(fallback.route),
  };
}

function isMissingApiKeyError(error: unknown): boolean {
  return /api key is missing/i.test(errorMessage(error));
}

function providerOptionsForModelCall(
  route: ResolvedWorkerModelRoute,
  providerOptions: ProviderOptions | undefined,
): ProviderOptions | undefined {
  return mergeProviderOptions(route.providerOptions, providerOptions);
}

function modelRouteTrace(route: TraceableModelRoute) {
  return {
    provider: route.route.provider,
    model: route.route.model,
    routeSource: route.routeSource,
    transport: route.transport,
  };
}

async function recordModelCallError(
  opts: {
    job: Pick<ClaimedJob, "state">;
    route: TraceableModelRoute;
    label: string;
    taskKind?: string;
    startedAt: number;
    attempt: number;
    error: unknown;
    details: unknown;
  },
) {
  await recordTraceEvent(opts.job, {
    kind: "model_call",
    label: opts.label,
    task: opts.route.task,
    taskKind: opts.taskKind,
    ...modelRouteTrace(opts.route),
    attempt: opts.attempt,
    status: "error",
    durationMs: nowMs() - opts.startedAt,
    error: errorMessage(opts.error),
    details: opts.details,
  });
}

async function recordModelCallStart(
  opts: {
    job: Pick<ClaimedJob, "state">;
    route: TraceableModelRoute;
    label: string;
    taskKind?: string;
    attempt: number;
    maxOutputTokens: number;
    providerOptions?: ProviderOptions;
    trace?: ModelCallTrace;
  },
) {
  await recordTraceEvent(opts.job, {
    kind: "worker",
    phase: "model_call",
    label: opts.label,
    task: opts.route.task,
    taskKind: opts.taskKind,
    ...modelRouteTrace(opts.route),
    attempt: opts.attempt,
    status: "started",
    details: stripUndefined({
      maxOutputTokens: opts.maxOutputTokens,
      trace: opts.trace,
      inputSummary: providerInputSummary(opts.providerOptions),
    }),
  });
}

async function recordModelCallSoftFailure(
  opts: {
    job: Pick<ClaimedJob, "state">;
    route: TraceableModelRoute;
    label: string;
    taskKind?: string;
    startedAt: number;
    error?: unknown;
    details: unknown;
  },
) {
  await recordTraceEvent(opts.job, {
    kind: "model_call",
    label: opts.label,
    task: opts.route.task,
    taskKind: opts.taskKind,
    ...modelRouteTrace(opts.route),
    attempt: 1,
    status: "soft_failed",
    durationMs: nowMs() - opts.startedAt,
    ...(opts.error === undefined ? {} : { error: errorMessage(opts.error) }),
    details: opts.details,
  });
}

async function recordModelCallComplete(
  opts: {
    job: Pick<ClaimedJob, "state">;
    route: TraceableModelRoute;
    label: string;
    taskKind?: string;
    startedAt: number;
    attempt: number;
    usage: ReturnType<typeof mapUsage>;
    details: unknown;
  },
) {
  await recordTraceEvent(opts.job, {
    kind: "model_call",
    label: opts.label,
    task: opts.route.task,
    taskKind: opts.taskKind,
    ...modelRouteTrace(opts.route),
    attempt: opts.attempt,
    status: "complete",
    durationMs: nowMs() - opts.startedAt,
    inputTokens: opts.usage.inputTokens,
    outputTokens: opts.usage.outputTokens,
    details: opts.details,
  });
}

function shouldReturnEmptySections(prompt: string, error: unknown): boolean {
  return (
    prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER) &&
    errorMessage(error).includes("No output generated")
  );
}

function maxOutputTokensForRoute(
  maxTokens: number,
  route: ResolvedWorkerModelRoute,
  taskKind?: string,
): number {
  const routeMax = taskKind
    ? route.capabilities.taskOutputTokens?.[taskKind as ModelTaskKind] ?? route.capabilities.maxOutputTokens
    : route.capabilities.maxOutputTokens;
  return routeMax ? Math.min(maxTokens, routeMax) : maxTokens;
}

function logFallback(
  primary: ResolvedWorkerModelRoute,
  fallback: ResolvedWorkerModelRoute,
  error: unknown,
) {
  console.warn(
    `Primary extraction model (${primary.route.provider}/${primary.route.model}) failed: ${errorMessage(error)}. Retrying with ${fallback.route.provider}/${fallback.route.model}.`,
  );
}

function readTraceDetails(params: { trace?: unknown }): ModelCallTrace | undefined {
  if (!params.trace || typeof params.trace !== "object" || Array.isArray(params.trace)) return undefined;
  return params.trace as ModelCallTrace;
}

function modelTraceLabel(
  kind: "generateText" | "generateObject",
  taskKind?: string,
  task?: ModelTask,
  trace?: ModelCallTrace,
) {
  if (trace?.label) return trace.label;
  if (trace?.extractorName) {
    const pageRange = trace.startPage
      ? ` pages ${trace.startPage}${trace.endPage && trace.endPage !== trace.startPage ? `-${trace.endPage}` : ""}`
      : "";
    return `${trace.extractorName}${pageRange}`;
  }
  if (trace?.phase === "format" && trace.batchIndex && trace.batchCount) {
    return `Format extracted content ${trace.batchIndex}/${trace.batchCount}`;
  }
  const labels: Record<string, string> = {
    extraction_classify: "Classify document",
    extraction_preview: "Extract provisional policy fields",
    extraction_source_tree: "Build source-native document tree",
    extraction_operational_profile: "Build operational profile",
    extraction_coverage_cleanup: "Clean coverage schedules",
    extraction_page_map: "Map policy pages",
    extraction_focused: "Extract policy fields",
    extraction_long_list: "Extract long policy lists",
    extraction_referential_lookup: "Resolve policy references",
    extraction_review: "Review extraction evidence",
    extraction_summary: "Summarize extracted policy",
    extraction_format: "Format extracted policy",
  };
  if (taskKind && labels[taskKind]) return labels[taskKind];
  if (taskKind) {
    return taskKind
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  if (task === "extraction") return kind === "generateText" ? "Extract policy text" : "Extract policy structure";
  if (task === "extraction_preview") return "Extract provisional policy fields";
  if (task === "classification") return "Classify document";
  return kind === "generateText" ? "Generate text" : "Generate structured output";
}

const TRACE_TEXT_PREVIEW_LIMIT = 6000;
const TRACE_OUTPUT_PREVIEW_LIMIT = 6000;

function truncateTraceText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function redactEmbeddedPdfBase64(value: string) {
  return value.replace(/JVBER[A-Za-z0-9+/=\s]{200,}/g, (match) => {
    const compact = match.replace(/\s/g, "");
    return `[PDF base64 omitted: ${compact.length} chars]`;
  });
}

function traceTextPreview(value: unknown, limit = TRACE_TEXT_PREVIEW_LIMIT) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return truncateTraceText(redactEmbeddedPdfBase64(value), limit);
}

function traceJsonPreview(value: unknown) {
  try {
    return truncateTraceText(JSON.stringify(value, null, 2), TRACE_OUTPUT_PREVIEW_LIMIT);
  } catch {
    return truncateTraceText(String(value), TRACE_OUTPUT_PREVIEW_LIMIT);
  }
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  );
}

function providerInputSummary(providerOptions: ProviderOptions | undefined) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  if (!options) return undefined;
  return {
    hasPdfBase64: typeof options.pdfBase64 === "string",
    pdfBase64Chars: typeof options.pdfBase64 === "string" ? options.pdfBase64.length : undefined,
    hasPdfUrl: !!options.pdfUrl,
    pdfUrl: typeof options.pdfUrl === "string"
      ? options.pdfUrl
      : options.pdfUrl instanceof URL
        ? options.pdfUrl.toString()
        : undefined,
    hasPdfBytes: options.pdfBytes instanceof Uint8Array,
    pdfBytes: options.pdfBytes instanceof Uint8Array ? options.pdfBytes.byteLength : undefined,
    mimeType: typeof options.mimeType === "string" ? options.mimeType : undefined,
    images: Array.isArray(options.images)
      ? options.images.map((image) => ({
        mimeType: image.mimeType,
        base64Chars: image.imageBase64.length,
      }))
      : undefined,
  };
}

function modelTraceDetails(params: {
  kind: "generateText" | "generateObject";
  label: string;
  task: ModelTask;
  taskKind?: string;
  prompt: string;
  system?: string;
  maxOutputTokens: number;
  providerOptions?: ProviderOptions;
  trace?: ModelCallTrace;
  output?: unknown;
  outputKind?: "text" | "object";
}) {
  return stripUndefined({
    purpose: params.label,
    callKind: params.kind,
    task: params.task,
    taskKind: params.taskKind,
    trace: params.trace,
    maxOutputTokens: params.maxOutputTokens,
    systemPreview: traceTextPreview(params.system),
    promptPreview: traceTextPreview(params.prompt),
    inputSummary: providerInputSummary(params.providerOptions),
    outputKind: params.outputKind,
    outputPreview: params.outputKind === "object"
      ? traceJsonPreview(params.output)
      : traceTextPreview(params.output, TRACE_OUTPUT_PREVIEW_LIMIT),
  });
}

const SECTIONS_EXTRACTOR_PROMPT_MARKER =
  "Build a compact source-backed section index for this document";

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

function buildPromptInput(
  prompt: string,
  providerOptions?: Record<string, unknown>,
  route?: WorkerModelRoute,
) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  const supportsPdfFileInput = route?.provider !== "fireworks";
  const supportsImageInput = route ? routeSupportsImageInput(route) : true;
  const pdfPart = supportsPdfFileInput
    ? buildPdfFilePart({
        pdfUrl: options?.pdfUrl,
        pdfBytes: options?.pdfBytes,
        pdfBase64: options?.pdfBase64,
        mimeType: options?.mimeType,
      })
    : null;
  if (supportsImageInput && options?.images?.length) {
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
            ...(pdfPart ? [pdfPart] : []),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    };
  }

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

  const embedded = supportsPdfFileInput ? extractEmbeddedPdf(prompt) : null;
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

function routeSupportsImageInput(route: WorkerModelRoute): boolean {
  return modelSupportsImageInput(route);
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

function clRouterAssets(providerOptions: Record<string, unknown>): ClRouterProviderAssets | undefined {
  const options = providerOptions as ExtractionProviderOptions;
  const images = Array.isArray(options.images)
    ? options.images.filter(
        (image) => typeof image.imageBase64 === "string" && image.imageBase64.length > 0,
      )
    : undefined;
  if (
    typeof options.pdfBase64 !== "string"
    && !(options.pdfBytes instanceof Uint8Array)
    && !images?.length
  ) {
    return undefined;
  }
  return {
    ...(typeof options.pdfBase64 === "string" ? { pdfBase64: options.pdfBase64 } : {}),
    ...(options.pdfBytes instanceof Uint8Array ? { pdfBytes: options.pdfBytes } : {}),
    ...(typeof options.mimeType === "string" ? { mimeType: options.mimeType } : {}),
    ...(images?.length ? { images } : {}),
  };
}

function clRouterTraceRoute(
  task: ModelTask,
  response: ClRouterGenerateResponse,
): TraceableModelRoute {
  return {
    task,
    route: response.model,
    routeSource: response.routing.routeSource ?? response.routing.decision,
    transport: "cl-router",
  };
}

function clRouterTraceDetails(response: ClRouterGenerateResponse) {
  return {
    requestId: response.requestId,
    costUsd: response.costUsd,
    costStatus: response.costStatus,
    finishReason: response.finishReason,
    cachedInputTokens: response.usage.cachedInputTokens,
    cacheWriteTokens: response.usage.cacheWriteTokens,
    reasoningTokens: response.usage.reasoningTokens,
    routing: response.routing,
  };
}

async function generateObjectWithClRouter<T>(opts: {
  job: ClaimedJob;
  task: ModelTask;
  taskKind?: string;
  label: string;
  prompt: string;
  system?: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  providerOptions: Record<string, unknown>;
  trace?: ModelCallTrace;
  modelSettings?: WorkerModelSettings;
  validate: (output: unknown) => T;
}): Promise<{ object: T; usage: ReturnType<typeof mapUsage>; route: TraceableModelRoute } | null> {
  if (!clRouter || !isClRouterTaskEnabled(CL_ROUTER_TASK_FLAGS, opts.task, opts.taskKind)) {
    return null;
  }
  const startedAt = nowMs();
  await recordTraceEvent(opts.job, {
    kind: "worker",
    phase: "model_call",
    label: opts.label,
    task: opts.task,
    taskKind: opts.taskKind,
    transport: "cl-router",
    attempt: 1,
    status: "started",
    details: stripUndefined({
      maxOutputTokens: opts.maxOutputTokens,
      trace: opts.trace,
      inputSummary: providerInputSummary(opts.providerOptions as ProviderOptions),
      schemaBytes: Buffer.byteLength(JSON.stringify(opts.schema)),
    }),
  });
  try {
    const response = await clRouter.generate({
      task: opts.task,
      taskKind: opts.taskKind,
      tenantId: CL_ROUTER_TENANT_ID,
      orgId: opts.job.state.orgId,
      settings: opts.modelSettings,
      system: opts.system,
      prompt: opts.prompt,
      schema: opts.schema,
      maxTokens: opts.maxOutputTokens,
      sessionKey: opts.job.state.traceId ?? opts.job.policyId,
      assets: clRouterAssets(opts.providerOptions),
      trace: stripUndefined({
        traceId: opts.job.state.traceId,
        label: opts.label,
        phase: opts.trace?.phase,
        taskKind: opts.taskKind,
        policyId: opts.job.policyId,
        workerId: WORKER_ID,
      }) as Record<string, unknown>,
    });
    const object = opts.validate(response.output);
    const route = clRouterTraceRoute(opts.task, response);
    const usage = mapUsage(response.usage);
    await recordModelCallComplete({
      job: opts.job,
      route,
      label: opts.label,
      taskKind: opts.taskKind,
      attempt: response.routing.attemptCount,
      startedAt,
      usage,
      details: stripUndefined({
        ...(modelTraceDetails({
          kind: "generateObject",
          label: opts.label,
          task: opts.task,
          taskKind: opts.taskKind,
          prompt: opts.prompt,
          system: opts.system,
          maxOutputTokens: opts.maxOutputTokens,
          providerOptions: opts.providerOptions as ProviderOptions,
          trace: opts.trace,
          output: object,
          outputKind: "object",
        }) as Record<string, unknown>),
        clRouter: clRouterTraceDetails(response),
      }),
    });
    return { object, usage, route };
  } catch (error) {
    const canUseDirectFallback = shouldFallBackFromClRouter(error, { GLASS_ENV });
    await recordTraceEvent(opts.job, {
      kind: "model_call",
      label: opts.label,
      task: opts.task,
      taskKind: opts.taskKind,
      transport: "cl-router",
      attempt: 1,
      status: "error",
      durationMs: nowMs() - startedAt,
      error: errorMessage(error),
      details: stripUndefined({
        trace: opts.trace,
        directFallbackEligible: canUseDirectFallback,
      }),
    });
    if (!canUseDirectFallback) throw error;
    console.warn(
      `cl-router failed safely for ${opts.taskKind ?? opts.task}: ${errorMessage(error)}. Retrying through the direct provider path.`,
    );
    return null;
  }
}

function buildWorkerExtractor(opts: {
  job: ClaimedJob;
  log: (message: string) => Promise<void>;
  modelSettings?: WorkerModelSettings;
  pageScreenshots?: PageScreenshot[];
}) {
  const generateObject: GenerateObject = async (params) => {
    const taskKind = readTaskKind(params);
    const trace = readTraceDetails(params);
    const prompt = applyCarrierIdentityGuidance(
      params.prompt,
      taskKind,
      trace?.extractorName,
    );
    const providerOptions = enrichProviderOptions(params.providerOptions, opts.pageScreenshots, trace);
    const route = resolveModelForTaskKind(taskKind, opts.modelSettings);
    const label = modelTraceLabel("generateObject", taskKind, route.task, trace);
    const maxOutputTokens = maxOutputTokensForRoute(params.maxTokens, route, taskKind);
    if (clRouter && isClRouterTaskEnabled(CL_ROUTER_TASK_FLAGS, route.task, taskKind)) {
      const routerSchema = await zodSchema(params.schema).jsonSchema;
      const routerResult = await generateObjectWithClRouter({
        job: opts.job,
        task: route.task,
        taskKind,
        label,
        prompt,
        system: params.system,
        schema: routerSchema as Record<string, unknown>,
        maxOutputTokens,
        providerOptions,
        trace,
        modelSettings: opts.modelSettings,
        validate: (output) => {
          const parsed = params.schema.safeParse(output);
          if (!parsed.success) {
            throw new ClRouterProtocolError("cl-router returned output that failed the extraction schema");
          }
          return parsed.data;
        },
      });
      if (routerResult) {
        return { object: routerResult.object, usage: routerResult.usage };
      }
    }
    const callProviderOptions = providerOptionsForModelCall(
      route,
      providerOptions as ProviderOptions | undefined,
    );
    const startedAt = nowMs();
    try {
      await recordModelCallStart({
        job: opts.job,
        route,
        label,
        taskKind,
        attempt: 1,
        maxOutputTokens,
        providerOptions: callProviderOptions,
        trace,
      });
      const result = await withModelCallTimeout(aiGenerateText({
        model: route.model,
        system: params.system,
        ...buildPromptInput(prompt, providerOptions, route.route),
        output: Output.object({
          schema: structuredOutputSchemaForProvider(params.schema, route.route.provider),
        }),
        maxOutputTokens,
        providerOptions: callProviderOptions,
        abortSignal: modelAbortSignal(),
      }));
      const usage = mapUsage(result.usage);
      await recordModelCallComplete({
        job: opts.job,
        route,
        label,
        taskKind,
        attempt: 1,
        startedAt,
        usage,
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: route.task,
          taskKind,
          prompt,
          system: params.system,
          maxOutputTokens,
          providerOptions: callProviderOptions,
          trace,
          output: result.output,
          outputKind: "object",
        }),
      });
      return {
        object: result.output!,
        usage,
      };
    } catch (error) {
      if (shouldReturnEmptySections(prompt, error)) {
        await recordModelCallSoftFailure({
          job: opts.job,
          route,
          label,
          taskKind,
          startedAt,
          error,
          details: modelTraceDetails({
            kind: "generateObject",
            label,
            task: route.task,
            taskKind,
            prompt,
            system: params.system,
            maxOutputTokens,
            providerOptions: callProviderOptions,
            trace,
            output: { sections: [] },
            outputKind: "object",
          }),
        });
        return { object: { sections: [] }, usage: undefined };
      }

      await recordModelCallError({
        job: opts.job,
        route,
        label,
        taskKind,
        attempt: 1,
        startedAt,
        error,
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: route.task,
          taskKind,
          prompt,
          system: params.system,
          maxOutputTokens,
          providerOptions: callProviderOptions,
          trace,
        }),
      });

      const fallback = isMissingApiKeyError(error)
        ? null
        : resolveFallbackModel(route.task, taskKind, route.route, opts.modelSettings);
      if (!fallback) throw error;

      logFallback(route, fallback, error);
      const fallbackMaxOutputTokens = maxOutputTokensForRoute(params.maxTokens, fallback, taskKind);
      const fallbackProviderOptions = providerOptionsForModelCall(
        fallback,
        providerOptions as ProviderOptions | undefined,
      );
      const fallbackStartedAt = nowMs();
      try {
        await recordModelCallStart({
          job: opts.job,
          route: fallback,
          label,
          taskKind,
          attempt: 2,
          maxOutputTokens: fallbackMaxOutputTokens,
          providerOptions: fallbackProviderOptions,
          trace,
        });
        const fallbackResult = await withModelCallTimeout(aiGenerateText({
          model: fallback.model,
          system: params.system,
          ...buildPromptInput(prompt, providerOptions, fallback.route),
          output: Output.object({
            schema: structuredOutputSchemaForProvider(params.schema, fallback.route.provider),
          }),
          maxOutputTokens: fallbackMaxOutputTokens,
          providerOptions: fallbackProviderOptions,
          abortSignal: modelAbortSignal(),
        }));
        const usage = mapUsage(fallbackResult.usage);
        await recordModelCallComplete({
          job: opts.job,
          route: fallback,
          label,
          taskKind,
          attempt: 2,
          startedAt: fallbackStartedAt,
          usage,
          details: modelTraceDetails({
            kind: "generateObject",
            label,
            task: fallback.task,
            taskKind,
            prompt,
            system: params.system,
            maxOutputTokens: fallbackMaxOutputTokens,
            providerOptions: fallbackProviderOptions,
            trace,
            output: fallbackResult.output,
            outputKind: "object",
          }),
        });
        return {
          object: fallbackResult.output!,
          usage,
        };
      } catch (fallbackError) {
        await recordModelCallError({
          job: opts.job,
          route: fallback,
          label,
          taskKind,
          attempt: 2,
          startedAt: fallbackStartedAt,
          error: fallbackError,
          details: modelTraceDetails({
            kind: "generateObject",
            label,
            task: fallback.task,
            taskKind,
            prompt,
            system: params.system,
            maxOutputTokens: fallbackMaxOutputTokens,
            providerOptions: fallbackProviderOptions,
            trace,
          }),
        });
        throw fallbackError;
      }
    }
  };

  const extractionRoute = resolveModelForTaskKind("extraction_focused", opts.modelSettings);
  const modelCapabilitiesByTaskKind = Object.fromEntries(
    ([
      "extraction_source_tree",
      "extraction_operational_profile",
      "extraction_coverage_recovery",
      "extraction_coverage_cleanup",
      "extraction_review",
      "extraction_referential_lookup",
    ] satisfies ModelTaskKind[]).map((taskKind) => [
      taskKind,
      resolveModelForTaskKind(taskKind, opts.modelSettings).capabilities,
    ]),
  ) as Partial<Record<ModelTaskKind, ModelCapabilities>>;
  return createExtractor({
    generateObject,
    log: opts.log,
    onProgress: opts.log,
    modelCapabilities: extractionRoute.capabilities,
    modelCapabilitiesByTaskKind,
  });
}

async function logJob(
  job: Pick<ClaimedJob, "policyId" | "leaseId">,
  message: string,
  level: "info" | "warn" | "error" = "info",
): Promise<void> {
  try {
    await convex.action(actions.logExternalJob, {
      secret: SECRET,
      policyId: job.policyId,
      leaseId: job.leaseId,
      message,
      phase: "worker",
      level,
    });
  } catch (error) {
    console.warn(`[${job.policyId}] failed to append extraction log: ${errorMessage(error)}`);
  }
}

async function fetchPdfBytes(fileUrl: string): Promise<Uint8Array> {
  const response = await fetch(resolveConvexStorageUrl(fileUrl, {
    glassEnv: GLASS_ENV,
    convexUrl: CONVEX_URL,
  }));
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
  if (!RUNTIME_ACCESS.conversionsEnabled) {
    jsonResponse(res, 503, {
      error: "PDF conversion is disabled in ephemeral Railway environments",
    });
    return;
  }
  if (!isAuthorized(req)) {
    jsonResponse(res, 401, { error: "Unauthorized" });
    return;
  }
  const cancellation = watchClientDisconnect(req, res);
  const signal = AbortSignal.any([
    cancellation.signal,
    shutdownController.signal,
  ]);
  let releasePdfWork: (() => void) | undefined;

  try {
    releasePdfWork = await pdfWorkAdmission.acquire("http", signal);
    const body = await readJsonBody(req);
    if (signal.aborted) {
      throw new DOMException("Client closed request", "AbortError");
    }
    const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
    if (!pdfBase64) {
      jsonResponse(res, 400, { error: "Missing pdfBase64" });
      return;
    }
    const pdfBytes = Buffer.from(pdfBase64, "base64");
    const converted = await convertPdfWithLiteParse({
      pdfBytes,
      documentId: typeof body.documentId === "string" ? body.documentId : "inline-pdf",
      sourceKind: readSourceKind(body.sourceKind),
      maxPages: LITEPARSE_MAX_PAGES,
      maxFileSize: LITEPARSE_MAX_FILE_SIZE,
      priority: "http",
      signal,
    });
    jsonResponse(res, 200, {
      ok: true,
      text: converted.text,
      sourceSpans: converted.sourceSpans,
      sourceChunks: converted.sourceChunks,
      pageScreenshots: converted.pageScreenshots,
      metadata: converted.metadata,
    });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      if (!res.headersSent && !res.destroyed && !res.writableEnded) {
        jsonResponse(res, 499, { error: "Client closed request" });
      }
      return;
    }
    throw error;
  } finally {
    releasePdfWork?.();
    cancellation.dispose();
  }
}

function startHttpServer(): { close: () => void } | null {
  if (!HTTP_PORT) return null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      jsonResponse(res, 200, {
        ok: true,
        glassEnv: GLASS_ENV,
        workerId: WORKER_ID,
        workerVersion: WORKER_VERSION,
        workerProtocolVersion: WORKER_PROTOCOL_VERSION,
        clSdkVersion: WORKER_CL_SDK_VERSION,
        convexUrl: CONVEX_URL,
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
        gitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
        gitBranch: process.env.RAILWAY_GIT_BRANCH,
        workerMode: RUNTIME_ACCESS.mode,
        jobsEnabled: RUNTIME_ACCESS.jobsEnabled,
        conversionsEnabled: RUNTIME_ACCESS.conversionsEnabled,
        clRouterEnabled: clRouter !== null,
        clRouterTasks: [...CL_ROUTER_TASK_FLAGS].sort(),
        extractionJobConcurrency: EXTRACTION_JOB_CONCURRENCY,
        previewJobConcurrency: PREVIEW_JOB_CONCURRENCY,
        pdfWorkMaxActive: PDF_WORK_MAX_ACTIVE,
        pdfWorkMaxFullActive: PDF_WORK_MAX_FULL_ACTIVE,
        pdfWorkAdmission: pdfWorkAdmission.snapshot(),
        liteParseNativeConcurrency: LITEPARSE_NATIVE_CONCURRENCY,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/liteparse/convert") {
      handleConvertRequest(req, res).catch((error) => {
        console.error("LiteParse HTTP conversion failed:", error);
        if (!res.headersSent && !res.destroyed && !res.writableEnded) {
          jsonResponse(res, 500, { error: errorMessage(error) });
        }
      });
      return;
    }
    jsonResponse(res, 404, { error: "Not found" });
  });
  server.listen(HTTP_PORT, () => {
    console.log(`LiteParse conversion endpoint listening on port ${HTTP_PORT}`);
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

function jsonByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return json ? Buffer.byteLength(json) : 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function payloadSizeSummary(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} ${formatBytes(jsonByteLength(value))}`)
    .join(", ");
}

const COMPLETION_UPLOAD_ATTEMPTS = 3;
const COMPLETION_ACTION_FALLBACK_MAX_BYTES = 4.5 * 1024 * 1024;

async function uploadCompletionPayload(
  job: ClaimedJob,
  payload: Record<string, unknown>,
): Promise<{ storageId: string; byteLength: number }> {
  const json = JSON.stringify(payload);
  const byteLength = Buffer.byteLength(json);
  let lastError: unknown;

  for (let attempt = 1; attempt <= COMPLETION_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const { uploadUrl } = await convex.action(actions.createExternalCompletionUploadUrl, {
        secret: SECRET,
      });
      const response = await fetch(resolveConvexStorageUrl(uploadUrl, {
        glassEnv: GLASS_ENV,
        convexUrl: CONVEX_URL,
      }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      if (!response.ok) {
        throw new Error(`Failed to upload completion payload: ${response.status} ${await response.text()}`);
      }
      const uploaded = await response.json() as { storageId?: string };
      if (!uploaded.storageId) {
        throw new Error("Completion payload upload did not return a storageId");
      }
      return await convex.action(actions.finalizeExternalCompletionPayload, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
        storageId: uploaded.storageId,
        byteLength,
      });
    } catch (error) {
      lastError = error;
      if (attempt < COMPLETION_UPLOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }

  if (byteLength <= COMPLETION_ACTION_FALLBACK_MAX_BYTES) {
    await logJob(
      job,
      `Direct completion payload upload failed; retrying through Convex action fallback (${formatBytes(byteLength)}): ${errorMessage(lastError)}`,
      "warn",
    );
    return await convex.action(actions.saveExternalCompletionPayload, {
      secret: SECRET,
      policyId: job.policyId,
      leaseId: job.leaseId,
      payload,
    });
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to upload completion payload: ${String(lastError)}`);
}

async function uploadExtractionArtifact(
  job: ClaimedJob,
  args: {
    kind: "source_bundle" | "section_result";
    value: unknown;
    sourceFingerprint: string;
    extractorVersion: string;
    sectionId?: string;
    metadata?: unknown;
  },
) {
  const json = JSON.stringify(args.value);
  let lastError: unknown;
  for (let attempt = 1; attempt <= COMPLETION_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const { uploadUrl } = await convex.action(
        actions.createExternalExtractionArtifactUploadUrl,
        { secret: SECRET },
      );
      const response = await fetch(resolveConvexStorageUrl(uploadUrl, {
        glassEnv: GLASS_ENV,
        convexUrl: CONVEX_URL,
      }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      if (!response.ok) {
        throw new Error(`Failed to upload ${args.kind}: ${response.status} ${await response.text()}`);
      }
      const uploaded = await response.json() as { storageId?: string };
      if (!uploaded.storageId) throw new Error(`${args.kind} upload did not return a storageId`);
      const finalized = await convex.action(actions.finalizeExternalExtractionArtifact, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
        kind: args.kind,
        storageId: uploaded.storageId,
        sourceFingerprint: args.sourceFingerprint,
        extractorVersion: args.extractorVersion,
        sectionId: args.sectionId,
        metadata: args.metadata,
      });
      if (!finalized.ok) throw new Error(`Convex rejected ${args.kind} for ${job.policyId}`);
      return finalized;
    } catch (error) {
      lastError = error;
      if (attempt < COMPLETION_UPLOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to upload ${args.kind}: ${String(lastError)}`);
}

async function loadExtractionArtifact(url: string): Promise<unknown> {
  const response = await fetch(resolveConvexStorageUrl(url, {
    glassEnv: GLASS_ENV,
    convexUrl: CONVEX_URL,
  }));
  if (!response.ok) {
    throw new Error(`Failed to load extraction artifact: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

function sourceBundleFingerprint(sourceSpans: WorkerSourceSpan[]) {
  return stableHash(sourceSpans.map((span) => ({
    id: span.id,
    hash: span.textHash ?? stableHash(span.text),
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
  })));
}

type WorkerSourceBundle = {
  version: "worker-source-bundle-v1";
  protocolVersion: "source-tree-v2";
  extractorVersion: string;
  sourceFingerprint: string;
  parser: "liteparse" | "pdfjs";
  sourceSpans: WorkerSourceSpan[];
  sourceChunks: WorkerSourceChunk[];
  pageScreenshots?: PageScreenshot[];
};

const EXTRACTION_SECTION_IDS = new Set([
  "extraction_policy_core",
  "extraction_policy_coverage",
  "extraction_coverage_cleanup",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExtractionSectionResult(value: unknown): value is ExtractionSectionResult {
  return isRecord(value) &&
    value.version === "extraction-section-result-v1" &&
    typeof value.sectionId === "string" &&
    EXTRACTION_SECTION_IDS.has(value.sectionId) &&
    (value.status === "complete" ||
      value.status === "not_applicable" ||
      value.status === "degraded") &&
    typeof value.sourceFingerprint === "string" &&
    typeof value.extractorVersion === "string" &&
    Array.isArray(value.sourceSpanIds) &&
    value.sourceSpanIds.every((id) => typeof id === "string") &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === "string") &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.operationalProfile === undefined || isRecord(value.operationalProfile)) &&
    typeof value.resultHash === "string";
}

async function loadResumableExtraction(job: ClaimedJob) {
  if (WORKER_PROTOCOL_VERSION !== "source-tree-v2") {
    return {
      sourceBundle: undefined,
      sectionResults: new Map<string, ExtractionSectionResult>(),
    };
  }
  const response = await convex.action(actions.getExternalExtractionResumeArtifacts, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
  });
  if (!response.ok) throw new Error(`Lost external extraction lease for ${job.policyId}`);
  const matching = response.artifacts.filter((artifact) =>
    artifact.extractorVersion === WORKER_CL_SDK_VERSION && artifact.url);
  let sourceBundle: WorkerSourceBundle | undefined;
  const sectionResults = new Map<string, ExtractionSectionResult>();
  for (const artifact of matching) {
    const value = await loadExtractionArtifact(artifact.url!);
    if (artifact.kind === "source_bundle" && !sourceBundle) {
      const candidate = value as Partial<WorkerSourceBundle>;
      if (
        candidate.version === "worker-source-bundle-v1" &&
        candidate.protocolVersion === "source-tree-v2" &&
        candidate.extractorVersion === WORKER_CL_SDK_VERSION &&
        Array.isArray(candidate.sourceSpans) &&
        Array.isArray(candidate.sourceChunks) &&
        candidate.sourceFingerprint === sourceBundleFingerprint(candidate.sourceSpans)
      ) {
        sourceBundle = candidate as WorkerSourceBundle;
      }
    } else if (
      artifact.kind === "section_result" &&
      artifact.sectionId &&
      isExtractionSectionResult(value) &&
      value.sectionId === artifact.sectionId &&
      value.extractorVersion === WORKER_CL_SDK_VERSION
    ) {
      sectionResults.set(value.sectionId, value);
    }
  }
  return { sourceBundle, sectionResults };
}

const HEAVY_PAYLOAD_KEYS = new Set([
  "base64",
  "data",
  "image",
  "imageBase64",
  "images",
  "pageImages",
  "pageScreenshots",
  "pdf",
  "pdfBase64",
  "providerOptions",
  "request",
  "requestBody",
  "sourceChunks",
  "sourceSpans",
  "sourceTree",
]);

function sanitizeCompletionDocument(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeCompletionDocument(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 100_000) {
      return `${value.slice(0, 100_000)}...[truncated ${value.length - 100_000} chars]`;
    }
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (HEAVY_PAYLOAD_KEYS.has(key)) continue;
    const sanitized = sanitizeCompletionDocument(entryValue, depth + 1);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

const PREVIEW_TOP_LEVEL_FIELDS = [
  "documentType",
  "carrier",
  "security",
  "underwriter",
  "generalAgentName",
  "broker",
  "policyNumber",
  "productName",
  "linesOfBusiness",
  "effectiveDate",
  "expirationDate",
  "insuredName",
  "premium",
  "totalCost",
  "summary",
  "limits",
  "deductibles",
  "coverages",
] as const;

const PREVIEW_LIMIT_FIELDS = [
  "perOccurrence",
  "generalAggregate",
  "productsCompletedOpsAggregate",
  "personalAdvertisingInjury",
  "eachEmployee",
  "combinedSingleLimit",
  "umbrellaAggregate",
  "umbrellaRetention",
] as const;

const PREVIEW_DEDUCTIBLE_FIELDS = [
  "perClaim",
  "perOccurrence",
  "aggregateDeductible",
  "selfInsuredRetention",
  "appliesTo",
] as const;

const PREVIEW_COVERAGE_FIELDS = [
  "name",
  "lineOfBusiness",
  "coverageCode",
  "limit",
  "limitType",
  "deductible",
  "deductibleType",
] as const;

const previewExtractionSchema: Parameters<typeof jsonSchema>[0] = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: ["string", "null"], enum: ["policy", null] },
    carrier: { type: ["string", "null"] },
    security: { type: ["string", "null"] },
    underwriter: { type: ["string", "null"] },
    generalAgentName: { type: ["string", "null"] },
    broker: { type: ["string", "null"] },
    policyNumber: { type: ["string", "null"] },
    productName: { type: ["string", "null"] },
    linesOfBusiness: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    effectiveDate: { type: ["string", "null"] },
    expirationDate: { type: ["string", "null"] },
    insuredName: { type: ["string", "null"] },
    premium: { type: ["string", "null"] },
    totalCost: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    limits: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        perOccurrence: { type: ["string", "null"] },
        generalAggregate: { type: ["string", "null"] },
        productsCompletedOpsAggregate: { type: ["string", "null"] },
        personalAdvertisingInjury: { type: ["string", "null"] },
        eachEmployee: { type: ["string", "null"] },
        combinedSingleLimit: { type: ["string", "null"] },
        umbrellaAggregate: { type: ["string", "null"] },
        umbrellaRetention: { type: ["string", "null"] },
      },
      required: [...PREVIEW_LIMIT_FIELDS],
    },
    deductibles: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        perClaim: { type: ["string", "null"] },
        perOccurrence: { type: ["string", "null"] },
        aggregateDeductible: { type: ["string", "null"] },
        selfInsuredRetention: { type: ["string", "null"] },
        appliesTo: { type: ["string", "null"] },
      },
      required: [...PREVIEW_DEDUCTIBLE_FIELDS],
    },
    coverages: {
      type: "array",
      maxItems: POLICY_PREVIEW_MAX_COVERAGES,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          lineOfBusiness: { type: ["string", "null"] },
          coverageCode: { type: ["string", "null"] },
          limit: { type: ["string", "null"] },
          limitType: { type: ["string", "null"] },
          deductible: { type: ["string", "null"] },
          deductibleType: { type: ["string", "null"] },
        },
        required: [...PREVIEW_COVERAGE_FIELDS],
      },
    },
  },
  required: [...PREVIEW_TOP_LEVEL_FIELDS],
};

const previewExtractionOutputSchema =
  jsonSchema<Record<string, unknown>>(previewExtractionSchema);

function previewExtractionOutputSchemaForProvider(provider: string) {
  if (provider !== "fireworks") return previewExtractionOutputSchema;
  return jsonSchema<Record<string, unknown>>(
    normalizeJsonSchemaForFireworks(previewExtractionSchema) as Parameters<
      typeof jsonSchema<Record<string, unknown>>
    >[0],
  );
}

function cleanPreviewString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  if (/^(unknown|not\s*(available|provided|found)|n\/a|null|none)$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed.slice(0, 500);
}

function cleanPreviewParagraph(value: unknown): string | undefined {
  const trimmed = cleanPreviewString(value);
  return trimmed ? trimmed.slice(0, 1000) : undefined;
}

function previewLobCodes(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  const source = values
    .map(cleanPreviewString)
    .filter((value): value is string => Boolean(value));
  return source.length > 0 ? toLobCodes(source).slice(0, 12) : [];
}

function compactRecord(value: unknown, allowedKeys: readonly string[]): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output: Record<string, string> = {};
  for (const key of allowedKeys) {
    const cleaned = cleanPreviewString((value as Record<string, unknown>)[key]);
    if (cleaned) output[key] = cleaned;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizePreviewFields(value: unknown): Record<string, unknown> {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const fields: Record<string, unknown> = {};
  if (input.documentType === "policy") fields.documentType = "policy";
  for (const key of [
    "carrier",
    "security",
    "underwriter",
    "broker",
    "policyNumber",
    "effectiveDate",
    "expirationDate",
    "insuredName",
    "premium",
    "totalCost",
  ]) {
    const cleaned = cleanPreviewString(input[key]);
    if (cleaned) fields[key] = cleaned;
  }
  const generalAgentName = cleanPreviewString(input.generalAgentName);
  if (generalAgentName) {
    fields.generalAgent = { agencyName: generalAgentName };
  }
  const productName = cleanPreviewString(input.productName);
  if (productName) fields.programName = productName;
  const summary = cleanPreviewParagraph(input.summary);
  if (summary) fields.summary = summary;
  const linesOfBusiness = previewLobCodes(input.linesOfBusiness);
  if (linesOfBusiness.length > 0) fields.linesOfBusiness = linesOfBusiness;
  if (Array.isArray(input.coverages)) {
    const coverages = input.coverages
      .map((coverage) => {
        if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
        const row = coverage as Record<string, unknown>;
        const name = cleanPreviewString(row.name);
        if (!name) return null;
        return stripUndefined({
          name,
          lineOfBusiness: cleanPreviewString(row.lineOfBusiness),
          coverageCode: resolveAcordCoverageCode(row.coverageCode, name),
          limit: cleanPreviewString(row.limit),
          limitType: cleanPreviewString(row.limitType),
          deductible: cleanPreviewString(row.deductible),
          deductibleType: cleanPreviewString(row.deductibleType),
        });
      })
      .filter(Boolean)
      .slice(0, POLICY_PREVIEW_MAX_COVERAGES);
    if (coverages.length > 0) fields.coverages = coverages;
  }
  const limits = compactRecord(input.limits, [
    "perOccurrence",
    "generalAggregate",
    "productsCompletedOpsAggregate",
    "personalAdvertisingInjury",
    "eachEmployee",
    "combinedSingleLimit",
    "umbrellaAggregate",
    "umbrellaRetention",
  ]);
  if (limits) fields.limits = limits;
  const deductibles = compactRecord(input.deductibles, [
    "perClaim",
    "perOccurrence",
    "aggregateDeductible",
    "selfInsuredRetention",
    "appliesTo",
  ]);
  if (deductibles) fields.deductibles = deductibles;
  return fields;
}

function previewTextFromSourceSpans(
  sourceSpans: WorkerSourceSpan[],
): string {
  let output = "";
  for (const span of orderSourceSpansForPreview(sourceSpans)) {
    const text = span.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const page = span.pageStart ? `p.${span.pageStart}` : "p.unknown";
    const next = `[${page}] ${text}\n`;
    if (output.length + next.length > POLICY_PREVIEW_TEXT_LIMIT) {
      output += next.slice(0, Math.max(0, POLICY_PREVIEW_TEXT_LIMIT - output.length));
      break;
    }
    output += next;
  }
  return output.trim();
}

async function extractPreviewFields(job: ClaimedPreviewJob, sourceText: string) {
  const route = resolveModelForTaskKind("extraction_preview", job.modelSettings);
  const maxOutputTokens = Math.min(
    maxOutputTokensForRoute(4096, route, "extraction_preview"),
    8192,
  );
  const system = `You extract a fast provisional first read from already-bound insurance policy text.
Return only fields that are explicitly present or strongly implied by the document text.
Leave unknown fields null or empty. Do not invent carriers, dates, limits, policy numbers, insured names, or coverages.
This output is provisional and will be overwritten by a later source-backed extraction.`;
  const prompt = applyCarrierIdentityGuidance(
    `Extract a provisional policy summary from this LiteParse/PDF text.

Use concise display strings for dates, money, limits, deductibles, and coverage names.
Populate generalAgentName only when the document identifies a General Agent, including source labels such as managing general agent, MGA, program administrator, or administrator. Normalize a source-labeled Broker or Agent to Producer; do not use the Producer or insurer name as the General Agent.
Populate productName only from a source-stated carrier product, policy program, or plan name. Preserve the source wording; do not use the policy number, form number, carrier name, ACORD line label, or generic "insurance policy" text.
For linesOfBusiness and coverages[].lineOfBusiness, use only a current ACORD LOBCd from this list: ${ACORD_LOB_CODES.join(", ")}. Travel insurance is TRVL and commercial cyber/privacy liability is CYBER. Use UN only when no more specific code fits. Omit coverages[].lineOfBusiness when a coverage row cannot be assigned to exactly one line.
For coverages[].coverageCode, use ACORD CoverageCd only when the source prints the code or the coverage name has an unambiguous exact match. Otherwise omit it.

Document text:
${sourceText}`,
    "extraction_preview",
  );
  if (clRouter && isClRouterTaskEnabled(
    CL_ROUTER_TASK_FLAGS,
    route.task,
    "extraction_preview",
  )) {
    const routerResult = await generateObjectWithClRouter({
      job,
      task: route.task,
      taskKind: "extraction_preview",
      label: "Extract provisional policy fields",
      prompt,
      system,
      schema: previewExtractionSchema as Record<string, unknown>,
      maxOutputTokens,
      providerOptions: {},
      trace: { phase: "preview", label: "Extract provisional policy fields" },
      modelSettings: job.modelSettings,
      validate: (output) => {
        if (!output || typeof output !== "object" || Array.isArray(output)) {
          throw new ClRouterProtocolError("cl-router returned an invalid preview extraction object");
        }
        return output as Record<string, unknown>;
      },
    });
    if (routerResult) {
      return {
        fields: normalizePreviewFields(routerResult.object),
        route: routerResult.route,
      };
    }
  }
  const callProviderOptions = providerOptionsForModelCall(route, undefined);
  const startedAt = nowMs();
  const label = "Extract provisional policy fields";
  try {
    const result = await withModelCallTimeout(aiGenerateText({
      model: route.model,
      system,
      prompt,
      output: Output.object({
        schema: previewExtractionOutputSchemaForProvider(route.route.provider),
      }),
      maxOutputTokens,
      providerOptions: callProviderOptions,
      abortSignal: modelAbortSignal(),
    }));
    const usage = mapUsage(result.usage);
    await recordModelCallComplete({
      job,
      route,
      label,
      taskKind: "extraction_preview",
      attempt: 1,
      startedAt,
      usage,
      details: modelTraceDetails({
        kind: "generateObject",
        label,
        task: route.task,
        taskKind: "extraction_preview",
        prompt,
        system,
        maxOutputTokens,
        providerOptions: callProviderOptions,
        trace: { phase: "preview", label },
        output: result.output,
        outputKind: "object",
      }),
    });
    return {
      fields: normalizePreviewFields(result.output),
      route,
    };
  } catch (error) {
    await recordModelCallError({
      job,
      route,
      label,
      taskKind: "extraction_preview",
      attempt: 1,
      startedAt,
      error,
      details: modelTraceDetails({
        kind: "generateObject",
        label,
        task: route.task,
        taskKind: "extraction_preview",
        prompt,
        system,
        maxOutputTokens,
        providerOptions: callProviderOptions,
        trace: { phase: "preview", label },
      }),
    });

    const fallback = isMissingApiKeyError(error)
      ? null
      : resolveFallbackModel(route.task, "extraction_preview", route.route, job.modelSettings);
    if (!fallback) throw error;

    logFallback(route, fallback, error);
    const fallbackMaxOutputTokens = Math.min(
      maxOutputTokensForRoute(4096, fallback, "extraction_preview"),
      8192,
    );
    const fallbackProviderOptions = providerOptionsForModelCall(fallback, undefined);
    const fallbackStartedAt = nowMs();
    try {
      const result = await withModelCallTimeout(aiGenerateText({
        model: fallback.model,
        system,
        prompt,
        output: Output.object({
          schema: previewExtractionOutputSchemaForProvider(fallback.route.provider),
        }),
        maxOutputTokens: fallbackMaxOutputTokens,
        providerOptions: fallbackProviderOptions,
        abortSignal: modelAbortSignal(),
      }));
      const usage = mapUsage(result.usage);
      await recordModelCallComplete({
        job,
        route: fallback,
        label,
        taskKind: "extraction_preview",
        attempt: 2,
        startedAt: fallbackStartedAt,
        usage,
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: fallback.task,
          taskKind: "extraction_preview",
          prompt,
          system,
          maxOutputTokens: fallbackMaxOutputTokens,
          providerOptions: fallbackProviderOptions,
          trace: { phase: "preview", label },
          output: result.output,
          outputKind: "object",
        }),
      });
      return {
        fields: normalizePreviewFields(result.output),
        route: fallback,
      };
    } catch (fallbackError) {
      await recordModelCallError({
        job,
        route: fallback,
        label,
        taskKind: "extraction_preview",
        attempt: 2,
        startedAt: fallbackStartedAt,
        error: fallbackError,
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: fallback.task,
          taskKind: "extraction_preview",
          prompt,
          system,
          maxOutputTokens: fallbackMaxOutputTokens,
          providerOptions: fallbackProviderOptions,
          trace: { phase: "preview", label },
        }),
      });
      throw fallbackError;
    }
  }
}

async function completeJob(
  job: ClaimedJob,
  result: ExtractionResult,
  fallbackSource: Awaited<ReturnType<typeof buildPdfSourceSpans>>,
): Promise<void> {
  const resultSourceSpans = result.sourceSpans ?? [];
  const resultSourceChunks = result.sourceChunks ?? [];
  const resultSourceTree = result.sourceTree ?? [];
  const rawSourceSpans = fallbackSource.sourceSpans;
  const rawSourceChunks = fallbackSource.sourceChunks;
  const sourceSpanCandidates: Array<{ id?: unknown }> = resultSourceSpans.length > 0
    ? result.protocolVersion === "source-tree-v2"
      ? resultSourceSpans
      : [...resultSourceSpans, ...rawSourceSpans]
    : rawSourceSpans;
  const sourceChunkCandidates: Array<{ id?: unknown }> = resultSourceChunks.length > 0
    ? result.protocolVersion === "source-tree-v2"
      ? resultSourceChunks
      : [...resultSourceChunks, ...rawSourceChunks]
    : rawSourceChunks;
  const sourceSpans = dedupeById(sourceSpanCandidates);
  const sourceChunks = dedupeById(sourceChunkCandidates);
  const document = sanitizeCompletionDocument(result.document);
  const payload = {
    protocolVersion: result.protocolVersion ?? "source-tree-v1",
    extractorVersion: result.extractorVersion ?? WORKER_CL_SDK_VERSION,
    sections: result.sections,
    completionManifest: result.completionManifest,
    document,
    chunks: result.chunks,
    sourceSpans,
    sourceChunks,
    sourceTree: resultSourceTree,
    operationalProfile: result.operationalProfile,
    coverageRecovery: result.coverageRecovery,
    warnings: result.warnings ?? [],
    tokenUsage: result.tokenUsage,
    performanceReport: result.performanceReport
      ? {
          modelCallCount: result.performanceReport.modelCalls?.length ?? 0,
          totalModelCallDurationMs: result.performanceReport.totalModelCallDurationMs,
        }
      : undefined,
  };
  await logJob(job, `External extraction payload sizes: ${payloadSizeSummary(payload)}`);
  const savedPayload = await uploadCompletionPayload(job, payload);

  const completed = await convex.action(actions.completeExternalExtract, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
    state: job.state,
    payloadStorageId: savedPayload.storageId,
  });
  if (!completed.ok) {
    throw new Error(`Convex rejected completion for ${job.policyId}`);
  }
}

function dedupeById<T extends { id?: unknown }>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id : "";
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    deduped.push(item);
  }
  return deduped;
}

async function supplementPreparedPdfSource(
  pdfBytes: Uint8Array,
  documentId: string,
  preparedSource: {
    sourceSpans: WorkerSourceSpan[];
    sourceChunks: WorkerSourceChunk[];
  },
): Promise<{
  sourceSpans: WorkerSourceSpan[];
  sourceChunks: WorkerSourceChunk[];
  supplementCount: number;
}> {
  const supplemental = await buildPdfTextSupplements({
    pdfBytes,
    documentId,
    sourceKind: "policy_pdf",
    primarySourceSpans: preparedSource.sourceSpans,
  });
  return {
    sourceSpans: dedupeById([
      ...preparedSource.sourceSpans,
      ...supplemental.sourceSpans,
    ]),
    sourceChunks: dedupeById([
      ...preparedSource.sourceChunks,
      ...supplemental.sourceChunks,
    ]),
    supplementCount: supplemental.sourceSpans.length,
  };
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

async function processJob(
  job: ClaimedJob,
  releasePdfWork: () => void,
): Promise<void> {
  console.log(`[${job.policyId}] claimed external extraction job`);
  await logJob(job, `External worker ${WORKER_ID} started extraction`);
  const heartbeatTimer = setInterval(() => {
    heartbeat(job).catch((error) => {
      console.error(`[${job.policyId}] heartbeat failed:`, error);
    });
  }, HEARTBEAT_MS);

  try {
    const replayedCompletion = await convex.action(actions.completeExternalExtractFromStoredPayload, {
      secret: SECRET,
      policyId: job.policyId,
      leaseId: job.leaseId,
      state: job.state,
    });
    if (replayedCompletion.ok) {
      await logJob(job, "Replayed stored external extraction completion payload");
      return;
    }

    const extractStartedAt = nowMs();
    await recordTraceEvent(job, {
      kind: "phase",
      phase: "external_extract",
      label: "external_extract",
      status: "started",
    });
    const resumable = await loadResumableExtraction(job);
    let pdfBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let preparedSource: {
      sourceSpans: WorkerSourceSpan[];
      sourceChunks: WorkerSourceChunk[];
    };
    let pageScreenshots: PageScreenshot[] | undefined;
    if (resumable.sourceBundle) {
      preparedSource = {
        sourceSpans: resumable.sourceBundle.sourceSpans,
        sourceChunks: resumable.sourceBundle.sourceChunks,
      };
      pageScreenshots = resumable.sourceBundle.pageScreenshots;
      await logJob(
        job,
        `Resumed persisted ${resumable.sourceBundle.parser} source bundle without reparsing the PDF`,
      );
    } else {
      pdfBytes = await fetchPdfBytes(job.fileUrl);
      await logJob(job, `External worker fetched PDF (${pdfBytes.byteLength} bytes)`);
      const prepared = await preparePdfSourceWithLiteParseFallback({
        convertWithLiteParse: () => convertPdfWithLiteParse({
          pdfBytes,
          documentId: job.policyId,
          sourceKind: "policy_pdf",
          maxPages: LITEPARSE_MAX_PAGES,
          maxFileSize: LITEPARSE_MAX_FILE_SIZE,
          priority: "full",
        }),
        prepareLiteParseSource: async (converted) => {
          await logJob(
            job,
            `LiteParse parsed PDF in ${converted.metadata.parsingMs ?? 0}ms; prepared ${converted.sourceSpans.length} hierarchical source spans`,
          );
          const supplementedSource = await supplementPreparedPdfSource(
            pdfBytes,
            job.policyId,
            {
              sourceSpans: converted.sourceSpans,
              sourceChunks: converted.sourceChunks,
            },
          );
          if (supplementedSource.supplementCount > 0) {
            await logJob(
              job,
              `Added ${supplementedSource.supplementCount} Poppler text supplement span${supplementedSource.supplementCount === 1 ? "" : "s"} for visible PDF text omitted by LiteParse`,
            );
          }
          return supplementedSource;
        },
        onLiteParseFailure: (error) => logJob(
          job,
          `LiteParse unavailable; falling back to PDF.js source spans (${errorMessage(error)})`,
          "warn",
        ),
        preparePdfJsSource: async () => {
          const pdfJsSource = await buildPdfSourceSpans({
            pdfBytes,
            documentId: job.policyId,
            sourceKind: "policy_pdf",
          });
          const fallbackSource = await supplementPreparedPdfSource(
            pdfBytes,
            job.policyId,
            {
              sourceSpans: pdfJsSource.sourceSpans,
              sourceChunks: pdfJsSource.sourceChunks,
            },
          );
          if (fallbackSource.sourceSpans.length > 0) {
            await logJob(
              job,
              `Prepared ${fallbackSource.sourceSpans.length} PDF.js/Poppler source spans for source-grounded extraction`,
            );
          }
          return fallbackSource;
        },
      });
      preparedSource = prepared.prepared;
      pageScreenshots = prepared.parser === "liteparse"
        ? prepared.converted.pageScreenshots
        : undefined;
      if (WORKER_PROTOCOL_VERSION === "source-tree-v2") {
        const sourceFingerprint = sourceBundleFingerprint(preparedSource.sourceSpans);
        const sourceBundle: WorkerSourceBundle = {
          version: "worker-source-bundle-v1",
          protocolVersion: "source-tree-v2",
          extractorVersion: WORKER_CL_SDK_VERSION,
          sourceFingerprint,
          parser: prepared.parser,
          sourceSpans: preparedSource.sourceSpans,
          sourceChunks: preparedSource.sourceChunks,
          pageScreenshots,
        };
        await uploadExtractionArtifact(job, {
          kind: "source_bundle",
          value: sourceBundle,
          sourceFingerprint,
          extractorVersion: WORKER_CL_SDK_VERSION,
          metadata: {
            artifactRole: "worker_source",
            protocolVersion: WORKER_PROTOCOL_VERSION,
            parser: prepared.parser,
          },
        });
      }
    }
    const extractor = buildWorkerExtractor({
      job,
      log: async (message) => logJob(job, message),
      modelSettings: job.modelSettings,
      pageScreenshots,
    });
    const sectionStore: ExtractionSectionStore | undefined =
      WORKER_PROTOCOL_VERSION === "source-tree-v2"
      ? {
          load: async ({ sectionId, sourceFingerprint, extractorVersion }) => {
            const sectionResult = resumable.sectionResults.get(sectionId);
            return sectionResult?.sourceFingerprint === sourceFingerprint &&
              sectionResult.extractorVersion === extractorVersion
              ? sectionResult
              : undefined;
          },
          save: async (sectionResult) => {
            resumable.sectionResults.set(sectionResult.sectionId, sectionResult);
            await uploadExtractionArtifact(job, {
              kind: "section_result",
              value: sectionResult,
              sourceFingerprint: sectionResult.sourceFingerprint,
              extractorVersion: sectionResult.extractorVersion,
              sectionId: sectionResult.sectionId,
              metadata: {
                status: sectionResult.status,
                resultHash: sectionResult.resultHash,
                protocolVersion: WORKER_PROTOCOL_VERSION,
              },
            });
          },
        }
      : undefined;
    const extractOptions: ExtractOptions = {
      ...(preparedSource.sourceSpans.length > 0
        ? {
            sourceSpans: preparedSource.sourceSpans as unknown as NonNullable<
              ExtractOptions["sourceSpans"]
            >,
          }
        : {}),
      coverageRecovery: job.state.coverageRecovery ?? { enabled: false },
      protocolVersion: WORKER_PROTOCOL_VERSION,
      extractorVersion: WORKER_CL_SDK_VERSION,
      sectionStore,
    };
    const result: ExtractionResult = await extractor.extract(
      pdfBytes,
      job.policyId,
      extractOptions,
    );
    if (
      WORKER_PROTOCOL_VERSION === "source-tree-v2" &&
      (result as ExtractionResult & { protocolVersion?: string }).protocolVersion !== "source-tree-v2"
    ) {
      throw new Error(
        `Configured source-tree-v2 requires a section-capable cl-sdk; ${WORKER_CL_SDK_VERSION} returned the legacy protocol`,
      );
    }
    await recordTraceEvent(job, {
      kind: "phase",
      phase: "external_extract",
      label: "external_extract",
      status: "complete",
      durationMs: nowMs() - extractStartedAt,
    });

    await completeJob(job, result, preparedSource);
    console.log(`[${job.policyId}] completed external extraction`);
  } catch (error) {
    console.error(`[${job.policyId}] extraction failed:`, error);
    await failJob(job, error);
  } finally {
    releasePdfWork();
    clearInterval(heartbeatTimer);
  }
}

async function completePreviewJob(
  job: ClaimedPreviewJob,
  fields: Record<string, unknown>,
  previewModel?: string,
): Promise<void> {
  const completed = await convex.action(actions.completeExternalPreview, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
    state: job.state,
    fields,
    previewVersion: POLICY_PREVIEW_VERSION,
    previewModel,
  });
  if (!completed.ok) {
    throw new Error(`Convex rejected preview completion for ${job.policyId}`);
  }
}

async function failPreviewJob(job: ClaimedPreviewJob, error: unknown): Promise<void> {
  await convex.action(actions.failExternalPreviewJob, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
    state: job.state,
    error: errorMessage(error),
    previewVersion: POLICY_PREVIEW_VERSION,
  });
}

async function heartbeatPreview(job: ClaimedPreviewJob): Promise<AckResult> {
  return await convex.action(actions.heartbeatExternalPreviewJob, {
    secret: SECRET,
    policyId: job.policyId,
    leaseId: job.leaseId,
  });
}

async function processPreviewJob(
  job: ClaimedPreviewJob,
  releasePdfWork: () => void,
): Promise<void> {
  console.log(`[${job.policyId}] claimed external preview extraction job`);
  await logJob(job, `External worker ${WORKER_ID} started provisional extraction`, "info");
  const heartbeatTimer = setInterval(() => {
    heartbeatPreview(job).catch((error) => {
      console.error(`[${job.policyId}] preview heartbeat failed:`, error);
    });
  }, HEARTBEAT_MS);

  try {
    const pdfBytes = await fetchPdfBytes(job.fileUrl);
    let sourceSpans: WorkerSourceSpan[];
    try {
      const converted = await convertPdfWithLiteParse({
        pdfBytes,
        documentId: job.policyId,
        sourceKind: "policy_pdf",
        maxPages: LITEPARSE_MAX_PAGES,
        maxFileSize: LITEPARSE_MAX_FILE_SIZE,
        priority: "preview",
      });
      const supplementedSource = await supplementPreparedPdfSource(
        pdfBytes,
        job.policyId,
        {
          sourceSpans: converted.sourceSpans,
          sourceChunks: converted.sourceChunks,
        },
      );
      sourceSpans = supplementedSource.sourceSpans;
      await logJob(
        job,
        `LiteParse prepared ${converted.sourceSpans.length} spans plus ${supplementedSource.supplementCount} Poppler supplement${supplementedSource.supplementCount === 1 ? "" : "s"} for provisional extraction in ${converted.metadata.parsingMs ?? 0}ms`,
        "info",
      );
    } catch (error) {
      await logJob(
        job,
        `LiteParse unavailable for provisional extraction; falling back to PDF.js source spans (${errorMessage(error)})`,
        "warn",
      );
      const pdfJsSource = await buildPdfSourceSpans({
        pdfBytes,
        documentId: job.policyId,
        sourceKind: "policy_pdf",
      });
      const fallbackSource = await supplementPreparedPdfSource(
        pdfBytes,
        job.policyId,
        {
          sourceSpans: pdfJsSource.sourceSpans,
          sourceChunks: pdfJsSource.sourceChunks,
        },
      );
      sourceSpans = fallbackSource.sourceSpans;
    }

    const sourceText = previewTextFromSourceSpans(sourceSpans);
    if (!sourceText) {
      throw new Error("No text was available for provisional extraction");
    }

    const { fields, route } = await extractPreviewFields(job, sourceText);
    if (Object.keys(fields).length === 0) {
      throw new Error("Provisional extraction returned no usable fields");
    }
    await completePreviewJob(
      job,
      fields,
      `${route.route.provider}/${route.route.model}`,
    );
    console.log(`[${job.policyId}] completed external preview extraction`);
  } catch (error) {
    console.error(`[${job.policyId}] preview extraction failed:`, error);
    await failPreviewJob(job, error);
  } finally {
    releasePdfWork();
    clearInterval(heartbeatTimer);
  }
}

async function claimJob(): Promise<ClaimedJob | null> {
  return await convex.action(actions.claimExternalJob, {
    secret: SECRET,
    workerId: WORKER_ID,
    workerVersion: WORKER_VERSION,
    workerProtocolVersion: WORKER_PROTOCOL_VERSION,
    clSdkVersion: WORKER_CL_SDK_VERSION,
  });
}

async function claimPreviewJob(): Promise<ClaimedPreviewJob | null> {
  return await convex.action(actions.claimExternalPreviewJob, {
    secret: SECRET,
    workerId: WORKER_ID,
    workerVersion: WORKER_VERSION,
    workerProtocolVersion: WORKER_PROTOCOL_VERSION,
    clSdkVersion: WORKER_CL_SDK_VERSION,
  });
}

async function runPreviewLoop(): Promise<void> {
  const active = new Set<Promise<void>>();
  let lastIdleLogAt = 0;
  while (!shuttingDown) {
    if (active.size >= PREVIEW_JOB_CONCURRENCY) {
      await Promise.race(active);
      continue;
    }

    let job: ClaimedPreviewJob | null = null;
    let releasePdfWork: (() => void) | undefined;
    try {
      releasePdfWork = await pdfWorkAdmission.acquire(
        "preview",
        shutdownController.signal,
      );
      if (shuttingDown) {
        releasePdfWork();
        break;
      }
      job = await claimPreviewJob();
    } catch (error) {
      releasePdfWork?.();
      if (
        shuttingDown &&
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        break;
      }
      console.error("Failed to claim preview extraction job:", error);
      await sleep(POLL_MS);
      continue;
    }
    if (job) {
      const task = processPreviewJob(job, releasePdfWork).finally(() => {
        active.delete(task);
      });
      active.add(task);
      continue;
    }
    releasePdfWork();

    const now = nowMs();
    if (now - lastIdleLogAt >= IDLE_LOG_MS) {
      console.log("No preview extraction jobs available");
      lastIdleLogAt = now;
    }
    await sleep(POLL_MS);
  }

  await Promise.allSettled(active);
}

async function main(): Promise<void> {
  console.log(
    `Glass extraction worker ${WORKER_ID} env=${GLASS_ENV} v${WORKER_VERSION} protocol=${WORKER_PROTOCOL_VERSION} cl-sdk=${WORKER_CL_SDK_VERSION} extractionConcurrency=${EXTRACTION_JOB_CONCURRENCY} previewConcurrency=${PREVIEW_JOB_CONCURRENCY} pdfWorkMaxActive=${PDF_WORK_MAX_ACTIVE} pdfWorkMaxFullActive=${PDF_WORK_MAX_FULL_ACTIVE} liteParseNativeConcurrency=${LITEPARSE_NATIVE_CONCURRENCY} connected to ${CONVEX_URL}`,
  );
  const httpServer = startHttpServer();
  if (!RUNTIME_ACCESS.jobsEnabled) {
    console.warn(
      `Extraction job polling and PDF conversion are disabled in Railway environment ${RUNTIME_ACCESS.railwayEnvironment}`,
    );
    try {
      while (!shuttingDown) {
        await sleep(POLL_MS);
      }
    } finally {
      httpServer?.close();
    }
    console.log("Extraction worker shutting down");
    return;
  }
  const previewLoop = runPreviewLoop().catch((error) => {
    console.error("Preview extraction loop failed:", error);
  });
  const active = new Set<Promise<void>>();
  let lastIdleLogAt = 0;
  try {
    while (!shuttingDown) {
      if (active.size >= EXTRACTION_JOB_CONCURRENCY) {
        await Promise.race(active);
        continue;
      }

      let job: ClaimedJob | null = null;
      let releasePdfWork: (() => void) | undefined;
      try {
        releasePdfWork = await pdfWorkAdmission.acquire(
          "full",
          shutdownController.signal,
        );
        if (shuttingDown) {
          releasePdfWork();
          break;
        }
        job = await claimJob();
      } catch (error) {
        releasePdfWork?.();
        if (
          shuttingDown &&
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          break;
        }
        console.error("Failed to claim extraction job:", error);
        await sleep(POLL_MS);
        continue;
      }
      if (job) {
        const task = processJob(job, releasePdfWork).finally(() => {
          active.delete(task);
        });
        active.add(task);
        continue;
      }
      releasePdfWork();

      const now = nowMs();
      if (now - lastIdleLogAt >= IDLE_LOG_MS) {
        console.log("No extraction jobs available");
        lastIdleLogAt = now;
      }
      await sleep(POLL_MS);
    }
  } finally {
    shuttingDown = true;
    shutdownController.abort();
    await Promise.allSettled(active);
    await previewLoop;
    httpServer?.close();
  }
  console.log("Extraction worker shutting down");
}

main().catch((error) => {
  console.error("Extraction worker crashed:", error);
  process.exitCode = 1;
});
