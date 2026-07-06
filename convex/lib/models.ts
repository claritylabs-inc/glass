"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  EXTRACTION_QUALITY_MODEL,
  FALLBACK_MODEL,
  COVERAGE_CLEANUP_MODEL,
  FIREWORKS_MODEL_IDS,
  QUALITY_ESCALATION_TASK_KINDS,
  QUALITY_PRIMARY_TASK_KINDS,
  MODEL_ROUTING,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  directProviderModelForRoute,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./modelCatalog";

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
 * Main Glass model routing is direct-provider only. Vercel AI Gateway remains
 * isolated to web retrieval in convex/lib/webRetrieval.ts.
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

export type ModelTransport = "direct" | "gateway";
export type ModelRouteSource = "broker" | "global" | "static" | "default";

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

const LOW_COST_NO_ESCALATION_TASKS = new Set<ModelTask>([
  "classification",
  "extraction",
  "email_extraction",
  "document_extraction",
]);

const QUALITY_ESCALATION_TASK_KIND_SET = new Set<string>(QUALITY_ESCALATION_TASK_KINDS);
const QUALITY_PRIMARY_TASK_KIND_SET = new Set<string>(QUALITY_PRIMARY_TASK_KINDS);

function sameRoute(left?: ModelRoute, right?: ModelRoute): boolean {
  return !!left && !!right && left.provider === right.provider && left.model === right.model;
}

export function modelTaskForCall(baseTask: ModelTask, taskKind?: ModelCallTaskKind): ModelTask {
  if (!taskKind) return baseTask;
  if (taskKind === "extraction_classify") return "classification";
  if (taskKind.startsWith("extraction_")) return "extraction";
  if (taskKind === "query_classify") return "classification";
  if (taskKind.startsWith("query_")) return "chat";
  if (taskKind.startsWith("pce_")) return "analysis";
  return baseTask;
}

export function fallbackRouteForCall({
  task,
  taskKind,
  primaryRoute,
  fallbackRoute = FALLBACK_MODEL,
  allowFallback = true,
}: ModelFallbackContext): ModelRoute | null {
  if (!allowFallback) return null;

  const effectiveTask = task && modelTaskForCall(task, taskKind);
  const effectivePrimaryRoute =
    primaryRoute ?? (effectiveTask ? MODEL_ROUTING[effectiveTask] : undefined);

  if (sameRoute(effectivePrimaryRoute, fallbackRoute)) return null;

  if (taskKind && QUALITY_ESCALATION_TASK_KIND_SET.has(taskKind)) {
    return fallbackRoute;
  }

  if (effectiveTask && LOW_COST_NO_ESCALATION_TASKS.has(effectiveTask)) {
    return null;
  }

  return fallbackRoute;
}

export function primaryRouteForCall({
  task,
  taskKind,
  qualityRoute = EXTRACTION_QUALITY_MODEL,
}: ModelFallbackContext): ModelRoute | null {
  if (!taskKind || !QUALITY_PRIMARY_TASK_KIND_SET.has(taskKind)) return null;
  const effectiveTask = task && modelTaskForCall(task, taskKind);
  if (effectiveTask !== "extraction") return null;
  return qualityRoute;
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
  if (task === "embeddings") {
    console.warn('Embeddings requested through getModel(), falling back to chat');
    return modelFromRoute(MODEL_ROUTING.chat);
  }
  return modelFromRoute(MODEL_ROUTING[task] ?? MODEL_ROUTING.chat);
}

export async function getModelForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
): Promise<LanguageModel> {
  return (await getModelAndRouteForOrg(ctx, orgId, task)).model;
}

export async function getModelAndRouteForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
): Promise<{
  model: LanguageModel;
  route: ModelRoute;
  routeSource: ModelRouteSource;
  transport: ModelTransport;
  qualityRoute: ModelRoute;
  qualityRouteSource: "broker" | "global" | "static";
  coverageCleanupRoute: ModelRoute;
  coverageCleanupRouteSource: "broker" | "global" | "static";
  fallbackRoute: ModelRoute;
}> {
  try {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
    const configuredRoute = settings?.routes?.[task];
    const routeSource = settings?.routeSources?.[task];
    const qualityRoute = settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
    const qualityRouteSource = settings?.routeSources?.extraction_quality ?? "static";
    const coverageCleanupRoute =
      settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
    const coverageCleanupRouteSource = settings?.routeSources?.extraction_coverage_cleanup ?? "static";
    const fallbackRoute = settings?.routes?.fallback ?? FALLBACK_MODEL;
    const configuredApiKey = routeSource === "broker" && configuredRoute
      ? settings?.providerKeys?.[configuredRoute.provider]
      : undefined;
    const canUseConfiguredRoute =
      configuredRoute &&
      configuredRoute.provider !== "moonshot" &&
      !!directProviderModelForRoute(configuredRoute) &&
      !!routeDirectApiKey(configuredRoute, configuredApiKey);
    const route = canUseConfiguredRoute ? configuredRoute : MODEL_ROUTING[task];
    const apiKey = canUseConfiguredRoute ? configuredApiKey : undefined;
    return {
      model: modelFromRoute(route, apiKey),
      route,
      routeSource: canUseConfiguredRoute ? (routeSource ?? "global") : "default",
      transport: "direct",
      qualityRoute,
      qualityRouteSource,
      coverageCleanupRoute,
      coverageCleanupRouteSource,
      fallbackRoute,
    };
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
  try {
    const settings = await ctx.runQuery(internal.modelSettings.resolvePublicDefaults, {});
    const route = settings?.routes?.[task] ?? MODEL_ROUTING[task];
    const routeSource = settings?.routeSources?.[task] ?? "static";
    const qualityRoute = settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
    const qualityRouteSource = settings?.routeSources?.extraction_quality ?? "static";
    const coverageCleanupRoute =
      settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
    const coverageCleanupRouteSource = settings?.routeSources?.extraction_coverage_cleanup ?? "static";
    const fallbackRoute = settings?.routes?.fallback ?? FALLBACK_MODEL;
    return {
      model: modelFromRoute(route),
      route,
      routeSource,
      transport: "direct",
      qualityRoute,
      qualityRouteSource,
      coverageCleanupRoute,
      coverageCleanupRouteSource,
      fallbackRoute,
    };
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
