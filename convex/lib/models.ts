"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, type LanguageModel, type LanguageModelUsage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  fallbackRouteForCall as policyFallbackRouteForCall,
  modelTaskForCall as policyModelTaskForCall,
  primaryRouteForCall as policyPrimaryRouteForCall,
} from "@claritylabs/cl-router-policy";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { structuredOutputSchemaForRoute } from "./fireworksStructuredOutput";
import {
  ClRouterRequestError,
  clRouterGenerate,
  clRouterTranscribe,
  shouldUseClRouterForCall,
  shouldUseClRouterForTask,
  withClRouterDirectFallback,
  type ClRouterAssetReference,
  type ClRouterGenerateRequest,
  type ClRouterFailureAttempt,
  type ClRouterMessage,
  type ClRouterResponseMetadata,
  type ClRouterSettingsSnapshot,
  type ClRouterUsage,
} from "./clRouterClient";
import {
  ClRouterVisibleOutputError,
  createClRouterLanguageModel,
  type ClRouterLanguageModelOptions,
} from "./clRouterLanguageModel";
import {
  EXTRACTION_QUALITY_MODEL,
  FALLBACK_MODEL,
  COVERAGE_CLEANUP_MODEL,
  FIREWORKS_MODEL_IDS,
  MODEL_ROUTING,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  directProviderModelForRoute,
  modelRouteSupportsTask,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./modelCatalog";
import { collectToolAudit, type AgentToolAudit } from "./agentToolAudit";

/**
 * Centralized model configuration for Spot.
 *
 * Maps each task type to a provider + model. Tune costs and quality from one place.
 * All models accessed via Vercel AI SDK's provider-agnostic interface.
 *
 * Env vars needed:
 *   FIREWORKS_API_KEY — direct Fireworks access for default Spot language routes
 *   OPENAI_API_KEY — direct OpenAI access for embedding routes during the migration
 *
 * Spot model routing is direct-provider only. Vercel AI Gateway is not a
 * fallback for language, extraction, embedding, or web retrieval routes.
 */

// Lazy provider factories
let _anthropic: ReturnType<typeof createAnthropic> | null = null;
let _openai: ReturnType<typeof createOpenAI> | null = null;
let _deepseek: ReturnType<typeof createDeepSeek> | null = null;
let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let _xai: ReturnType<typeof createXai> | null = null;
let _mistral: ReturnType<typeof createMistral> | null = null;
let _cohere: ReturnType<typeof createCohere> | null = null;
let _fireworks: ReturnType<typeof createOpenAICompatible> | null = null;
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

function anthropic() {
  if (!_anthropic) _anthropic = createAnthropic();
  return _anthropic;
}

function openai() {
  if (!_openai) _openai = createOpenAI();
  return _openai;
}

function deepseek() {
  if (!_deepseek) _deepseek = createDeepSeek();
  return _deepseek;
}

function google() {
  if (!_google) _google = createGoogleGenerativeAI();
  return _google;
}

function xai() {
  if (!_xai) _xai = createXai();
  return _xai;
}

function mistral() {
  if (!_mistral) _mistral = createMistral();
  return _mistral;
}

function cohere() {
  if (!_cohere) _cohere = createCohere();
  return _cohere;
}

function createFireworksLanguageProvider(apiKey?: string) {
  return createOpenAICompatible({
    name: "fireworks",
    baseURL: FIREWORKS_BASE_URL,
    apiKey: apiKey ?? process.env.FIREWORKS_API_KEY,
    includeUsage: true,
    supportsStructuredOutputs: true,
  });
}

function fireworks() {
  if (!_fireworks) _fireworks = createFireworksLanguageProvider();
  return _fireworks;
}

export {
  FALLBACK_MODEL,
  FIREWORKS_MODEL_IDS,
  MODEL_ROUTING,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
};

export type ModelCallTaskKind =
  | "extraction_classify"
  | "extraction_source_tree"
  | "extraction_operational_profile"
  | "extraction_coverage_cleanup"
  | "extraction_page_map"
  | "extraction_focused"
  | "extraction_long_list"
  | "extraction_referential_lookup"
  | "extraction_review"
  | "extraction_summary"
  | "extraction_format"
  | "query_attachment"
  | "query_classify"
  | "query_reason"
  | "query_verify"
  | "query_respond"
  | "pce_impact_analysis"
  | "pce_reply_parse"
  | "pce_packet_generation"
  | (string & {});

type ModelFallbackContext = {
  task?: ModelTask;
  taskKind?: ModelCallTaskKind;
  primaryRoute?: ModelRoute;
  qualityRoute?: ModelRoute;
  fallbackRoute?: ModelRoute;
  allowFallback?: boolean;
};

type ResolvedModelRoute = {
  model: LanguageModel;
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
  fallbackRoute: ModelRoute;
  allowFallback?: boolean;
};

type AiGenerateTextOptions = Parameters<typeof import("ai").generateText>[0];
type AiGenerateTextResult = Awaited<
  ReturnType<typeof import("ai").generateText>
>;
type RoutedGenerateTextOptions = Omit<AiGenerateTextOptions, "model">;
type RoutedGenerateObjectOptions<T> = Omit<
  AiGenerateTextOptions,
  "model" | "output"
> & {
  schema: z.ZodType<T>;
};
type RoutedGenerateTextResult = AiGenerateTextResult & {
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
  clRouter?: ClRouterResponseMetadata;
  clRouterFailure?: ClRouterFailureMetadata;
  fallback?: AgentModelFallback;
};
export type AgentModelFallback = {
  from: ModelRoute;
  to: ModelRoute;
  reason: string;
};
type AgentModelRouteTelemetry = {
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
  fallback?: AgentModelFallback;
};
const INTERACTIVE_AGENT_INITIAL_EXECUTION_BUDGET_MS = 60_000;
class AgentModelFallbackAttemptError extends Error {
  constructor(
    readonly fallback: AgentModelFallback,
    cause: unknown,
  ) {
    super(
      `Configured fallback ${fallback.to.provider}/${fallback.to.model} failed: ${errorText(cause)}`,
      { cause },
    );
    this.name = "AgentModelFallbackAttemptError";
  }
}

class AgentIncompleteOutputError extends Error {
  constructor(readonly finishReason: string | undefined) {
    super(
      finishReason === "length"
        ? "Model reached its output limit before producing a usable response"
        : "Model completed without producing a usable response",
    );
    this.name = "AgentIncompleteOutputError";
  }
}
export type AgentModelRunOptions = {
  sessionKey: string;
  taskKind: ModelCallTaskKind;
  trace: {
    traceId: string;
    parentRequestId?: string;
    label: string;
    phase: string;
    channel:
      | "web"
      | "imessage"
      | "slack"
      | "mcp"
      | "email"
      | "mailbox"
      | "public_demo";
  };
  onResponse?: ClRouterLanguageModelOptions["onResponse"];
  onDirectFallback?: ClRouterLanguageModelOptions["onDirectFallback"];
};
export type ResolvedAgentLanguageModel = ResolvedModelRoute & {
  transport: ModelTransport;
  routerResponses: ClRouterResponseMetadata[];
  routerFailures: ClRouterFailureMetadata[];
};
type RoutedGenerateObjectResult<T> = Omit<
  AiGenerateTextResult,
  "output" | "object"
> & {
  output: T;
  object: T;
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
  clRouter?: ClRouterResponseMetadata;
};

export type ModelTransport = "direct" | "cl-router";
export type ModelRouteSource = "broker" | "global" | "static" | "default";

export function generatedTextFromResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;

  const steps = Array.isArray(record.steps) ? record.steps : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || typeof step !== "object") continue;
    const text = (step as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }

  return "";
}

function withGeneratedText<T extends AiGenerateTextResult>(result: T): T {
  return {
    ...result,
    text: generatedTextFromResult(result),
  } as T;
}

const MODEL_CALL_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.MODEL_CALL_TIMEOUT_MS ?? "180000", 10) || 180_000,
);

function withModelTimeout<T extends { abortSignal?: AbortSignal }>(
  options: T,
): T {
  return options.abortSignal
    ? options
    : { ...options, abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS) };
}

const GPT_55 = "gpt-5.5";

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function clRouterSettingsSnapshot(
  settings: unknown,
): ClRouterSettingsSnapshot | null {
  if (!settings || typeof settings !== "object") return null;
  const record = settings as Record<string, unknown>;
  return {
    ...(record.routes && typeof record.routes === "object"
      ? { routes: record.routes as Record<string, ModelRoute> }
      : {}),
    ...(record.routeSources && typeof record.routeSources === "object"
      ? { routeSources: record.routeSources as Record<string, string> }
      : {}),
    ...(record.providerKeys && typeof record.providerKeys === "object"
      ? {
          providerKeys: record.providerKeys as Partial<
            Record<ModelProvider, string>
          >,
        }
      : {}),
  };
}

function clRouterMessages(value: unknown): ClRouterMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ClRouterMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const message = item as Record<string, unknown>;
    if (
      (message.role !== "system" &&
        message.role !== "user" &&
        message.role !== "assistant" &&
        message.role !== "tool") ||
      typeof message.content !== "string"
    ) {
      return null;
    }
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

function clRouterGenerateInput(
  options: RoutedGenerateTextOptions,
): Pick<
  ClRouterGenerateRequest,
  "system" | "messages" | "prompt" | "maxTokens"
> | null {
  const record = options as Record<string, unknown>;
  const supportedKeys = new Set([
    "system",
    "messages",
    "prompt",
    "maxOutputTokens",
    "abortSignal",
  ]);
  if (
    Object.keys(record).some(
      (key) => record[key] !== undefined && !supportedKeys.has(key),
    )
  ) {
    return null;
  }
  if (record.system !== undefined && typeof record.system !== "string")
    return null;
  if (record.prompt !== undefined && typeof record.prompt !== "string")
    return null;
  const messages =
    record.messages === undefined
      ? undefined
      : clRouterMessages(record.messages);
  if (record.messages !== undefined && !messages) return null;
  if (record.prompt === undefined && messages === undefined) return null;
  if (
    record.maxOutputTokens !== undefined &&
    typeof record.maxOutputTokens !== "number"
  ) {
    return null;
  }
  return {
    ...(typeof record.system === "string" ? { system: record.system } : {}),
    ...(typeof record.prompt === "string" ? { prompt: record.prompt } : {}),
    ...(messages ? { messages } : {}),
    ...(typeof record.maxOutputTokens === "number"
      ? { maxTokens: record.maxOutputTokens }
      : {}),
  };
}

function clRouterGenerateInputForEnabledTask(
  task: ModelTask,
  taskKind: ModelCallTaskKind | undefined,
  options: RoutedGenerateTextOptions,
): Pick<
  ClRouterGenerateRequest,
  "system" | "messages" | "prompt" | "maxTokens"
> {
  const input = clRouterGenerateInput(options);
  if (input) return input;

  throw new ClRouterRequestError(
    "configuration",
    `cl-router is enabled for ${taskKind ?? task}, but this generation call uses options that the non-streaming router adapter cannot preserve; disable that CL_ROUTER_TASKS gate or route the call through the Spot-owned cl-router language-model tool loop`,
  );
}

function languageModelUsageFromClRouter(
  usage: ClRouterUsage,
): LanguageModelUsage {
  const reasoningTokens = usage.reasoningTokens ?? 0;
  return {
    inputTokens: usage.inputTokens,
    inputTokenDetails: {
      noCacheTokens: Math.max(
        0,
        usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
      ),
      cacheReadTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    },
    outputTokens: usage.outputTokens,
    outputTokenDetails: {
      textTokens: Math.max(0, usage.outputTokens - reasoningTokens),
      reasoningTokens,
    },
    totalTokens: usage.inputTokens + usage.outputTokens,
    reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
  };
}

function warnClRouterFallback(
  task: ModelTask,
  error: ClRouterRequestError,
): void {
  console.warn("cl-router unavailable; using direct provider fallback", {
    task,
    kind: error.kind,
    status: error.status,
  });
}

export function getProviderOptionsForRoute(
  route: ModelRoute,
): ProviderOptions | undefined {
  if (route.provider === "openai" && route.model === GPT_55) {
    return { openai: { reasoningEffort: "none" } };
  }
  return undefined;
}

function isMissingApiKeyError(err: unknown): boolean {
  const message = errorTextForMatching(err);
  return /api key is missing/i.test(message);
}

export function modelTaskForCall(
  baseTask: ModelTask,
  taskKind?: ModelCallTaskKind,
): ModelTask {
  return policyModelTaskForCall(baseTask, taskKind);
}

export function fallbackRouteForCall({
  task,
  taskKind,
  primaryRoute,
  fallbackRoute = FALLBACK_MODEL,
  allowFallback = true,
}: ModelFallbackContext): ModelRoute | null {
  return policyFallbackRouteForCall({
    task,
    taskKind,
    primaryRoute,
    fallbackRoute,
    allowFallback,
  });
}

export function primaryRouteForCall({
  task,
  taskKind,
  qualityRoute = EXTRACTION_QUALITY_MODEL,
}: ModelFallbackContext): ModelRoute | null {
  return policyPrimaryRouteForCall({ task, taskKind, qualityRoute });
}

export function getProviderOptionsForTask(
  task: ModelTask,
): ProviderOptions | undefined {
  return getProviderOptionsForRoute(MODEL_ROUTING[task]);
}

export function mergeProviderOptions(
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
  return Object.keys(merged).length > 0
    ? (merged as ProviderOptions)
    : undefined;
}

function providerModel(
  provider: ModelProvider,
  model: string,
  apiKey?: string,
): LanguageModel {
  switch (provider) {
    case "openai":
      return (apiKey ? createOpenAI({ apiKey }) : openai())(model);
    case "anthropic":
      return (apiKey ? createAnthropic({ apiKey }) : anthropic())(model);
    case "google":
      return (apiKey ? createGoogleGenerativeAI({ apiKey }) : google())(model);
    case "xai":
      return (apiKey ? createXai({ apiKey }) : xai())(model);
    case "mistral":
      return (apiKey ? createMistral({ apiKey }) : mistral())(model);
    case "cohere":
      return (apiKey ? createCohere({ apiKey }) : cohere())(model);
    case "fireworks":
      return (apiKey ? createFireworksLanguageProvider(apiKey) : fireworks())(
        model,
      );
    case "moonshot":
      throw new Error("Moonshot routing is disabled");
    case "deepseek":
      return (apiKey ? createDeepSeek({ apiKey }) : deepseek())(model);
  }
}

function directProviderApiKey(provider: ModelProvider): string | undefined {
  switch (provider) {
    case "openai":
      return cleanEnv(process.env.OPENAI_API_KEY);
    case "anthropic":
      return cleanEnv(process.env.ANTHROPIC_API_KEY);
    case "google":
      return (
        cleanEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ??
        cleanEnv(process.env.GOOGLE_API_KEY)
      );
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
    case "moonshot":
      return undefined;
  }
}

function routeDirectApiKey(
  route: ModelRoute,
  apiKey?: string,
): string | undefined {
  return cleanEnv(apiKey) ?? directProviderApiKey(route.provider);
}

type AudioTranscriptionInput = {
  data: Buffer;
  filename: string;
  mediaType: string;
  prompt?: string;
};

async function withTemporaryAudioReference<T>(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
  callback: (audio: ClRouterAssetReference) => Promise<T>,
): Promise<T> {
  const bytes = new Uint8Array(input.data);
  const storageId = await ctx.storage.store(
    new Blob([bytes], { type: input.mediaType }),
  );
  try {
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new ClRouterRequestError(
        "configuration",
        "Unable to create a temporary audio reference for cl-router",
      );
    }
    return await callback({
      url,
      mediaType: input.mediaType,
      filename: transcriptionFilename(input.filename, input.mediaType),
      sizeBytes: bytes.byteLength,
    });
  } finally {
    try {
      await ctx.storage.delete(storageId);
    } catch {
      console.warn(
        "[cl-router] Failed to delete temporary transcription audio",
      );
    }
  }
}

type AudioTranscriptionResult = {
  text: string;
  route: ModelRoute;
  routeSource: ModelRouteSource;
  transport: ModelTransport;
  clRouter?: ClRouterResponseMetadata;
};

const AUDIO_TRANSCRIPTION_TASK = "voice_transcription" as const;
const OPENAI_TRANSCRIPTION_URL =
  "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIPTION_FILE_EXTENSIONS = new Set([
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "wav",
  "webm",
]);

function audioExtensionForMediaType(mediaType: string): string {
  switch (mediaType.toLowerCase().split(";", 1)[0]) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return "m4a";
  }
}

function transcriptionFilename(filename: string, mediaType: string): string {
  const trimmed = filename.trim() || "voice-memo";
  const extension = trimmed.split(".").pop()?.toLowerCase();
  if (extension && TRANSCRIPTION_FILE_EXTENSIONS.has(extension)) return trimmed;
  const base = trimmed.replace(/\.[^.]+$/, "") || "voice-memo";
  return `${base}.${audioExtensionForMediaType(mediaType)}`;
}

async function resolveAudioTranscriptionRouteForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<{
  route: ModelRoute;
  apiKey: string;
  routeSource: ModelRouteSource;
}> {
  try {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, {
      orgId,
    });
    return resolveAudioTranscriptionRouteForSettingsSnapshot(
      clRouterSettingsSnapshot(settings),
      true,
    );
  } catch (error) {
    console.warn(
      `Configured voice transcription route unavailable: ${
        error instanceof Error ? error.message : String(error)
      }. Falling back to static routing.`,
    );
  }

  return resolveAudioTranscriptionRouteForSettingsSnapshot(null, true);
}

function resolveAudioTranscriptionRouteForSettingsSnapshot(
  settings: ClRouterSettingsSnapshot | null,
  allowBroker: boolean,
): { route: ModelRoute; apiKey: string; routeSource: ModelRouteSource } {
  const staticRoute = MODEL_ROUTING[AUDIO_TRANSCRIPTION_TASK];
  const configuredRoute = settings?.routes?.[AUDIO_TRANSCRIPTION_TASK];
  const rawRouteSource = settings?.routeSources?.[AUDIO_TRANSCRIPTION_TASK];
  const configuredApiKey =
    allowBroker && rawRouteSource === "broker" && configuredRoute
      ? settings?.providerKeys?.[configuredRoute.provider]
      : undefined;
  const apiKey = configuredRoute
    ? routeDirectApiKey(configuredRoute, configuredApiKey)
    : undefined;
  if (
    configuredRoute &&
    (allowBroker || rawRouteSource !== "broker") &&
    configuredRoute.provider !== "moonshot" &&
    directProviderModelForRoute(configuredRoute) &&
    modelRouteSupportsTask(AUDIO_TRANSCRIPTION_TASK, configuredRoute) &&
    apiKey
  ) {
    const routeSource: ModelRouteSource =
      allowBroker && rawRouteSource === "broker"
        ? "broker"
        : rawRouteSource === "global"
          ? "global"
          : "default";
    return { route: configuredRoute, apiKey, routeSource };
  }

  const staticApiKey = routeDirectApiKey(staticRoute);
  if (!staticApiKey) {
    throw new Error(
      "Direct OpenAI API key is missing for voice memo transcription. AI Gateway is not a fallback for Spot model routing.",
    );
  }
  return { route: staticRoute, apiKey: staticApiKey, routeSource: "default" };
}

async function resolveAudioTranscriptionRouteForPublicTask(
  ctx: ActionCtx,
): Promise<{
  route: ModelRoute;
  apiKey: string;
  routeSource: Extract<ModelRouteSource, "global" | "default">;
}> {
  try {
    const settings = await ctx.runQuery(
      internal.modelSettings.resolvePublicDefaults,
      {},
    );
    const resolved = resolveAudioTranscriptionRouteForSettingsSnapshot(
      clRouterSettingsSnapshot(settings),
      false,
    );
    return {
      ...resolved,
      routeSource: resolved.routeSource === "global" ? "global" : "default",
    };
  } catch (error) {
    console.warn(
      `Global voice transcription route unavailable: ${
        error instanceof Error ? error.message : String(error)
      }. Falling back to static routing.`,
    );
  }

  const resolved = resolveAudioTranscriptionRouteForSettingsSnapshot(
    null,
    false,
  );
  return { ...resolved, routeSource: "default" };
}

async function transcribeAudioWithResolvedRoute(
  resolved: {
    route: ModelRoute;
    apiKey: string;
    routeSource: ModelRouteSource;
  },
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  if (!modelRouteSupportsTask(AUDIO_TRANSCRIPTION_TASK, resolved.route)) {
    throw new Error(
      `Model route ${resolved.route.provider}/${resolved.route.model} cannot transcribe audio`,
    );
  }
  const model = directProviderModelForRoute(resolved.route);
  if (!model) {
    throw new Error(
      `Model route ${resolved.route.provider}/${resolved.route.model} is not available through direct provider routing`,
    );
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.data)], { type: input.mediaType }),
    transcriptionFilename(input.filename, input.mediaType),
  );
  form.append("model", model);
  form.append("response_format", "json");
  if (input.prompt?.trim()) form.append("prompt", input.prompt.trim());

  const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${resolved.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(
      `OpenAI audio transcription failed (${response.status})${
        detail ? `: ${detail.slice(0, 500)}` : ""
      }`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenAI audio transcription returned invalid JSON");
  }
  const text =
    payload &&
    typeof payload === "object" &&
    "text" in payload &&
    typeof payload.text === "string"
      ? payload.text.trim()
      : "";
  if (!text) throw new Error("OpenAI audio transcription returned no text");
  return {
    text,
    route: resolved.route,
    routeSource: resolved.routeSource,
    transport: "direct",
  };
}

export async function transcribeAudioForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved =
      settings === undefined
        ? await resolveAudioTranscriptionRouteForOrg(ctx, orgId)
        : resolveAudioTranscriptionRouteForSettingsSnapshot(settings, true);
    return transcribeAudioWithResolvedRoute(resolved, input);
  };
  if (!shouldUseClRouterForTask(AUDIO_TRANSCRIPTION_TASK)) return direct();
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return withClRouterDirectFallback({
    router: () =>
      withTemporaryAudioReference(ctx, input, async (audio) => {
        const response = await clRouterTranscribe({
          orgId,
          settings,
          audio,
          prompt: input.prompt,
          trace: { label: "convex.models.transcribeAudioForOrg" },
        });
        const text = response.text.trim();
        if (!text) {
          throw new ClRouterRequestError(
            "invalid_response",
            "cl-router audio transcription returned no text",
          );
        }
        const routeSource = response.routing.routeSource;
        return {
          text,
          route: response.model,
          routeSource:
            routeSource === "broker" ||
            routeSource === "global" ||
            routeSource === "static" ||
            routeSource === "default"
              ? routeSource
              : "default",
          transport: "cl-router" as const,
          clRouter: response,
        };
      }),
    direct: () => direct(settings),
    onFallback: (error) =>
      warnClRouterFallback(AUDIO_TRANSCRIPTION_TASK, error),
  });
}

async function transcribeAudioForGlobalTask(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
  traceLabel: string,
): Promise<AudioTranscriptionResult> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved =
      settings === undefined
        ? await resolveAudioTranscriptionRouteForPublicTask(ctx)
        : resolveAudioTranscriptionRouteForSettingsSnapshot(settings, false);
    return transcribeAudioWithResolvedRoute(resolved, input);
  };
  if (!shouldUseClRouterForTask(AUDIO_TRANSCRIPTION_TASK)) return direct();
  const settings = await clRouterSettingsForPublicTask(ctx);
  return withClRouterDirectFallback({
    router: () =>
      withTemporaryAudioReference(ctx, input, async (audio) => {
        const response = await clRouterTranscribe({
          settings,
          audio,
          prompt: input.prompt,
          trace: { label: traceLabel },
        });
        const text = response.text.trim();
        if (!text) {
          throw new ClRouterRequestError(
            "invalid_response",
            "cl-router audio transcription returned no text",
          );
        }
        const routeSource = response.routing.routeSource;
        return {
          text,
          route: response.model,
          routeSource:
            routeSource === "global" ||
            routeSource === "static" ||
            routeSource === "default"
              ? routeSource
              : "default",
          transport: "cl-router" as const,
          clRouter: response,
        };
      }),
    direct: () => direct(settings),
    onFallback: (error) =>
      warnClRouterFallback(AUDIO_TRANSCRIPTION_TASK, error),
  });
}

export async function transcribeAudioForPublicTask(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  return transcribeAudioForGlobalTask(
    ctx,
    input,
    "convex.models.transcribeAudioForPublicTask",
  );
}

export async function transcribeAudioForOperatorTask(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  return transcribeAudioForGlobalTask(
    ctx,
    input,
    "convex.models.transcribeAudioForOperatorTask",
  );
}

function errorTextForMatching(err: unknown, seen = new Set<unknown>()): string {
  if (!err || seen.has(err)) return "";
  seen.add(err);

  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const record = err as Error & Record<string, unknown> & { cause?: unknown };
    return [
      err.name,
      err.message,
      record.code,
      record.status,
      record.statusCode,
      record.error,
      errorTextForMatching(record.cause, seen),
    ]
      .filter(Boolean)
      .map((field) => String(field))
      .join(" ");
  }
  if (typeof err !== "object") return String(err);

  const record = err as Record<string, unknown>;
  const fields = [
    record.code,
    record.status,
    record.statusCode,
    record.message,
    record.error,
    record.cause,
  ];
  return fields
    .map((field) => errorTextForMatching(field, seen))
    .filter(Boolean)
    .join(" ");
}

function errorRecords(error: unknown): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    records.push(record);
    visit(record.error);
    visit(record.cause);
    visit(record.data);
    visit(record.response);
  };
  visit(error);
  return records;
}

type ClRouterFailureMetadata = {
  message: string;
  requestId?: string;
  routerCode?: string;
  status?: number;
  retryable?: boolean;
  executionStarted?: boolean;
  attempts: readonly ClRouterFailureAttempt[];
};

function clRouterFailureMetadata(
  error: unknown,
): ClRouterFailureMetadata | undefined {
  let failure: ClRouterRequestError | undefined;
  for (const record of errorRecords(error)) {
    if (record instanceof ClRouterRequestError) {
      failure = record;
      break;
    }
  }
  if (!failure) return undefined;
  return {
    message: failure.message,
    ...(failure.requestId ? { requestId: failure.requestId } : {}),
    ...(failure.routerCode ? { routerCode: failure.routerCode } : {}),
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.retryable === undefined
      ? {}
      : { retryable: failure.retryable }),
    ...(failure.executionStarted === undefined
      ? {}
      : { executionStarted: failure.executionStarted }),
    attempts: failure.attempts,
  };
}

function routerFailureTelemetryFields(
  failure: ClRouterFailureMetadata | undefined,
) {
  if (!failure) return {};
  return {
    ...(failure.routerCode ? { routerCode: failure.routerCode } : {}),
    ...(failure.status === undefined ? {} : { routerStatus: failure.status }),
    ...(failure.retryable === undefined
      ? {}
      : { routerRetryable: failure.retryable }),
    ...(failure.executionStarted === undefined
      ? {}
      : { routerExecutionStarted: failure.executionStarted }),
    ...(failure.attempts.length
      ? { failureAttempts: [...failure.attempts] }
      : {}),
  };
}

/**
 * Availability failures may use the configured fallback only before a model
 * step completes or a tool begins. Callers own that execution boundary; this
 * helper only classifies the provider/router failure itself.
 */
export function isPreExecutionFallbackEligibleError(error: unknown): boolean {
  const records = errorRecords(error);
  if (
    error instanceof ClRouterVisibleOutputError ||
    records.some((record) => record instanceof ClRouterVisibleOutputError) ||
    records.some((record) => record.executionStarted === true)
  ) {
    return false;
  }

  const statuses = records
    .flatMap((record) => [record.statusCode, record.status])
    .filter((value): value is number => typeof value === "number");
  if (
    statuses.some(
      (status) =>
        status === 404 ||
        status === 408 ||
        status === 429 ||
        (status >= 500 && status < 600),
    )
  ) {
    return true;
  }

  const codes = records
    .flatMap((record) => [record.code, record.routerCode])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toUpperCase());
  if (
    codes.some((code) =>
      [
        "NOT_FOUND",
        "SERVER_ERROR",
        "RATE_LIMIT_EXCEEDED",
        "ECONNRESET",
        "ECONNREFUSED",
        "ENOTFOUND",
        "EAI_AGAIN",
        "ETIMEDOUT",
      ].includes(code),
    )
  ) {
    return true;
  }

  if (
    records.some(
      (record) =>
        record instanceof ClRouterRequestError &&
        (record.kind === "connection" ||
          record.kind === "timeout" ||
          record.kind === "server"),
    )
  ) {
    return true;
  }

  return /server_error|internal server error|temporarily unavailable|overloaded|timed?\s*out|fetch failed|rate limit|connection refused|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|\bNOT_FOUND\b|\bnot found\b|inaccessible|not deployed/i.test(
    errorTextForMatching(error),
  );
}

function modelFromRoute(route: ModelRoute, apiKey?: string): LanguageModel {
  const directModel = directProviderModelForRoute(route);
  if (!directModel) {
    throw new Error(
      `Model route ${route.provider}/${route.model} is not supported by the direct ${route.provider} provider. Configure a directly supported provider/model route instead.`,
    );
  }
  const directApiKey = routeDirectApiKey(route, apiKey);
  if (!directApiKey) {
    throw new Error(
      `Direct ${route.provider} API key is missing for model route ${route.provider}/${route.model}. AI Gateway is not a fallback for Spot model routing.`,
    );
  }
  return providerModel(route.provider, directModel, directApiKey);
}

export function getModelForRoute(route: ModelRoute): LanguageModel {
  return modelFromRoute(route);
}

export function getModel(task: ModelTask): LanguageModel {
  if (task === "embeddings" || task === "voice_transcription") {
    throw new Error(
      task === "embeddings"
        ? "Embeddings must use makeEmbedText or makeEmbedTexts, not getModel()"
        : "Voice memo transcription must use a dedicated organization, public, or operator transcription helper, not getModel()",
    );
  }
  return modelFromRoute(MODEL_ROUTING[task] ?? MODEL_ROUTING.chat);
}

export async function getModelForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
): Promise<LanguageModel> {
  if (task === "voice_transcription") {
    throw new Error(
      "Voice memo transcription must use transcribeAudioForOrg, not getModelForOrg()",
    );
  }
  return (await getModelAndRouteForOrg(ctx, orgId, task)).model;
}

type OrgModelRouteResolution = {
  model: LanguageModel;
  route: ModelRoute;
  routeSource: ModelRouteSource;
  transport: ModelTransport;
  qualityRoute: ModelRoute;
  qualityRouteSource: "broker" | "global" | "static";
  coverageCleanupRoute: ModelRoute;
  coverageCleanupRouteSource: "broker" | "global" | "static";
  fallbackRoute: ModelRoute;
};

function resolvedSettingsRouteSource(
  value: string | undefined,
  defaultSource: "global" | "static",
): "broker" | "global" | "static" {
  return value === "broker" || value === "global" || value === "static"
    ? value
    : defaultSource;
}

export function getModelAndRouteForSettingsSnapshot(
  settings: ClRouterSettingsSnapshot | null,
  task: ModelTask,
): OrgModelRouteResolution {
  const configuredRoute = settings?.routes?.[task];
  const routeSource = resolvedSettingsRouteSource(
    settings?.routeSources?.[task],
    "global",
  );
  const qualityRoute =
    settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
  const qualityRouteSource = resolvedSettingsRouteSource(
    settings?.routeSources?.extraction_quality,
    "static",
  );
  const coverageCleanupRoute =
    settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
  const coverageCleanupRouteSource = resolvedSettingsRouteSource(
    settings?.routeSources?.extraction_coverage_cleanup,
    "static",
  );
  const fallbackRoute = settings?.routes?.fallback ?? FALLBACK_MODEL;
  const configuredApiKey =
    routeSource === "broker" && configuredRoute
      ? settings?.providerKeys?.[configuredRoute.provider]
      : undefined;
  const canUseConfiguredRoute =
    !!configuredRoute &&
    configuredRoute.provider !== "moonshot" &&
    !!directProviderModelForRoute(configuredRoute) &&
    modelRouteSupportsTask(task, configuredRoute) &&
    !!routeDirectApiKey(configuredRoute, configuredApiKey);
  const route = canUseConfiguredRoute ? configuredRoute : MODEL_ROUTING[task];
  const apiKey = canUseConfiguredRoute ? configuredApiKey : undefined;
  return {
    model: modelFromRoute(route, apiKey),
    route,
    routeSource: canUseConfiguredRoute ? routeSource : "default",
    transport: "direct",
    qualityRoute,
    qualityRouteSource,
    coverageCleanupRoute,
    coverageCleanupRouteSource,
    fallbackRoute,
  };
}

export async function getModelAndRouteForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
): Promise<OrgModelRouteResolution> {
  if (task === "voice_transcription") {
    throw new Error(
      "Voice memo transcription must use transcribeAudioForOrg, not getModelAndRouteForOrg()",
    );
  }
  try {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, {
      orgId,
    });
    return getModelAndRouteForSettingsSnapshot(
      clRouterSettingsSnapshot(settings),
      task,
    );
  } catch (err) {
    console.warn(
      `Configured model for task "${task}" unavailable: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to static routing.`,
    );
    const route = MODEL_ROUTING[task];
    return {
      model: getModel(task),
      route,
      routeSource: "default",
      transport: "direct",
      qualityRoute: EXTRACTION_QUALITY_MODEL,
      qualityRouteSource: "static",
      coverageCleanupRoute: COVERAGE_CLEANUP_MODEL,
      coverageCleanupRouteSource: "static",
      fallbackRoute: FALLBACK_MODEL,
    };
  }
}

export async function getModelAndRouteForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
): Promise<{
  model: LanguageModel;
  route: ModelRoute;
  routeSource: "global" | "static" | "default";
  transport: ModelTransport;
  qualityRoute: ModelRoute;
  qualityRouteSource: "global" | "static";
  coverageCleanupRoute: ModelRoute;
  coverageCleanupRouteSource: "global" | "static";
  fallbackRoute: ModelRoute;
}> {
  if (task === "voice_transcription") {
    throw new Error(
      "Voice memo transcription must use transcribeAudioForPublicTask, not getModelAndRouteForPublicTask()",
    );
  }
  try {
    const settings = await ctx.runQuery(
      internal.modelSettings.resolvePublicDefaults,
      {},
    );
    return getModelAndRouteForPublicSettingsSnapshot(
      clRouterSettingsSnapshot(settings),
      task,
    );
  } catch (err) {
    console.warn(
      `Public model for task "${task}" unavailable: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to static routing.`,
    );
    const route = MODEL_ROUTING[task];
    return {
      model: getModel(task),
      route,
      routeSource: "default",
      transport: "direct",
      qualityRoute: EXTRACTION_QUALITY_MODEL,
      qualityRouteSource: "static",
      coverageCleanupRoute: COVERAGE_CLEANUP_MODEL,
      coverageCleanupRouteSource: "static",
      fallbackRoute: FALLBACK_MODEL,
    };
  }
}

export function getModelAndRouteForPublicSettingsSnapshot(
  settings: ClRouterSettingsSnapshot | null,
  task: ModelTask,
): {
  model: LanguageModel;
  route: ModelRoute;
  routeSource: "global" | "static" | "default";
  transport: ModelTransport;
  qualityRoute: ModelRoute;
  qualityRouteSource: "global" | "static";
  coverageCleanupRoute: ModelRoute;
  coverageCleanupRouteSource: "global" | "static";
  fallbackRoute: ModelRoute;
} {
  const configuredRoute = settings?.routes?.[task];
  const rawRouteSource = settings?.routeSources?.[task];
  const canUseConfiguredRoute =
    !!configuredRoute &&
    rawRouteSource !== "broker" &&
    configuredRoute.provider !== "moonshot" &&
    !!directProviderModelForRoute(configuredRoute) &&
    modelRouteSupportsTask(task, configuredRoute) &&
    !!routeDirectApiKey(configuredRoute);
  const route = canUseConfiguredRoute ? configuredRoute : MODEL_ROUTING[task];
  const routeSource = canUseConfiguredRoute
    ? rawRouteSource === "static" || rawRouteSource === "default"
      ? rawRouteSource
      : "global"
    : "static";
  const qualityRoute =
    settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
  const coverageCleanupRoute =
    settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
  return {
    model: modelFromRoute(route),
    route,
    routeSource,
    transport: "direct",
    qualityRoute,
    qualityRouteSource:
      settings?.routeSources?.extraction_quality === "global"
        ? "global"
        : "static",
    coverageCleanupRoute,
    coverageCleanupRouteSource:
      settings?.routeSources?.extraction_coverage_cleanup === "global"
        ? "global"
        : "static",
    fallbackRoute: settings?.routes?.fallback ?? FALLBACK_MODEL,
  };
}

export async function generateTextWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
  fallbackContext: ModelFallbackContext = {},
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(withModelTimeout(options));
  } catch (err: unknown) {
    const modelId =
      ((options.model as Record<string, unknown>)?.modelId as string) ||
      "unknown";
    if (isMissingApiKeyError(err)) throw err;
    const fallbackRoute = fallbackRouteForCall(fallbackContext);
    if (!fallbackRoute) throw err;
    console.warn(
      `Primary model (${modelId}) failed: ${
        err instanceof Error ? err.message : String(err)
      }. Retrying with ${fallbackRoute.model}.`,
    );
    return await generateText(
      withModelTimeout({
        ...options,
        model: modelFromRoute(fallbackRoute),
        providerOptions: mergeProviderOptions(
          getProviderOptionsForRoute(fallbackRoute),
          options.providerOptions,
        ),
      }),
    );
  }
}

export async function generateStructuredWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
  fallbackContext: ModelFallbackContext = {},
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(withModelTimeout(options));
  } catch (err: unknown) {
    const modelId =
      ((options.model as Record<string, unknown>)?.modelId as string) ||
      "unknown";
    if (isMissingApiKeyError(err)) throw err;
    const fallbackRoute = fallbackRouteForCall(fallbackContext);
    if (!fallbackRoute) throw err;
    console.warn(
      `Primary model (${modelId}) failed for structured output: ${
        err instanceof Error ? err.message : String(err)
      }. Retrying with ${fallbackRoute.model}.`,
    );
    return await generateText(
      withModelTimeout({
        ...options,
        model: modelFromRoute(fallbackRoute),
        providerOptions: mergeProviderOptions(
          getProviderOptionsForRoute(fallbackRoute),
          options.providerOptions,
        ),
      }),
    );
  }
}

function routeProviderOptions(
  resolved: Pick<ResolvedModelRoute, "route">,
  providerOptions: ProviderOptions | undefined,
) {
  return mergeProviderOptions(
    getProviderOptionsForRoute(resolved.route),
    providerOptions,
  );
}

async function generateTextForResolvedRoute(
  resolved: ResolvedModelRoute,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  fallbackContext: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  > = {},
): Promise<RoutedGenerateTextResult> {
  const result = await generateTextWithFallback(
    {
      ...options,
      model: resolved.model,
      providerOptions: routeProviderOptions(resolved, options.providerOptions),
    } as AiGenerateTextOptions,
    {
      ...fallbackContext,
      task,
      primaryRoute: resolved.route,
      fallbackRoute: resolved.fallbackRoute,
    },
  );
  const resultWithText = withGeneratedText(result);
  return {
    ...resultWithText,
    route: resolved.route,
    routeSource: resolved.routeSource,
    transport: resolved.transport,
  };
}

async function generateObjectForResolvedRoute<T>(
  resolved: ResolvedModelRoute,
  task: ModelTask,
  options: RoutedGenerateObjectOptions<T>,
  fallbackContext: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  > = {},
): Promise<RoutedGenerateObjectResult<T>> {
  const { schema, providerOptions, ...textOptions } = options;
  const result = await generateStructuredWithFallback(
    {
      ...textOptions,
      model: resolved.model,
      output: Output.object({
        schema: structuredOutputSchemaForRoute(schema, resolved.route),
      }),
      providerOptions: routeProviderOptions(resolved, providerOptions),
    } as AiGenerateTextOptions,
    {
      ...fallbackContext,
      task,
      primaryRoute: resolved.route,
      fallbackRoute: resolved.fallbackRoute,
    },
  );

  const output = result.output as T;
  return {
    ...result,
    output,
    object: output,
    route: resolved.route,
    routeSource: resolved.routeSource,
    transport: resolved.transport,
  };
}

function routedTextResultFromClRouter(
  response: Awaited<ReturnType<typeof clRouterGenerate>>,
): RoutedGenerateTextResult {
  if (typeof response.output !== "string") {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router text generation returned a non-text output",
    );
  }
  const usage = languageModelUsageFromClRouter(response.usage);
  return {
    text: response.output,
    output: response.output,
    finishReason: response.finishReason ?? "stop",
    usage,
    totalUsage: usage,
    route: response.model,
    routeSource: response.routing.routeSource,
    transport: "cl-router",
    clRouter: response,
  } as unknown as RoutedGenerateTextResult;
}

function routedObjectResultFromClRouter<T>(
  response: Awaited<ReturnType<typeof clRouterGenerate>>,
  schema: z.ZodType<T>,
): RoutedGenerateObjectResult<T> {
  const parsed = schema.safeParse(response.output);
  if (!parsed.success) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router structured generation returned an invalid object",
      { cause: parsed.error },
    );
  }
  const usage = languageModelUsageFromClRouter(response.usage);
  return {
    text: JSON.stringify(parsed.data),
    output: parsed.data,
    object: parsed.data,
    finishReason: response.finishReason ?? "stop",
    usage,
    totalUsage: usage,
    route: response.model,
    routeSource: response.routing.routeSource,
    transport: "cl-router",
    clRouter: response,
  } as unknown as RoutedGenerateObjectResult<T>;
}

function modelSettingsRouteIdForCall(
  task: ModelTask,
  taskKind?: ModelCallTaskKind,
) {
  if (taskKind === "extraction_coverage_cleanup") {
    return "extraction_coverage_cleanup";
  }
  if (
    taskKind === "extraction_source_tree" ||
    taskKind === "extraction_operational_profile"
  ) {
    return "extraction_quality";
  }
  return modelTaskForCall(task, taskKind);
}

function clRouterRoutingForCall(
  settings: ClRouterSettingsSnapshot | null,
  task: ModelTask,
  taskKind?: ModelCallTaskKind,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): ClRouterGenerateRequest["routing"] {
  const routeId = modelSettingsRouteIdForCall(task, taskKind);
  const globalOverride =
    settings?.routeSources?.[routeId] === "global"
      ? settings.routes?.[routeId]
      : undefined;
  const allowFallback = fallbackContext?.allowFallback;
  if (!globalOverride && allowFallback === undefined) return undefined;
  return {
    ...(globalOverride ? { pin: globalOverride } : {}),
    ...(allowFallback === undefined ? {} : { allowFallback }),
  };
}

export async function resolveClRouterSettingsForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<ClRouterSettingsSnapshot | null> {
  const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, {
    orgId,
  });
  return clRouterSettingsSnapshot(settings);
}

async function clRouterSettingsForPublicTask(
  ctx: ActionCtx,
): Promise<ClRouterSettingsSnapshot | null> {
  const settings = await ctx.runQuery(
    internal.modelSettings.resolvePublicDefaults,
    {},
  );
  return clRouterSettingsSnapshot(settings);
}

function assertAgentModelRunOptions(options: AgentModelRunOptions) {
  if (!options.sessionKey.trim()) {
    throw new Error("Agent model routing requires a stable session key");
  }
  if (!options.taskKind.trim()) {
    throw new Error("Agent model routing requires an explicit task kind");
  }
  const { trace } = options;
  if (
    !trace.traceId.trim() ||
    !trace.label.trim() ||
    !trace.phase.trim() ||
    !trace.channel.trim()
  ) {
    throw new Error(
      "Agent model routing requires trace, phase, label, and channel metadata",
    );
  }
}

function agentLanguageModel(
  task: ModelTask,
  orgId: string | undefined,
  settings: ClRouterSettingsSnapshot | null,
  resolved: ResolvedModelRoute,
  run: AgentModelRunOptions,
): ResolvedAgentLanguageModel {
  if (
    typeof resolved.model === "string" ||
    resolved.model.specificationVersion !== "v3"
  ) {
    throw new Error(
      `cl-router ${task} break-glass requires an AI SDK v3 direct model`,
    );
  }
  const routerResponses: ClRouterResponseMetadata[] = [];
  const routerFailures: ClRouterFailureMetadata[] = [];
  return {
    ...resolved,
    model: createClRouterLanguageModel({
      task,
      taskKind: run.taskKind,
      ...(orgId ? { orgId } : {}),
      settings,
      sessionKey: run.sessionKey,
      trace: run.trace,
      directModel: resolved.model,
      ...(resolved.routeSource === "global"
        ? { initialRoutePin: resolved.route }
        : {}),
      ...(run.trace.channel === "mailbox" || run.trace.channel === "public_demo"
        ? {}
        : {
            initialExecutionBudgetMs:
              INTERACTIVE_AGENT_INITIAL_EXECUTION_BUDGET_MS,
          }),
      onResponse: async (response, step) => {
        routerResponses.push(response);
        await run.onResponse?.(response, step);
      },
      onDirectFallback: async (error, step) => {
        const failure = clRouterFailureMetadata(error);
        if (failure) routerFailures.push(failure);
        await run.onDirectFallback?.(error, step);
      },
    }),
    transport: "cl-router",
    routerResponses,
    routerFailures,
  };
}

function routingEventRun(
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
) {
  return {
    runId: run.trace.traceId,
    sessionKey: run.sessionKey,
    ...(orgId ? { orgId } : {}),
    task,
    taskKind: run.taskKind,
    channel: run.trace.channel,
    label: run.trace.label,
    phase: run.trace.phase,
    ...(run.trace.parentRequestId
      ? { parentRequestId: run.trace.parentRequestId }
      : {}),
  };
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1_000,
  );
}

function withAgentRoutingTelemetry(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
  directFallback: Pick<ResolvedModelRoute, "route" | "routeSource">,
): AgentModelRunOptions {
  const eventRun = routingEventRun(orgId, task, run);
  return {
    ...run,
    onResponse: async (response, step) => {
      await ctx.runMutation(
        internal.modelRoutingEvents.recordResponseInternal,
        { run: eventRun, response, ...step },
      );
      await run.onResponse?.(response, step);
    },
    onDirectFallback: async (error, step) => {
      const failure = clRouterFailureMetadata(error);
      const failedAttempt = failure?.attempts.at(-1);
      await ctx.runMutation(
        internal.modelRoutingEvents.recordFallbackInternal,
        {
          run: eventRun,
          error: errorText(error),
          ...step,
          ...(failure?.requestId ? { requestId: failure.requestId } : {}),
          ...routerFailureTelemetryFields(failure),
          ...(failedAttempt
            ? {
                provider: failedAttempt.provider,
                model: failedAttempt.model,
              }
            : {}),
          fallbackProvider: directFallback.route.provider,
          fallbackModel: directFallback.route.model,
          routeSource: directFallback.routeSource,
          transport: "direct",
        },
      );
      await run.onDirectFallback?.(error, step);
    },
  };
}

function workflowOutcomeStatus(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = (value as Record<string, unknown>).status;
  return typeof status === "string" ? status : undefined;
}

function workflowFailureCount(outcomes: unknown[]) {
  return outcomes.filter((outcome) => {
    const status = workflowOutcomeStatus(outcome);
    return status === "failed_recoverably" || status === "failed_terminal";
  }).length;
}

export function agentRunCompletionTelemetry(
  result: unknown,
  audit: AgentToolAudit,
  error?: unknown,
) {
  const record =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : undefined;
  const finishReason =
    typeof record?.finishReason === "string" ? record.finishReason : undefined;
  const visibleTextLength = generatedTextFromResult(result).trim().length;
  const hitOutputLimit = finishReason === "length";
  const failures = workflowFailureCount(audit.workflowOutcomes);
  const completionIssue = error
    ? undefined
    : hitOutputLimit
      ? ("output_limit" as const)
      : failures > 0 && visibleTextLength === 0
        ? ("workflow_failure" as const)
        : visibleTextLength === 0
          ? ("empty_response" as const)
          : undefined;

  return {
    status: error
      ? ("error" as const)
      : completionIssue
        ? ("incomplete" as const)
        : ("complete" as const),
    finishReason,
    hitOutputLimit,
    visibleTextLength,
    completionIssue,
    workflowFailureCount: failures,
  };
}

async function recordAgentRun(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
  result?: RoutedGenerateTextResult,
  error?: unknown,
  auditOverride?: AgentToolAudit,
  routerResponseOverride?: ClRouterResponseMetadata,
  routeOverride?: AgentModelRouteTelemetry,
  maxOutputTokens?: number,
  routerFailureOverride?: ClRouterFailureMetadata,
) {
  const audit =
    auditOverride ??
    (result
      ? collectToolAudit(result)
      : {
          usedTools: [],
          completedTools: [],
          toolCalls: [],
          workflowOutcomes: [],
        });
  const completion = agentRunCompletionTelemetry(result, audit, error);
  const routerFailure = error
    ? (clRouterFailureMetadata(error) ?? routerFailureOverride)
    : (result?.clRouterFailure ?? routerFailureOverride);
  const failedAttempt = routerFailure?.attempts.at(-1);
  const requestId =
    routerFailure?.requestId ??
    routerResponseOverride?.requestId ??
    result?.clRouter?.requestId;
  const route =
    result?.route ??
    (failedAttempt
      ? { provider: failedAttempt.provider, model: failedAttempt.model }
      : routerFailure
        ? undefined
        : routeOverride?.route);
  const routeSource = result?.routeSource ?? routeOverride?.routeSource;
  const transport = result?.transport ?? routeOverride?.transport;
  const fallback = result?.fallback ?? routeOverride?.fallback;
  const usage = result?.totalUsage ?? result?.usage;
  try {
    await ctx.runMutation(internal.modelRoutingEvents.recordRunInternal, {
      run: routingEventRun(orgId, task, run),
      status: completion.status,
      ...(requestId ? { requestId } : {}),
      ...(route ? { provider: route.provider, model: route.model } : {}),
      ...(routeSource ? { routeSource } : {}),
      ...(transport ? { transport } : {}),
      ...(fallback
        ? {
            fallbackProvider: fallback.to.provider,
            fallbackModel: fallback.to.model,
            fallbackReason: fallback.reason,
          }
        : {}),
      ...(usage?.inputTokens === undefined
        ? {}
        : { inputTokens: usage.inputTokens }),
      ...(usage?.outputTokens === undefined
        ? {}
        : { outputTokens: usage.outputTokens }),
      ...(usage?.outputTokenDetails?.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: usage.outputTokenDetails.reasoningTokens }),
      ...(usage?.inputTokenDetails?.cacheReadTokens === undefined
        ? {}
        : { cachedInputTokens: usage.inputTokenDetails.cacheReadTokens }),
      ...(usage?.inputTokenDetails?.cacheWriteTokens === undefined
        ? {}
        : { cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...routerFailureTelemetryFields(routerFailure),
      ...(completion.finishReason
        ? { finishReason: completion.finishReason }
        : {}),
      hitOutputLimit: completion.hitOutputLimit,
      visibleTextLength: completion.visibleTextLength,
      toolCallCount: audit.toolCalls.length,
      completedToolCount: audit.completedTools.length,
      toolNames: [...new Set(audit.usedTools)],
      workflowOutcomeCount: audit.workflowOutcomes.length,
      workflowFailureCount: completion.workflowFailureCount,
      ...(completion.completionIssue
        ? { completionIssue: completion.completionIssue }
        : {}),
      ...(error ? { error: errorText(error) } : {}),
    });
  } catch (telemetryError) {
    console.warn(
      "[cl-router] Failed to record agent routing run",
      telemetryError,
    );
  }
}

export async function recordAgentRoutingRun(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
  audit: AgentToolAudit,
  routerResponse?: ClRouterResponseMetadata,
  error?: unknown,
  routeOverride?: AgentModelRouteTelemetry,
) {
  await recordAgentRun(
    ctx,
    orgId,
    task,
    run,
    undefined,
    error,
    audit,
    routerResponse,
    routeOverride,
    undefined,
  );
}

export async function recordAgentRoutingFallback(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
  resolved: ResolvedAgentLanguageModel,
  fallback: AgentModelFallback,
  hasTools: boolean,
) {
  try {
    await ctx.runMutation(internal.modelRoutingEvents.recordFallbackInternal, {
      run: routingEventRun(orgId, task, run),
      step: 0,
      hasTools,
      hasToolResults: false,
      error: fallback.reason,
      provider: fallback.from.provider,
      model: fallback.from.model,
      fallbackProvider: fallback.to.provider,
      fallbackModel: fallback.to.model,
      routeSource: resolved.routeSource,
      transport: resolved.transport,
    });
  } catch (telemetryError) {
    console.warn(
      "[model-routing] Failed to record pre-execution fallback",
      telemetryError,
    );
  }
}

export async function getAgentLanguageModelForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  run: AgentModelRunOptions,
): Promise<ResolvedAgentLanguageModel> {
  assertAgentModelRunOptions(run);
  if (!shouldUseClRouterForCall(task, run.taskKind)) {
    const resolved = await getModelAndRouteForOrg(ctx, orgId, task);
    return {
      ...resolved,
      transport: "direct",
      routerResponses: [],
      routerFailures: [],
    };
  }
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  const resolved = getModelAndRouteForSettingsSnapshot(settings, task);
  return agentLanguageModel(
    task,
    String(orgId),
    settings,
    resolved,
    withAgentRoutingTelemetry(ctx, orgId, task, run, resolved),
  );
}

export async function getAgentLanguageModelForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
  run: AgentModelRunOptions,
): Promise<ResolvedAgentLanguageModel> {
  assertAgentModelRunOptions(run);
  if (!shouldUseClRouterForCall(task, run.taskKind)) {
    const resolved = await getModelAndRouteForPublicTask(ctx, task);
    return {
      ...resolved,
      transport: "direct",
      routerResponses: [],
      routerFailures: [],
    };
  }
  const settings = await clRouterSettingsForPublicTask(ctx);
  const resolved = getModelAndRouteForPublicSettingsSnapshot(settings, task);
  return agentLanguageModel(
    task,
    undefined,
    settings,
    resolved,
    withAgentRoutingTelemetry(ctx, undefined, task, run, resolved),
  );
}

async function generateAgentTextForResolvedModel(
  resolved: ResolvedAgentLanguageModel,
  task: ModelTask,
  taskKind: ModelCallTaskKind,
  options: RoutedGenerateTextOptions,
  onFallback: (fallback: AgentModelFallback) => Promise<void>,
): Promise<RoutedGenerateTextResult> {
  const { generateText } = await import("ai");
  let executionStarted = false;
  const originalOnStepFinish = options.onStepFinish;
  const originalOnToolCallStart = options.experimental_onToolCallStart;
  const primaryOptions = {
    ...options,
    onStepFinish: async (
      ...args: Parameters<NonNullable<typeof originalOnStepFinish>>
    ) => {
      executionStarted = true;
      await originalOnStepFinish?.(...args);
    },
    experimental_onToolCallStart: async (
      ...args: Parameters<NonNullable<typeof originalOnToolCallStart>>
    ) => {
      executionStarted = true;
      await originalOnToolCallStart?.(...args);
    },
  } as RoutedGenerateTextOptions;

  const run = async (
    model: LanguageModel,
    route: ModelRoute,
    runOptions: RoutedGenerateTextOptions,
  ) => {
    const result = withGeneratedText(
      await generateText(
        withModelTimeout({
          ...runOptions,
          model,
          providerOptions: mergeProviderOptions(
            getProviderOptionsForRoute(route),
            runOptions.providerOptions,
          ),
        } as AiGenerateTextOptions),
      ),
    );
    const audit = collectToolAudit(result);
    if (
      audit.usedTools.length === 0 &&
      (!generatedTextFromResult(result).trim() ||
        result.finishReason === "length")
    ) {
      throw new AgentIncompleteOutputError(result.finishReason);
    }
    return result;
  };

  try {
    const result = await run(resolved.model, resolved.route, primaryOptions);
    const routerFailure = resolved.routerFailures.at(-1);
    const failedAttempt = routerFailure?.attempts.at(-1);
    const directFallback = routerFailure
      ? {
          from: failedAttempt
            ? { provider: failedAttempt.provider, model: failedAttempt.model }
            : resolved.route,
          to: resolved.route,
          reason: routerFailure.message,
        }
      : undefined;
    return {
      ...result,
      route: resolved.route,
      routeSource: directFallback ? "fallback" : resolved.routeSource,
      transport: directFallback ? "direct" : resolved.transport,
      ...(directFallback ? { fallback: directFallback } : {}),
      ...(routerFailure ? { clRouterFailure: routerFailure } : {}),
      ...(resolved.routerResponses.length > 0
        ? { clRouter: resolved.routerResponses.at(-1) }
        : {}),
    };
  } catch (error) {
    const incompleteOutput = error instanceof AgentIncompleteOutputError;
    if (
      (executionStarted && !incompleteOutput) ||
      (!incompleteOutput && !isPreExecutionFallbackEligibleError(error))
    ) {
      throw error;
    }
    const fallbackRoute = fallbackRouteForCall({
      task,
      taskKind,
      primaryRoute: resolved.route,
      fallbackRoute: resolved.fallbackRoute,
      allowFallback: resolved.allowFallback,
    });
    if (
      !fallbackRoute ||
      !modelRouteSupportsTask(task, fallbackRoute) ||
      (fallbackRoute.provider === resolved.route.provider &&
        fallbackRoute.model === resolved.route.model)
    ) {
      throw error;
    }
    const fallback: AgentModelFallback = {
      from: resolved.route,
      to: fallbackRoute,
      reason: errorText(error),
    };
    let fallbackModel: LanguageModel;
    try {
      fallbackModel = modelFromRoute(fallbackRoute);
    } catch {
      throw error;
    }
    await onFallback(fallback);
    console.warn(
      `[model-routing] Pre-execution ${resolved.route.provider}:${resolved.route.model} failure; using ${fallbackRoute.provider}:${fallbackRoute.model}. ${fallback.reason}`,
    );
    let result;
    try {
      result = await run(fallbackModel, fallbackRoute, options);
    } catch (fallbackError) {
      throw new AgentModelFallbackAttemptError(fallback, fallbackError);
    }
    return {
      ...result,
      route: fallbackRoute,
      routeSource: "fallback",
      transport: "direct",
      fallback,
      ...(resolved.routerFailures.length > 0
        ? { clRouterFailure: resolved.routerFailures.at(-1) }
        : {}),
    };
  }
}

export async function generateAgentTextForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  run: AgentModelRunOptions,
): Promise<RoutedGenerateTextResult> {
  let resolved: ResolvedAgentLanguageModel | undefined;
  try {
    const resolvedModel = await getAgentLanguageModelForOrg(
      ctx,
      orgId,
      task,
      run,
    );
    resolved = resolvedModel;
    const result = await generateAgentTextForResolvedModel(
      resolvedModel,
      task,
      run.taskKind,
      options,
      (fallback) =>
        recordAgentRoutingFallback(
          ctx,
          orgId,
          task,
          run,
          resolvedModel,
          fallback,
          Boolean(options.tools && Object.keys(options.tools).length > 0),
        ),
    );
    await recordAgentRun(
      ctx,
      orgId,
      task,
      run,
      result,
      undefined,
      undefined,
      resolvedModel.routerResponses.at(-1),
      undefined,
      options.maxOutputTokens,
    );
    return result;
  } catch (error) {
    const failedFallback =
      error instanceof AgentModelFallbackAttemptError
        ? error.fallback
        : undefined;
    await recordAgentRun(
      ctx,
      orgId,
      task,
      run,
      undefined,
      error,
      undefined,
      resolved?.routerResponses.at(-1),
      resolved
        ? {
            route: failedFallback?.to ?? resolved.route,
            routeSource: failedFallback ? "fallback" : resolved.routeSource,
            transport: failedFallback ? "direct" : resolved.transport,
            fallback: failedFallback,
          }
        : undefined,
      options.maxOutputTokens,
      resolved?.routerFailures.at(-1),
    );
    throw error;
  }
}

export async function generateAgentTextForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  run: AgentModelRunOptions,
): Promise<RoutedGenerateTextResult> {
  let resolved: ResolvedAgentLanguageModel | undefined;
  try {
    const resolvedModel = await getAgentLanguageModelForPublicTask(
      ctx,
      task,
      run,
    );
    resolved = resolvedModel;
    const result = await generateAgentTextForResolvedModel(
      resolvedModel,
      task,
      run.taskKind,
      options,
      (fallback) =>
        recordAgentRoutingFallback(
          ctx,
          undefined,
          task,
          run,
          resolvedModel,
          fallback,
          Boolean(options.tools && Object.keys(options.tools).length > 0),
        ),
    );
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      result,
      undefined,
      undefined,
      resolvedModel.routerResponses.at(-1),
      undefined,
      options.maxOutputTokens,
    );
    return result;
  } catch (error) {
    const failedFallback =
      error instanceof AgentModelFallbackAttemptError
        ? error.fallback
        : undefined;
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      undefined,
      error,
      undefined,
      resolved?.routerResponses.at(-1),
      resolved
        ? {
            route: failedFallback?.to ?? resolved.route,
            routeSource: failedFallback ? "fallback" : resolved.routeSource,
            transport: failedFallback ? "direct" : resolved.transport,
            fallback: failedFallback,
          }
        : undefined,
      options.maxOutputTokens,
      resolved?.routerFailures.at(-1),
    );
    throw error;
  }
}

export async function getAgentLanguageModelForOperatorTask(
  ctx: ActionCtx,
  task: Extract<ModelTask, "chat" | "chat_vision">,
  run: AgentModelRunOptions,
): Promise<ResolvedAgentLanguageModel> {
  assertAgentModelRunOptions(run);
  const route: ModelRoute = await ctx.runQuery(
    internal.modelSettings.resolveOperatorAgentRoute,
    {},
  );
  if (!modelRouteSupportsTask("chat_vision", route)) {
    throw new Error(
      "The manually selected operator-agent model must support image input",
    );
  }
  if (!modelRouteSupportsTask(task, route)) {
    throw new Error(
      `The manually selected operator-agent model cannot run ${task}`,
    );
  }
  return {
    model: modelFromRoute(route),
    route,
    routeSource: "global",
    transport: "direct",
    fallbackRoute: route,
    allowFallback: false,
    routerResponses: [],
    routerFailures: [],
  };
}

/**
 * Operator inference is an explicit direct-provider boundary. It never calls
 * cl-router and never falls back to a provider/model the operator did not pick.
 */
export async function generateAgentTextForOperatorTask(
  ctx: ActionCtx,
  task: Extract<ModelTask, "chat" | "chat_vision">,
  options: RoutedGenerateTextOptions,
  run: AgentModelRunOptions,
): Promise<RoutedGenerateTextResult> {
  let resolved: ResolvedAgentLanguageModel | undefined;
  try {
    resolved = await getAgentLanguageModelForOperatorTask(ctx, task, run);
    const result = await generateAgentTextForResolvedModel(
      resolved,
      task,
      run.taskKind,
      options,
      async () => {
        throw new Error("Operator agent model fallback is disabled");
      },
    );
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      result,
      undefined,
      undefined,
      undefined,
      undefined,
      options.maxOutputTokens,
    );
    return result;
  } catch (error) {
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      undefined,
      error,
      undefined,
      undefined,
      resolved
        ? {
            route: resolved.route,
            routeSource: resolved.routeSource,
            transport: "direct",
          }
        : undefined,
      options.maxOutputTokens,
    );
    throw error;
  }
}

export async function generateTextForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateTextResult> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved =
      settings === undefined
        ? await getModelAndRouteForOrg(ctx, orgId, task)
        : getModelAndRouteForSettingsSnapshot(settings, task);
    return generateTextForResolvedRoute(
      resolved,
      task,
      options,
      fallbackContext,
    );
  };
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind))
    return direct();
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    options,
  );
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return withClRouterDirectFallback({
    router: async () =>
      routedTextResultFromClRouter(
        await clRouterGenerate(
          {
            task,
            taskKind: fallbackContext?.taskKind,
            orgId,
            settings,
            ...input,
            routing: clRouterRoutingForCall(
              settings,
              task,
              fallbackContext?.taskKind,
              fallbackContext,
            ),
            trace: {
              label: "convex.models.generateTextForOrg",
              ...(fallbackContext?.taskKind
                ? { taskKind: fallbackContext.taskKind }
                : {}),
            },
          },
          { abortSignal: options.abortSignal },
        ),
      ),
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(task, error),
  });
}

export async function generateObjectForOrg<T>(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateObjectOptions<T>,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateObjectResult<T>> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved =
      settings === undefined
        ? await getModelAndRouteForOrg(ctx, orgId, task)
        : getModelAndRouteForSettingsSnapshot(settings, task);
    return generateObjectForResolvedRoute(
      resolved,
      task,
      options,
      fallbackContext,
    );
  };
  const { schema, ...textOptions } = options;
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind))
    return direct();
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    textOptions,
  );
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return withClRouterDirectFallback({
    router: async () =>
      routedObjectResultFromClRouter(
        await clRouterGenerate(
          {
            task,
            taskKind: fallbackContext?.taskKind,
            orgId,
            settings,
            ...input,
            schema: z.toJSONSchema(schema) as Record<string, unknown>,
            schemaDialect: "https://json-schema.org/draft/2020-12/schema",
            routing: clRouterRoutingForCall(
              settings,
              task,
              fallbackContext?.taskKind,
              fallbackContext,
            ),
            trace: {
              label: "convex.models.generateObjectForOrg",
              ...(fallbackContext?.taskKind
                ? { taskKind: fallbackContext.taskKind }
                : {}),
            },
          },
          { abortSignal: textOptions.abortSignal },
        ),
        schema,
      ),
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(task, error),
  });
}

export async function generateTextForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateTextResult> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved =
      settings === undefined
        ? await getModelAndRouteForPublicTask(ctx, task)
        : getModelAndRouteForPublicSettingsSnapshot(settings, task);
    return generateTextForResolvedRoute(
      resolved,
      task,
      options,
      fallbackContext,
    );
  };
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind))
    return direct();
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    options,
  );
  const settings = await clRouterSettingsForPublicTask(ctx);
  return withClRouterDirectFallback({
    router: async () =>
      routedTextResultFromClRouter(
        await clRouterGenerate(
          {
            task,
            taskKind: fallbackContext?.taskKind,
            settings,
            ...input,
            routing: clRouterRoutingForCall(
              settings,
              task,
              fallbackContext?.taskKind,
              fallbackContext,
            ),
            trace: {
              label: "convex.models.generateTextForPublicTask",
              ...(fallbackContext?.taskKind
                ? { taskKind: fallbackContext.taskKind }
                : {}),
            },
          },
          { abortSignal: options.abortSignal },
        ),
      ),
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(task, error),
  });
}

export async function generateObjectForPublicTask<T>(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateObjectOptions<T>,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateObjectResult<T>> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved =
      settings === undefined
        ? await getModelAndRouteForPublicTask(ctx, task)
        : getModelAndRouteForPublicSettingsSnapshot(settings, task);
    return generateObjectForResolvedRoute(
      resolved,
      task,
      options,
      fallbackContext,
    );
  };
  const { schema, ...textOptions } = options;
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind))
    return direct();
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    textOptions,
  );
  const settings = await clRouterSettingsForPublicTask(ctx);
  return withClRouterDirectFallback({
    router: async () =>
      routedObjectResultFromClRouter(
        await clRouterGenerate(
          {
            task,
            taskKind: fallbackContext?.taskKind,
            settings,
            ...input,
            schema: z.toJSONSchema(schema) as Record<string, unknown>,
            schemaDialect: "https://json-schema.org/draft/2020-12/schema",
            routing: clRouterRoutingForCall(
              settings,
              task,
              fallbackContext?.taskKind,
              fallbackContext,
            ),
            trace: {
              label: "convex.models.generateObjectForPublicTask",
              ...(fallbackContext?.taskKind
                ? { taskKind: fallbackContext.taskKind }
                : {}),
            },
          },
          { abortSignal: textOptions.abortSignal },
        ),
        schema,
      ),
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(task, error),
  });
}

export function availableProviders(): string[] {
  const providers: string[] = [];
  if (directProviderApiKey("openai")) providers.push("openai");
  if (directProviderApiKey("anthropic")) providers.push("anthropic");
  if (directProviderApiKey("google")) providers.push("google");
  if (directProviderApiKey("xai")) providers.push("xai");
  if (directProviderApiKey("mistral")) providers.push("mistral");
  if (directProviderApiKey("cohere")) providers.push("cohere");
  if (directProviderApiKey("fireworks")) providers.push("fireworks");
  if (directProviderApiKey("deepseek")) providers.push("deepseek");
  return providers;
}
