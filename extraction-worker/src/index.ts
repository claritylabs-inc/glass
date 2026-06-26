import dayjs from "dayjs";
import { createRequire } from "module";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Output, generateText as aiGenerateText, gateway, jsonSchema } from "ai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
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
  createExtractor,
  type GenerateObject,
  type GenerateText,
  type ExtractionResult,
  type ExtractionState,
  type ModelCapabilities,
  type ModelTaskKind,
  type PipelineCheckpoint,
} from "@claritylabs/cl-sdk";
import { modelCapabilitiesForRoute } from "./modelCapabilities.js";
import {
  normalizeJsonSchemaForFireworks,
  structuredOutputSchemaForProvider,
} from "./fireworksStructuredOutput.js";
import { buildPdfSourceSpans } from "./pdfSourceSpans.js";
import { convertPdfWithLiteParse, type PageScreenshot } from "./liteparse.js";

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

type ClaimedPreviewJob = Omit<ClaimedJob, "clSdkCheckpoint">;

type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "fireworks"
  | "deepseek";

type ModelTask = "extraction" | "extraction_preview" | "classification";

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
  transport: "direct" | "gateway";
  capabilities: ModelCapabilities;
  providerOptions?: ProviderOptions;
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
  checkpointFileId?: string;
  replayed?: boolean;
};

type CompletionPayloadSaveResult = {
  storageId: string;
  byteLength: number;
  logSaved?: boolean;
  logError?: string;
};

const require = createRequire(import.meta.url);
const workerPackage = require("../package.json") as {
  version?: string;
  dependencies?: Record<string, string>;
};
const WORKER_PROTOCOL_VERSION = "source-tree-v1";

const actions = {
  saveExternalCompletionPayload: makeFunctionReference<
    "action",
    {
      secret: string;
      policyId: string;
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
      checkpoint?: PipelineCheckpoint<ExtractionState>;
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
const POLICY_PREVIEW_VERSION = "policy-preview-v1";
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

function modelAbortSignal() {
  return AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS);
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

function readSourceKind(value: unknown): "policy_pdf" | "application_pdf" | "email" | "attachment" | "manual_note" {
  if (
    value === "policy_pdf"
    || value === "application_pdf"
    || value === "email"
    || value === "attachment"
    || value === "manual_note"
  ) {
    return value;
  }
  return "policy_pdf";
}

const WORKER_STATIC_ROUTES: Record<ModelTask, WorkerModelRoute> = {
  classification: {
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v4-flash",
  },
  extraction: {
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v4-flash",
  },
  extraction_preview: {
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v4-flash",
  },
};

const FIREWORKS_QWEN_37_PLUS = "accounts/fireworks/models/qwen3p7-plus";

const WORKER_VISUAL_TABLE_REPAIR_ROUTE: WorkerModelRoute = {
  provider: "fireworks",
  model: FIREWORKS_QWEN_37_PLUS,
};

const WORKER_FORM_INVENTORY_ROUTE: WorkerModelRoute = {
  provider: "fireworks",
  model: FIREWORKS_QWEN_37_PLUS,
};

const WORKER_QUALITY_ROUTE: WorkerModelRoute = {
  provider: "fireworks",
  model: "accounts/fireworks/models/glm-5p2",
};

const WORKER_FALLBACK_ROUTE: WorkerModelRoute = {
  provider: "openai",
  model: "gpt-5.5",
};

const WORKER_MODEL_PROVIDERS = new Set<ModelProvider>([
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "cohere",
  "fireworks",
  "deepseek",
]);

const QUALITY_ESCALATION_TASK_KINDS = new Set<string>([
  "extraction_source_tree",
  "extraction_operational_profile",
  "extraction_review",
  "extraction_referential_lookup",
]);
const QUALITY_PRIMARY_TASK_KINDS = new Set<string>([
  "extraction_source_tree",
  "extraction_operational_profile",
]);
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

function directProviderApiKey(provider: ModelProvider): string | undefined {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "google":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;
    case "xai":
      return process.env.XAI_API_KEY;
    case "mistral":
      return process.env.MISTRAL_API_KEY;
    case "cohere":
      return process.env.COHERE_API_KEY;
    case "fireworks":
      return process.env.FIREWORKS_API_KEY;
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
  }
}

function gatewayModelId(route: WorkerModelRoute): string {
  if (route.provider === "fireworks") return `fireworks/${route.model}`;
  return route.model.includes("/") ? route.model : `${route.provider}/${route.model}`;
}

function nativeProviderModel(route: WorkerModelRoute): string | null {
  switch (route.provider) {
    case "anthropic":
      if (route.model === "claude-3-haiku") return "claude-3-haiku-20240307";
      return route.model.replace(/\.(\d+)/g, "-$1");
    case "deepseek":
      return route.model === "deepseek-chat" || route.model === "deepseek-reasoner"
        ? route.model
        : null;
    case "fireworks":
      return route.model;
    default:
      return route.model;
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

function routeTransport(route: WorkerModelRoute, apiKey?: string): "direct" | "gateway" {
  const nativeModel = nativeProviderModel(route);
  const canUseDirectProvider = !!nativeModel && !!(apiKey || directProviderApiKey(route.provider));
  return canUseDirectProvider ? "direct" : "gateway";
}

function routeToModel(route: WorkerModelRoute, apiKey?: string): LanguageModel {
  const nativeModel = nativeProviderModel(route);
  if (apiKey && nativeModel) {
    return providerModel(route.provider, nativeModel, apiKey);
  }
  if (nativeModel && directProviderApiKey(route.provider)) {
    return providerModel(route.provider, nativeModel);
  }
  return gateway(gatewayModelId(route));
}

function modelTaskForTaskKind(taskKind?: string): ModelTask {
  if (taskKind === "extraction_preview") return "extraction_preview";
  if (taskKind === "extraction_classify") return "classification";
  return "extraction";
}

function apiKeyForRoute(
  route: WorkerModelRoute,
  routeSource: WorkerRouteSource,
  settings?: WorkerModelSettings,
): string | undefined {
  if (routeSource === "broker" || routeSource === "configured") {
    return settings?.providerKeys?.[route.provider];
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
  const hasRequiredBrokerKey =
    configuredRouteSource !== "broker" ||
    !!(configuredRoute && settings?.providerKeys?.[configuredRoute.provider]);
  if (configuredRoute && hasRequiredBrokerKey) {
    const routeSource = configuredRouteSource ?? "configured";
    return {
      route: configuredRoute,
      routeSource,
      apiKey: apiKeyForRoute(configuredRoute, routeSource, settings),
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

function isVisualTableRepairTrace(trace: ModelCallTrace | undefined): boolean {
  return typeof trace?.label === "string" && trace.label.startsWith("source_tree_visual_table_repair_");
}

function resolveConfiguredVisualTableRepairRoute(settings?: WorkerModelSettings) {
  const configured = resolveConfiguredRoute(
    "extraction_visual_table_repair",
    WORKER_VISUAL_TABLE_REPAIR_ROUTE,
    "static",
    settings,
  );
  return routeSupportsImageInput(configured.route)
    ? configured
    : { route: WORKER_VISUAL_TABLE_REPAIR_ROUTE, routeSource: "static" as const };
}

function resolveConfiguredFormInventoryRoute(settings?: WorkerModelSettings) {
  return resolveConfiguredRoute(
    "extraction_form_inventory",
    WORKER_FORM_INVENTORY_ROUTE,
    "static",
    settings,
  );
}

function resolveModelForTaskKind(
  taskKind: string | undefined,
  settings?: WorkerModelSettings,
  trace?: ModelCallTrace,
): ResolvedWorkerModelRoute {
  const task = modelTaskForTaskKind(taskKind);
  const settingsRoute = settings?.routes?.[task];
  const configuredRoute = isWorkerModelRoute(settingsRoute) ? settingsRoute : undefined;
  const configuredRouteSource = readRouteSource(settings?.routeSources?.[task]);
  const hasRequiredBrokerKey =
    configuredRouteSource !== "broker" ||
    !!(configuredRoute && settings?.providerKeys?.[configuredRoute.provider]);
  const canUseConfiguredRoute = !!configuredRoute && hasRequiredBrokerKey;
  const baseRoute = canUseConfiguredRoute ? configuredRoute : WORKER_STATIC_ROUTES[task];
  const quality = resolveConfiguredQualityRoute(settings);
  const useQualityPrimary =
    !!taskKind && QUALITY_PRIMARY_TASK_KINDS.has(taskKind) && !sameRoute(baseRoute, quality.route);
  const visualRepair = isVisualTableRepairTrace(trace)
    ? resolveConfiguredVisualTableRepairRoute(settings)
    : null;
  const formInventory = taskKind === "extraction_form_inventory"
    ? resolveConfiguredFormInventoryRoute(settings)
    : null;
  const route = visualRepair?.route ?? formInventory?.route ?? (useQualityPrimary ? quality.route : baseRoute);
  const routeSource = visualRepair?.routeSource ?? formInventory?.routeSource ?? (useQualityPrimary
    ? quality.routeSource
    : canUseConfiguredRoute
    ? (configuredRouteSource ?? "configured")
    : "default");
  const apiKey = visualRepair
    ? visualRepair.apiKey
    : formInventory
      ? formInventory.apiKey
    : useQualityPrimary
      ? quality.apiKey
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

function sameRoute(left: WorkerModelRoute, right: WorkerModelRoute): boolean {
  return left.provider === right.provider && left.model === right.model;
}

function resolveFallbackModel(
  task: ModelTask,
  taskKind: string | undefined,
  primaryRoute: WorkerModelRoute,
  settings?: WorkerModelSettings,
  trace?: ModelCallTrace,
): ResolvedWorkerModelRoute | null {
  if (isVisualTableRepairTrace(trace)) return null;

  if (task === "classification" || task === "extraction") {
    if (!taskKind || !QUALITY_ESCALATION_TASK_KINDS.has(taskKind)) return null;
  }
  const fallback = resolveConfiguredFallbackRoute(settings);
  if (sameRoute(primaryRoute, fallback.route)) return null;
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

function modelRouteTrace(route: ResolvedWorkerModelRoute) {
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
    route: ResolvedWorkerModelRoute;
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

async function recordModelCallComplete(
  opts: {
    job: Pick<ClaimedJob, "state">;
    route: ResolvedWorkerModelRoute;
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

function shouldReturnEmptyFormInventory(taskKind: string | undefined): boolean {
  return taskKind === "extraction_form_inventory";
}

function shouldReturnEmptyVisualTableRepair(trace: ModelCallTrace | undefined): boolean {
  return isVisualTableRepairTrace(trace);
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
    extraction_form_inventory: "Extract form inventory",
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
  return (
    route.model === FIREWORKS_QWEN_37_PLUS ||
    route.provider === "openai" ||
    route.provider === "anthropic" ||
    route.provider === "google" ||
    route.provider === "xai"
  );
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
  pageScreenshots?: PageScreenshot[];
}) {
  const generateText: GenerateText = async (params) => {
    const taskKind = readTaskKind(params);
    const trace = readTraceDetails(params);
    const guidedPrompt = addPolicyPeriodGuidance(params.prompt);
    const providerOptions = enrichProviderOptions(params.providerOptions, opts.pageScreenshots, trace);
    const route = resolveModelForTaskKind(taskKind, opts.modelSettings, trace);
    const label = modelTraceLabel("generateText", taskKind, route.task, trace);
    const maxOutputTokens = maxOutputTokensForRoute(params.maxTokens, route, taskKind);
    const callProviderOptions = providerOptionsForModelCall(
      route,
      providerOptions as ProviderOptions | undefined,
    );
    const startedAt = nowMs();
    try {
      const result = await aiGenerateText({
        model: route.model,
        system: params.system,
        ...buildPromptInput(guidedPrompt, providerOptions, route.route),
        maxOutputTokens,
        providerOptions: callProviderOptions,
        abortSignal: modelAbortSignal(),
      });
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
          kind: "generateText",
          label,
          task: route.task,
          taskKind,
          prompt: guidedPrompt,
          system: params.system,
          maxOutputTokens,
          providerOptions: callProviderOptions,
          trace,
          output: result.text,
          outputKind: "text",
        }),
      });
      return {
        text: result.text,
        usage,
      };
    } catch (error) {
      await recordModelCallError({
        job: opts.job,
        route,
        label,
        taskKind,
        attempt: 1,
        startedAt,
        error,
        details: modelTraceDetails({
          kind: "generateText",
          label,
          task: route.task,
          taskKind,
          prompt: guidedPrompt,
          system: params.system,
          maxOutputTokens,
          providerOptions: callProviderOptions,
          trace,
        }),
      });

      const fallback = isMissingApiKeyError(error)
        ? null
        : resolveFallbackModel(route.task, taskKind, route.route, opts.modelSettings, trace);
      if (!fallback) throw error;

      logFallback(route, fallback, error);
      const fallbackMaxOutputTokens = maxOutputTokensForRoute(params.maxTokens, fallback, taskKind);
      const fallbackProviderOptions = providerOptionsForModelCall(
        fallback,
        providerOptions as ProviderOptions | undefined,
      );
      const fallbackStartedAt = nowMs();
      try {
        const fallbackResult = await aiGenerateText({
          model: fallback.model,
          system: params.system,
          ...buildPromptInput(guidedPrompt, providerOptions, fallback.route),
          maxOutputTokens: fallbackMaxOutputTokens,
          providerOptions: fallbackProviderOptions,
          abortSignal: modelAbortSignal(),
        });
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
            kind: "generateText",
            label,
            task: fallback.task,
            taskKind,
            prompt: guidedPrompt,
            system: params.system,
            maxOutputTokens: fallbackMaxOutputTokens,
            providerOptions: fallbackProviderOptions,
            trace,
            output: fallbackResult.text,
            outputKind: "text",
          }),
        });
        return {
          text: fallbackResult.text,
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
            kind: "generateText",
            label,
            task: fallback.task,
            taskKind,
            prompt: guidedPrompt,
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

  const generateObject: GenerateObject = async (params) => {
    const taskKind = readTaskKind(params);
    const trace = readTraceDetails(params);
    const guidedPrompt = addPolicyPeriodGuidance(params.prompt);
    const providerOptions = enrichProviderOptions(params.providerOptions, opts.pageScreenshots, trace);
    const route = resolveModelForTaskKind(taskKind, opts.modelSettings, trace);
    const label = modelTraceLabel("generateObject", taskKind, route.task, trace);
    const maxOutputTokens = maxOutputTokensForRoute(params.maxTokens, route, taskKind);
    const callProviderOptions = providerOptionsForModelCall(
      route,
      providerOptions as ProviderOptions | undefined,
    );
    const startedAt = nowMs();
    try {
      const result = await aiGenerateText({
        model: route.model,
        system: params.system,
        ...buildPromptInput(guidedPrompt, providerOptions, route.route),
        output: Output.object({
          schema: structuredOutputSchemaForProvider(params.schema, route.route.provider),
        }),
        maxOutputTokens,
        providerOptions: callProviderOptions,
        abortSignal: modelAbortSignal(),
      });
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
          prompt: guidedPrompt,
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
      if (shouldReturnEmptySections(guidedPrompt, error)) {
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
            prompt: guidedPrompt,
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

      if (shouldReturnEmptyFormInventory(taskKind)) {
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
            prompt: guidedPrompt,
            system: params.system,
            maxOutputTokens,
            providerOptions: callProviderOptions,
            trace,
            output: { forms: [] },
            outputKind: "object",
          }),
        });
        return { object: { forms: [] }, usage: undefined };
      }

      if (shouldReturnEmptyVisualTableRepair(trace)) {
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
            prompt: guidedPrompt,
            system: params.system,
            maxOutputTokens,
            providerOptions: callProviderOptions,
            trace,
            output: { tables: [], warnings: [] },
            outputKind: "object",
          }),
        });
        return { object: { tables: [], warnings: [] }, usage: undefined };
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
          prompt: guidedPrompt,
          system: params.system,
          maxOutputTokens,
          providerOptions: callProviderOptions,
          trace,
        }),
      });

      const fallback = isMissingApiKeyError(error)
        ? null
        : resolveFallbackModel(route.task, taskKind, route.route, opts.modelSettings, trace);
      if (!fallback) throw error;

      logFallback(route, fallback, error);
      const fallbackMaxOutputTokens = maxOutputTokensForRoute(params.maxTokens, fallback, taskKind);
      const fallbackProviderOptions = providerOptionsForModelCall(
        fallback,
        providerOptions as ProviderOptions | undefined,
      );
      const fallbackStartedAt = nowMs();
      try {
        const fallbackResult = await aiGenerateText({
          model: fallback.model,
          system: params.system,
          ...buildPromptInput(guidedPrompt, providerOptions, fallback.route),
          output: Output.object({
            schema: structuredOutputSchemaForProvider(params.schema, fallback.route.provider),
          }),
          maxOutputTokens: fallbackMaxOutputTokens,
          providerOptions: fallbackProviderOptions,
          abortSignal: modelAbortSignal(),
        });
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
            prompt: guidedPrompt,
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
            prompt: guidedPrompt,
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

  const concurrency = readBoundedIntEnv("EXTRACTION_CONCURRENCY", 6, 1, 8);
  const extractionRoute = resolveModelForTaskKind("extraction_focused", opts.modelSettings);
  return createExtractor({
    generateText,
    generateObject,
    concurrency,
    pageMapConcurrency: readBoundedIntEnv("EXTRACTION_PAGE_MAP_CONCURRENCY", concurrency, 1, 8),
    extractorConcurrency: readBoundedIntEnv("EXTRACTION_EXTRACTOR_CONCURRENCY", concurrency, 1, 8),
    formatConcurrency: readBoundedIntEnv("EXTRACTION_FORMAT_CONCURRENCY", concurrency, 1, 8),
    maxReviewRounds: readBoundedIntEnv("EXTRACTION_MAX_REVIEW_ROUNDS", 1, 0, 2),
    reviewMode: readReviewModeEnv("EXTRACTION_REVIEW_MODE", "skip"),
    log: opts.log,
    onProgress: opts.log,
    onCheckpointSave: opts.onCheckpointSave,
    modelCapabilities: extractionRoute.capabilities,
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
  try {
    await convex.action(actions.logExternalJob, {
      secret: SECRET,
      policyId: job.policyId,
      message,
      phase: "worker",
      level,
    });
  } catch (error) {
    console.warn(`[${job.policyId}] failed to append extraction log: ${errorMessage(error)}`);
  }
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
  const converted = await convertPdfWithLiteParse({
    pdfBytes,
    documentId: typeof body.documentId === "string" ? body.documentId : "inline-pdf",
    sourceKind: readSourceKind(body.sourceKind),
    maxPages: LITEPARSE_MAX_PAGES,
    maxFileSize: LITEPARSE_MAX_FILE_SIZE,
  });
  jsonResponse(res, 200, {
    ok: true,
    text: converted.text,
    sourceSpans: converted.sourceSpans,
    sourceChunks: converted.sourceChunks,
    pageScreenshots: converted.pageScreenshots,
    metadata: converted.metadata,
  });
}

function startHttpServer(): { close: () => void } | null {
  if (!HTTP_PORT) return null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      jsonResponse(res, 200, {
        ok: true,
        workerId: WORKER_ID,
        workerVersion: WORKER_VERSION,
        workerProtocolVersion: WORKER_PROTOCOL_VERSION,
        clSdkVersion: WORKER_CL_SDK_VERSION,
        glassEnv: GLASS_ENV,
        convexUrl: CONVEX_URL,
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
        gitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
        gitBranch: process.env.RAILWAY_GIT_BRANCH,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/liteparse/convert") {
      handleConvertRequest(req, res).catch((error) => {
        console.error("LiteParse HTTP conversion failed:", error);
        jsonResponse(res, 500, { error: errorMessage(error) });
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
      const response = await fetch(uploadUrl, {
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
      payload,
    });
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to upload completion payload: ${String(lastError)}`);
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
  "mga",
  "broker",
  "policyNumber",
  "quoteNumber",
  "policyTypes",
  "effectiveDate",
  "expirationDate",
  "proposedEffectiveDate",
  "proposedExpirationDate",
  "quoteExpirationDate",
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
  "coverageCode",
  "limit",
  "limitType",
  "deductible",
  "deductibleType",
  "originalContent",
] as const;

const previewExtractionSchema: Parameters<typeof jsonSchema>[0] = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: ["string", "null"], enum: ["policy", "quote", null] },
    carrier: { type: ["string", "null"] },
    security: { type: ["string", "null"] },
    underwriter: { type: ["string", "null"] },
    mga: { type: ["string", "null"] },
    broker: { type: ["string", "null"] },
    policyNumber: { type: ["string", "null"] },
    quoteNumber: { type: ["string", "null"] },
    policyTypes: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    effectiveDate: { type: ["string", "null"] },
    expirationDate: { type: ["string", "null"] },
    proposedEffectiveDate: { type: ["string", "null"] },
    proposedExpirationDate: { type: ["string", "null"] },
    quoteExpirationDate: { type: ["string", "null"] },
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
          coverageCode: { type: ["string", "null"] },
          limit: { type: ["string", "null"] },
          limitType: { type: ["string", "null"] },
          deductible: { type: ["string", "null"] },
          deductibleType: { type: ["string", "null"] },
          originalContent: { type: ["string", "null"] },
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
  const documentType = input.documentType === "quote" || input.documentType === "policy"
    ? input.documentType
    : undefined;
  if (documentType) fields.documentType = documentType;
  for (const key of [
    "carrier",
    "security",
    "underwriter",
    "mga",
    "broker",
    "policyNumber",
    "quoteNumber",
    "effectiveDate",
    "expirationDate",
    "proposedEffectiveDate",
    "proposedExpirationDate",
    "quoteExpirationDate",
    "insuredName",
    "premium",
    "totalCost",
  ]) {
    const cleaned = cleanPreviewString(input[key]);
    if (cleaned) fields[key] = cleaned;
  }
  const summary = cleanPreviewParagraph(input.summary);
  if (summary) fields.summary = summary;
  if (Array.isArray(input.policyTypes)) {
    const policyTypes = Array.from(
      new Set(
        input.policyTypes
          .map(cleanPreviewString)
          .filter((item): item is string => Boolean(item))
          .map((item) => item.toLowerCase().replace(/\s+/g, "_")),
      ),
    ).slice(0, 12);
    if (policyTypes.length > 0) fields.policyTypes = policyTypes;
  }
  if (Array.isArray(input.coverages)) {
    const coverages = input.coverages
      .map((coverage) => {
        if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
        const row = coverage as Record<string, unknown>;
        const name = cleanPreviewString(row.name);
        if (!name) return null;
        return stripUndefined({
          name,
          coverageCode: cleanPreviewString(row.coverageCode),
          limit: cleanPreviewString(row.limit),
          limitType: cleanPreviewString(row.limitType),
          deductible: cleanPreviewString(row.deductible),
          deductibleType: cleanPreviewString(row.deductibleType),
          originalContent: cleanPreviewParagraph(row.originalContent),
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

function previewTextFromSourceSpans(sourceSpans: Array<Record<string, unknown>>): string {
  let output = "";
  for (const span of sourceSpans) {
    const text = typeof span.text === "string" ? span.text.replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    const page = typeof span.pageStart === "number" ? `p.${span.pageStart}` : "p.unknown";
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
  const system = `You extract a fast provisional first read from insurance policy or quote text.
Return only fields that are explicitly present or strongly implied by the document text.
Leave unknown fields null or empty. Do not invent carriers, dates, limits, policy numbers, insured names, or coverages.
This output is provisional and will be overwritten by a later source-backed extraction.`;
  const prompt = `Extract a provisional policy summary from this LiteParse/PDF text.

Use concise display strings for dates, money, limits, deductibles, and coverage names.
For policyTypes, use compact lowercase insurance line names such as general_liability, cyber, professional_liability, workers_comp, auto, umbrella, property, crime, fiduciary, d_and_o, epli, other.

Document text:
${sourceText}`;
  const callProviderOptions = providerOptionsForModelCall(route, undefined);
  const startedAt = nowMs();
  const label = "Extract provisional policy fields";
  try {
    const result = await aiGenerateText({
      model: route.model,
      system,
      prompt,
      output: Output.object({
        schema: previewExtractionOutputSchemaForProvider(route.route.provider),
      }),
      maxOutputTokens,
      providerOptions: callProviderOptions,
      abortSignal: modelAbortSignal(),
    });
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
      const result = await aiGenerateText({
        model: fallback.model,
        system,
        prompt,
        output: Output.object({
          schema: previewExtractionOutputSchemaForProvider(fallback.route.provider),
        }),
        maxOutputTokens: fallbackMaxOutputTokens,
        providerOptions: fallbackProviderOptions,
        abortSignal: modelAbortSignal(),
      });
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
  const resultSourceSpans = Array.isArray((result as unknown as { sourceSpans?: unknown[] }).sourceSpans)
    ? (result as unknown as { sourceSpans: Array<Record<string, unknown>> }).sourceSpans
    : [];
  const resultSourceChunks = Array.isArray((result as unknown as { sourceChunks?: unknown[] }).sourceChunks)
    ? (result as unknown as { sourceChunks: Array<Record<string, unknown>> }).sourceChunks
    : [];
  const resultSourceTree = Array.isArray((result as unknown as { sourceTree?: unknown[] }).sourceTree)
    ? (result as unknown as { sourceTree: Array<Record<string, unknown>> }).sourceTree
    : [];
  const operationalProfile = (result as unknown as { operationalProfile?: unknown }).operationalProfile;
  const warnings = Array.isArray((result as unknown as { warnings?: unknown[] }).warnings)
    ? (result as unknown as { warnings: unknown[] }).warnings.filter((item): item is string => typeof item === "string")
    : [];

  const rawSourceSpans = fallbackSource.sourceSpans as unknown as Array<Record<string, unknown>>;
  const rawSourceChunks = fallbackSource.sourceChunks as unknown as Array<Record<string, unknown>>;
  const sourceSpans = dedupeById(resultSourceSpans.length > 0
    ? [...resultSourceSpans, ...rawSourceSpans]
    : rawSourceSpans);
  const sourceChunks = dedupeById(resultSourceChunks.length > 0
    ? [...resultSourceChunks, ...rawSourceChunks]
    : rawSourceChunks);
  const document = sanitizeCompletionDocument(result.document);
  const payload = {
    document,
    chunks: result.chunks,
    sourceSpans,
    sourceChunks,
    sourceTree: resultSourceTree,
    operationalProfile,
    warnings,
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

function dedupeById<T extends Record<string, unknown>>(items: T[]): T[] {
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

    const pdfBytes = await fetchPdfBytes(job.fileUrl);
    await logJob(job, `External worker fetched PDF (${pdfBytes.byteLength} bytes)`);

    if (job.clSdkCheckpoint) {
      await logJob(job, `Resuming extraction from cl-sdk phase "${job.clSdkCheckpoint.phase}"`);
    }

    let result: ExtractionResult;
    let preparedSource: Awaited<ReturnType<typeof buildPdfSourceSpans>>;
    const extractStartedAt = nowMs();
    await recordTraceEvent(job, {
      kind: "phase",
      phase: "external_extract",
      label: "external_extract",
      status: "started",
    });
    try {
      const converted = await convertPdfWithLiteParse({
        pdfBytes,
        documentId: job.policyId,
        sourceKind: "policy_pdf",
        maxPages: LITEPARSE_MAX_PAGES,
        maxFileSize: LITEPARSE_MAX_FILE_SIZE,
      });
      await logJob(
        job,
        `LiteParse parsed PDF in ${converted.metadata.parsingMs ?? 0}ms; prepared ${converted.sourceSpans.length} hierarchical source spans`,
      );
      const extractor = buildWorkerExtractor({
        job,
        log: async (message) => logJob(job, message),
        onCheckpointSave: async (checkpoint) => {
          await saveCheckpoint(job, checkpoint);
        },
        modelSettings: job.modelSettings,
        pageScreenshots: converted.pageScreenshots,
      });
      preparedSource = {
        sourceSpans: converted.sourceSpans as Awaited<ReturnType<typeof buildPdfSourceSpans>>["sourceSpans"],
        sourceChunks: converted.sourceChunks as Awaited<ReturnType<typeof buildPdfSourceSpans>>["sourceChunks"],
      };
      result = await extractor.extract(
        pdfBytes,
        job.policyId,
        {
          ...(job.clSdkCheckpoint ? { resumeFrom: job.clSdkCheckpoint } : {}),
          ...(converted.sourceSpans.length > 0
            ? { sourceSpans: converted.sourceSpans as unknown as Array<Record<string, unknown>> }
            : {}),
        },
      );
    } catch (error) {
      await logJob(
        job,
        `LiteParse unavailable; falling back to PDF.js source spans (${errorMessage(error)})`,
        "warn",
      );
      preparedSource = await buildPdfSourceSpans({
        pdfBytes,
        documentId: job.policyId,
        sourceKind: "policy_pdf",
      });
      if (preparedSource.sourceSpans.length > 0) {
        await logJob(job, `Prepared ${preparedSource.sourceSpans.length} PDF.js source spans for source-grounded extraction`);
      }
      const extractor = buildWorkerExtractor({
        job,
        log: async (message) => logJob(job, message),
        onCheckpointSave: async (checkpoint) => {
          await saveCheckpoint(job, checkpoint);
        },
        modelSettings: job.modelSettings,
      });
      result = await extractor.extract(
        pdfBytes,
        job.policyId,
        {
          ...(job.clSdkCheckpoint ? { resumeFrom: job.clSdkCheckpoint } : {}),
          ...(preparedSource.sourceSpans.length > 0
            ? { sourceSpans: preparedSource.sourceSpans as unknown as Array<Record<string, unknown>> }
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

    await completeJob(job, result, preparedSource);
    console.log(`[${job.policyId}] completed external extraction`);
  } catch (error) {
    console.error(`[${job.policyId}] extraction failed:`, error);
    await failJob(job, error);
  } finally {
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

async function processPreviewJob(job: ClaimedPreviewJob): Promise<void> {
  console.log(`[${job.policyId}] claimed external preview extraction job`);
  await logJob(job, `External worker ${WORKER_ID} started provisional extraction`, "info");
  const heartbeatTimer = setInterval(() => {
    heartbeatPreview(job).catch((error) => {
      console.error(`[${job.policyId}] preview heartbeat failed:`, error);
    });
  }, HEARTBEAT_MS);

  try {
    const pdfBytes = await fetchPdfBytes(job.fileUrl);
    let sourceSpans: Array<Record<string, unknown>>;
    try {
      const converted = await convertPdfWithLiteParse({
        pdfBytes,
        documentId: job.policyId,
        sourceKind: "policy_pdf",
        maxPages: LITEPARSE_MAX_PAGES,
        maxFileSize: LITEPARSE_MAX_FILE_SIZE,
      });
      sourceSpans = converted.sourceSpans as Array<Record<string, unknown>>;
      await logJob(
        job,
        `LiteParse prepared ${sourceSpans.length} spans for provisional extraction in ${converted.metadata.parsingMs ?? 0}ms`,
        "info",
      );
    } catch (error) {
      await logJob(
        job,
        `LiteParse unavailable for provisional extraction; falling back to PDF.js source spans (${errorMessage(error)})`,
        "warn",
      );
      const fallbackSource = await buildPdfSourceSpans({
        pdfBytes,
        documentId: job.policyId,
        sourceKind: "policy_pdf",
      });
      sourceSpans = fallbackSource.sourceSpans as unknown as Array<Record<string, unknown>>;
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
    try {
      job = await claimPreviewJob();
    } catch (error) {
      console.error("Failed to claim preview extraction job:", error);
      await sleep(POLL_MS);
      continue;
    }
    if (job) {
      const task = processPreviewJob(job).finally(() => {
        active.delete(task);
      });
      active.add(task);
      continue;
    }

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
    `Glass extraction worker ${WORKER_ID} v${WORKER_VERSION} protocol=${WORKER_PROTOCOL_VERSION} cl-sdk=${WORKER_CL_SDK_VERSION} connected to ${CONVEX_URL}`,
  );
  const httpServer = startHttpServer();
  const previewLoop = runPreviewLoop().catch((error) => {
    console.error("Preview extraction loop failed:", error);
  });
  let lastIdleLogAt = 0;
  try {
    while (!shuttingDown) {
      let job: ClaimedJob | null = null;
      try {
        job = await claimJob();
      } catch (error) {
        console.error("Failed to claim extraction job:", error);
        await sleep(POLL_MS);
        continue;
      }
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
    shuttingDown = true;
    await previewLoop;
    httpServer?.close();
  }
  console.log("Extraction worker shutting down");
}

main().catch((error) => {
  console.error("Extraction worker crashed:", error);
  process.exitCode = 1;
});
