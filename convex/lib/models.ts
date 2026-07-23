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
  sendClRouterFeedback,
  shouldUseClRouterForCall,
  shouldUseClRouterForTask,
  withClRouterDirectFallback,
  type ClRouterGenerateRequest,
  type ClRouterMessage,
  type ClRouterResponseMetadata,
  type ClRouterSettingsSnapshot,
  type ClRouterUsage,
} from "./clRouterClient";
import {
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
 * Centralized model configuration for Glass.
 *
 * Maps each task type to a provider + model. Tune costs and quality from one place.
 * All models accessed via Vercel AI SDK's provider-agnostic interface.
 *
 * Env vars needed:
 *   FIREWORKS_API_KEY — direct Fireworks access for default Glass language routes
 *   OPENAI_API_KEY — direct OpenAI access for embedding routes during the migration
 *
 * Glass model routing is direct-provider only. Vercel AI Gateway is not a
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
};
export type AgentModelRunOptions = {
  sessionKey: string;
  taskKind: ModelCallTaskKind;
  trace: {
    traceId: string;
    parentRequestId?: string;
    label: string;
    phase: string;
    channel: "web" | "imessage" | "mcp" | "email" | "mailbox" | "public_demo";
  };
  onResponse?: ClRouterLanguageModelOptions["onResponse"];
  onDirectFallback?: ClRouterLanguageModelOptions["onDirectFallback"];
};
export type ResolvedAgentLanguageModel = ResolvedModelRoute & {
  transport: ModelTransport;
  routerResponses: ClRouterResponseMetadata[];
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

function withModelTimeout<T extends { abortSignal?: AbortSignal }>(options: T): T {
  return options.abortSignal ? options : { ...options, abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS) };
}

const GPT_55 = "gpt-5.5";

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function clRouterSettingsSnapshot(settings: unknown): ClRouterSettingsSnapshot | null {
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
        providerKeys: record.providerKeys as Partial<Record<ModelProvider, string>>,
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
): Pick<ClRouterGenerateRequest, "system" | "messages" | "prompt" | "maxTokens"> | null {
  const record = options as Record<string, unknown>;
  const supportedKeys = new Set(["system", "messages", "prompt", "maxOutputTokens"]);
  if (Object.keys(record).some((key) => record[key] !== undefined && !supportedKeys.has(key))) {
    return null;
  }
  if (record.system !== undefined && typeof record.system !== "string") return null;
  if (record.prompt !== undefined && typeof record.prompt !== "string") return null;
  const messages = record.messages === undefined ? undefined : clRouterMessages(record.messages);
  if (record.messages !== undefined && !messages) return null;
  if (record.prompt === undefined && messages === undefined) return null;
  if (record.maxOutputTokens !== undefined && typeof record.maxOutputTokens !== "number") {
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
): Pick<ClRouterGenerateRequest, "system" | "messages" | "prompt" | "maxTokens"> {
  const input = clRouterGenerateInput(options);
  if (input) return input;

  throw new ClRouterRequestError(
    "configuration",
    `cl-router is enabled for ${taskKind ?? task}, but this generation call uses options that the non-streaming router adapter cannot preserve; disable that CL_ROUTER_TASKS gate or route the call through the Glass-owned cl-router language-model tool loop`,
  );
}

function languageModelUsageFromClRouter(usage: ClRouterUsage): LanguageModelUsage {
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

function warnClRouterFallback(task: ModelTask, error: ClRouterRequestError): void {
  console.warn("cl-router unavailable; using direct provider fallback", {
    task,
    kind: error.kind,
    status: error.status,
  });
}

export function getProviderOptionsForRoute(route: ModelRoute): ProviderOptions | undefined {
  if (route.provider === "openai" && route.model === GPT_55) {
    return { openai: { reasoningEffort: "none" } };
  }
  return undefined;
}

function isMissingApiKeyError(err: unknown): boolean {
  const message = errorTextForMatching(err);
  return /api key is missing/i.test(message);
}

export function modelTaskForCall(baseTask: ModelTask, taskKind?: ModelCallTaskKind): ModelTask {
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

export function getProviderOptionsForTask(task: ModelTask): ProviderOptions | undefined {
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
  return Object.keys(merged).length > 0 ? (merged as ProviderOptions) : undefined;
}

function providerModel(provider: ModelProvider, model: string, apiKey?: string): LanguageModel {
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
      return (apiKey ? createFireworksLanguageProvider(apiKey) : fireworks())(model);
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
    case "moonshot":
      return undefined;
  }
}

function routeDirectApiKey(route: ModelRoute, apiKey?: string): string | undefined {
  return cleanEnv(apiKey) ?? directProviderApiKey(route.provider);
}

type AudioTranscriptionInput = {
  data: Buffer;
  filename: string;
  mediaType: string;
  prompt?: string;
};

type AudioTranscriptionResult = {
  text: string;
  route: ModelRoute;
  routeSource: ModelRouteSource;
  transport: ModelTransport;
  clRouter?: ClRouterResponseMetadata;
};

const AUDIO_TRANSCRIPTION_TASK = "voice_transcription" as const;
const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
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
): Promise<{ route: ModelRoute; apiKey: string; routeSource: ModelRouteSource }> {
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
  const configuredApiKey = allowBroker && rawRouteSource === "broker" && configuredRoute
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
      "Direct OpenAI API key is missing for voice memo transcription. AI Gateway is not a fallback for Glass model routing.",
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
    return { ...resolved, routeSource: resolved.routeSource === "global" ? "global" : "default" };
  } catch (error) {
    console.warn(
      `Global voice transcription route unavailable: ${
        error instanceof Error ? error.message : String(error)
      }. Falling back to static routing.`,
    );
  }

  const resolved = resolveAudioTranscriptionRouteForSettingsSnapshot(null, false);
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
    const resolved = settings === undefined
      ? await resolveAudioTranscriptionRouteForOrg(ctx, orgId)
      : resolveAudioTranscriptionRouteForSettingsSnapshot(settings, true);
    return transcribeAudioWithResolvedRoute(resolved, input);
  };
  if (!shouldUseClRouterForTask(AUDIO_TRANSCRIPTION_TASK)) return direct();
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return withClRouterDirectFallback({
    router: async () => {
      const response = await clRouterTranscribe({
        orgId,
        settings,
        data: new Uint8Array(input.data),
        filename: transcriptionFilename(input.filename, input.mediaType),
        mediaType: input.mediaType,
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
    },
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(AUDIO_TRANSCRIPTION_TASK, error),
  });
}

export async function transcribeAudioForPublicTask(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved = settings === undefined
      ? await resolveAudioTranscriptionRouteForPublicTask(ctx)
      : resolveAudioTranscriptionRouteForSettingsSnapshot(settings, false);
    return transcribeAudioWithResolvedRoute(resolved, input);
  };
  if (!shouldUseClRouterForTask(AUDIO_TRANSCRIPTION_TASK)) return direct();
  const settings = await clRouterSettingsForPublicTask(ctx);
  return withClRouterDirectFallback({
    router: async () => {
      const response = await clRouterTranscribe({
        settings,
        data: new Uint8Array(input.data),
        filename: transcriptionFilename(input.filename, input.mediaType),
        mediaType: input.mediaType,
        prompt: input.prompt,
        trace: { label: "convex.models.transcribeAudioForPublicTask" },
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
          routeSource === "global" || routeSource === "static" || routeSource === "default"
            ? routeSource
            : "default",
        transport: "cl-router" as const,
        clRouter: response,
      };
    },
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(AUDIO_TRANSCRIPTION_TASK, error),
  });
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
      `Direct ${route.provider} API key is missing for model route ${route.provider}/${route.model}. AI Gateway is not a fallback for Glass model routing.`,
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
        : "Voice memo transcription must use transcribeAudioForOrg or transcribeAudioForPublicTask, not getModel()",
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
  const qualityRoute = settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
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
  const configuredApiKey = routeSource === "broker" && configuredRoute
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
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
    return getModelAndRouteForSettingsSnapshot(clRouterSettingsSnapshot(settings), task);
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
    const settings = await ctx.runQuery(internal.modelSettings.resolvePublicDefaults, {});
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
  const qualityRoute = settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
  const coverageCleanupRoute =
    settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
  return {
    model: modelFromRoute(route),
    route,
    routeSource,
    transport: "direct",
    qualityRoute,
    qualityRouteSource:
      settings?.routeSources?.extraction_quality === "global" ? "global" : "static",
    coverageCleanupRoute,
    coverageCleanupRouteSource:
      settings?.routeSources?.extraction_coverage_cleanup === "global" ? "global" : "static",
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
    const modelId = (options.model as Record<string, unknown>)?.modelId as string || "unknown";
    if (isMissingApiKeyError(err)) throw err;
    const fallbackRoute = fallbackRouteForCall(fallbackContext);
    if (!fallbackRoute) throw err;
    console.warn(
      `Primary model (${modelId}) failed: ${
        err instanceof Error ? err.message : String(err)
      }. Retrying with ${fallbackRoute.model}.`,
    );
    return await generateText(withModelTimeout({
      ...options,
      model: modelFromRoute(fallbackRoute),
      providerOptions: mergeProviderOptions(
        getProviderOptionsForRoute(fallbackRoute),
        options.providerOptions,
      ),
    }));
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
    const modelId = (options.model as Record<string, unknown>)?.modelId as string || "unknown";
    if (isMissingApiKeyError(err)) throw err;
    const fallbackRoute = fallbackRouteForCall(fallbackContext);
    if (!fallbackRoute) throw err;
    console.warn(
      `Primary model (${modelId}) failed for structured output: ${
        err instanceof Error ? err.message : String(err)
      }. Retrying with ${fallbackRoute.model}.`,
    );
    return await generateText(withModelTimeout({
      ...options,
      model: modelFromRoute(fallbackRoute),
      providerOptions: mergeProviderOptions(
        getProviderOptionsForRoute(fallbackRoute),
        options.providerOptions,
      ),
    }));
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
  fallbackContext: Omit<ModelFallbackContext, "task" | "primaryRoute" | "fallbackRoute"> = {},
): Promise<RoutedGenerateTextResult> {
  const result = await generateTextWithFallback({
    ...options,
    model: resolved.model,
    providerOptions: routeProviderOptions(resolved, options.providerOptions),
  } as AiGenerateTextOptions, {
    ...fallbackContext,
    task,
    primaryRoute: resolved.route,
    fallbackRoute: resolved.fallbackRoute,
  });
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
  fallbackContext: Omit<ModelFallbackContext, "task" | "primaryRoute" | "fallbackRoute"> = {},
): Promise<RoutedGenerateObjectResult<T>> {
  const { schema, providerOptions, ...textOptions } = options;
  const result = await generateStructuredWithFallback({
    ...textOptions,
    model: resolved.model,
    output: Output.object({
      schema: structuredOutputSchemaForRoute(schema, resolved.route),
    }),
    providerOptions: routeProviderOptions(resolved, providerOptions),
  } as AiGenerateTextOptions, {
    ...fallbackContext,
    task,
    primaryRoute: resolved.route,
    fallbackRoute: resolved.fallbackRoute,
  });

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

function clRouterRoutingForFallbackContext(
  fallbackContext?: Omit<ModelFallbackContext, "task" | "primaryRoute" | "fallbackRoute">,
): ClRouterGenerateRequest["routing"] {
  return fallbackContext?.allowFallback === undefined
    ? undefined
    : { allowFallback: fallbackContext.allowFallback };
}

export async function resolveClRouterSettingsForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<ClRouterSettingsSnapshot | null> {
  const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
  return clRouterSettingsSnapshot(settings);
}

async function clRouterSettingsForPublicTask(
  ctx: ActionCtx,
): Promise<ClRouterSettingsSnapshot | null> {
  const settings = await ctx.runQuery(internal.modelSettings.resolvePublicDefaults, {});
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
      onResponse: async (response, step) => {
        routerResponses.push(response);
        await run.onResponse?.(response, step);
      },
      onDirectFallback: run.onDirectFallback,
    }),
    transport: "cl-router",
    routerResponses,
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
      await ctx.runMutation(
        internal.modelRoutingEvents.recordFallbackInternal,
        { run: eventRun, error: errorText(error), ...step },
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

function workflowQualityScore(outcomes: unknown[]): number | undefined {
  if (outcomes.length === 0) return undefined;
  const scores: number[] = outcomes.map((outcome) => {
    switch (workflowOutcomeStatus(outcome)) {
      case "completed":
        return 1;
      case "needs_input":
      case "held":
        return 0.75;
      case "running":
        return 0.5;
      case "failed_recoverably":
        return 0.25;
      case "failed_terminal":
        return 0;
      default:
        return 0.5;
    }
  });
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function workflowFailureCount(outcomes: unknown[]) {
  return outcomes.filter((outcome) => {
    const status = workflowOutcomeStatus(outcome);
    return status === "failed_recoverably" || status === "failed_terminal";
  }).length;
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
) {
  if (!shouldUseClRouterForCall(task, run.taskKind)) return;
  const audit =
    auditOverride ??
    (result
      ? collectToolAudit(result)
      : {
          usedTools: [],
          toolCalls: [],
          workflowOutcomes: [],
  });
  const failures = workflowFailureCount(audit.workflowOutcomes);
  const requestId =
    routerResponseOverride?.requestId ?? result?.clRouter?.requestId;
  try {
    await ctx.runMutation(internal.modelRoutingEvents.recordRunInternal, {
      run: routingEventRun(orgId, task, run),
      status: error ? "error" : "complete",
      ...(requestId ? { requestId } : {}),
      toolCallCount: audit.toolCalls.length,
      workflowOutcomeCount: audit.workflowOutcomes.length,
      workflowFailureCount: failures,
      ...(error ? { error: errorText(error) } : {}),
    });
  } catch (telemetryError) {
    console.warn(
      "[cl-router] Failed to record agent routing run",
      telemetryError,
    );
  }

  if (!requestId || audit.workflowOutcomes.length === 0) return;
  const qualityScore = error ? 0 : workflowQualityScore(audit.workflowOutcomes);
  if (qualityScore === undefined) return;
  try {
    await sendClRouterFeedback({
      requestId,
      idempotencyKey: `agent-workflow:${run.trace.traceId}:${requestId}`,
      signals: {
        qualityScore,
        escalationCount: failures + (error ? 1 : 0),
      },
      trace: {
        ...run.trace,
        task,
        taskKind: run.taskKind,
      },
    });
  } catch (feedbackError) {
    console.warn(
      "[cl-router] Failed to submit agent workflow feedback",
      feedbackError,
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
  );
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
    return { ...resolved, transport: "direct", routerResponses: [] };
  }
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  const resolved = getModelAndRouteForSettingsSnapshot(settings, task);
  return agentLanguageModel(
    task,
    String(orgId),
    settings,
    resolved,
    withAgentRoutingTelemetry(ctx, orgId, task, run),
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
    return { ...resolved, transport: "direct", routerResponses: [] };
  }
  const settings = await clRouterSettingsForPublicTask(ctx);
  const resolved = getModelAndRouteForPublicSettingsSnapshot(settings, task);
  return agentLanguageModel(
    task,
    undefined,
    settings,
    resolved,
    withAgentRoutingTelemetry(ctx, undefined, task, run),
  );
}

async function generateAgentTextForResolvedModel(
  resolved: ResolvedAgentLanguageModel,
  options: RoutedGenerateTextOptions,
): Promise<RoutedGenerateTextResult> {
  const { generateText } = await import("ai");
  const result = withGeneratedText(
    await generateText(
      withModelTimeout({
        ...options,
        model: resolved.model,
        providerOptions: routeProviderOptions(
          resolved,
          options.providerOptions,
        ),
      } as AiGenerateTextOptions),
    ),
  );
  return {
    ...result,
    route: resolved.route,
    routeSource: resolved.routeSource,
    transport: resolved.transport,
    ...(resolved.routerResponses.length > 0
      ? { clRouter: resolved.routerResponses.at(-1) }
      : {}),
  };
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
    resolved = await getAgentLanguageModelForOrg(ctx, orgId, task, run);
    const result = await generateAgentTextForResolvedModel(resolved, options);
    await recordAgentRun(ctx, orgId, task, run, result);
    return result;
  } catch (error) {
    await recordAgentRun(
      ctx,
      orgId,
      task,
      run,
      undefined,
      error,
      undefined,
      resolved?.routerResponses.at(-1),
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
    resolved = await getAgentLanguageModelForPublicTask(ctx, task, run);
    const result = await generateAgentTextForResolvedModel(resolved, options);
    await recordAgentRun(ctx, undefined, task, run, result);
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
      resolved?.routerResponses.at(-1),
    );
    throw error;
  }
}

export async function generateTextForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  fallbackContext?: Omit<ModelFallbackContext, "task" | "primaryRoute" | "fallbackRoute">,
): Promise<RoutedGenerateTextResult> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved = settings === undefined
      ? await getModelAndRouteForOrg(ctx, orgId, task)
      : getModelAndRouteForSettingsSnapshot(settings, task);
    return generateTextForResolvedRoute(resolved, task, options, fallbackContext);
  };
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind)) return direct();
  const input = clRouterGenerateInputForEnabledTask(task, fallbackContext?.taskKind, options);
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return withClRouterDirectFallback({
    router: async () => routedTextResultFromClRouter(await clRouterGenerate({
      task,
      taskKind: fallbackContext?.taskKind,
      orgId,
      settings,
      ...input,
      routing: clRouterRoutingForFallbackContext(fallbackContext),
      trace: {
        label: "convex.models.generateTextForOrg",
        ...(fallbackContext?.taskKind ? { taskKind: fallbackContext.taskKind } : {}),
      },
    })),
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(task, error),
  });
}

export async function generateObjectForOrg<T>(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateObjectOptions<T>,
  fallbackContext?: Omit<ModelFallbackContext, "task" | "primaryRoute" | "fallbackRoute">,
): Promise<RoutedGenerateObjectResult<T>> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved = settings === undefined
      ? await getModelAndRouteForOrg(ctx, orgId, task)
      : getModelAndRouteForSettingsSnapshot(settings, task);
    return generateObjectForResolvedRoute(resolved, task, options, fallbackContext);
  };
  const { schema, ...textOptions } = options;
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind)) return direct();
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    textOptions,
  );
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return withClRouterDirectFallback({
    router: async () => routedObjectResultFromClRouter(await clRouterGenerate({
      task,
      taskKind: fallbackContext?.taskKind,
      orgId,
      settings,
      ...input,
      schema: z.toJSONSchema(schema) as Record<string, unknown>,
      schemaDialect: "https://json-schema.org/draft/2020-12/schema",
      routing: clRouterRoutingForFallbackContext(fallbackContext),
      trace: {
        label: "convex.models.generateObjectForOrg",
        ...(fallbackContext?.taskKind ? { taskKind: fallbackContext.taskKind } : {}),
      },
    }), schema),
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(task, error),
  });
}

export async function generateTextForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  fallbackContext?: Omit<ModelFallbackContext, "task" | "primaryRoute" | "fallbackRoute">,
): Promise<RoutedGenerateTextResult> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved = settings === undefined
      ? await getModelAndRouteForPublicTask(ctx, task)
      : getModelAndRouteForPublicSettingsSnapshot(settings, task);
    return generateTextForResolvedRoute(resolved, task, options, fallbackContext);
  };
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind)) return direct();
  const input = clRouterGenerateInputForEnabledTask(task, fallbackContext?.taskKind, options);
  const settings = await clRouterSettingsForPublicTask(ctx);
  return withClRouterDirectFallback({
    router: async () => routedTextResultFromClRouter(await clRouterGenerate({
      task,
      taskKind: fallbackContext?.taskKind,
      settings,
      ...input,
      routing: clRouterRoutingForFallbackContext(fallbackContext),
      trace: {
        label: "convex.models.generateTextForPublicTask",
        ...(fallbackContext?.taskKind ? { taskKind: fallbackContext.taskKind } : {}),
      },
    })),
    direct: () => direct(settings),
    onFallback: (error) => warnClRouterFallback(task, error),
  });
}

export async function generateObjectForPublicTask<T>(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateObjectOptions<T>,
  fallbackContext?: Omit<ModelFallbackContext, "task" | "primaryRoute" | "fallbackRoute">,
): Promise<RoutedGenerateObjectResult<T>> {
  const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
    const resolved = settings === undefined
      ? await getModelAndRouteForPublicTask(ctx, task)
      : getModelAndRouteForPublicSettingsSnapshot(settings, task);
    return generateObjectForResolvedRoute(resolved, task, options, fallbackContext);
  };
  const { schema, ...textOptions } = options;
  if (!shouldUseClRouterForCall(task, fallbackContext?.taskKind)) return direct();
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    textOptions,
  );
  const settings = await clRouterSettingsForPublicTask(ctx);
  return withClRouterDirectFallback({
    router: async () => routedObjectResultFromClRouter(await clRouterGenerate({
      task,
      taskKind: fallbackContext?.taskKind,
      settings,
      ...input,
      schema: z.toJSONSchema(schema) as Record<string, unknown>,
      schemaDialect: "https://json-schema.org/draft/2020-12/schema",
      routing: clRouterRoutingForFallbackContext(fallbackContext),
      trace: {
        label: "convex.models.generateObjectForPublicTask",
        ...(fallbackContext?.taskKind ? { taskKind: fallbackContext.taskKind } : {}),
      },
    }), schema),
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
