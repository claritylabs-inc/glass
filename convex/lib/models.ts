"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { gateway, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  FALLBACK_MODEL,
  MODEL_ROUTING,
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
 *   OPENAI_API_KEY — direct OpenAI access for default Glass routes
 *   AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN — Vercel AI Gateway access for routes whose provider is not directly configured
 */

// Lazy provider factories
let _anthropic: ReturnType<typeof createAnthropic> | null = null;
let _openai: ReturnType<typeof createOpenAI> | null = null;
let _deepseek: ReturnType<typeof createDeepSeek> | null = null;
let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let _xai: ReturnType<typeof createXai> | null = null;
let _mistral: ReturnType<typeof createMistral> | null = null;
let _cohere: ReturnType<typeof createCohere> | null = null;

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

export { FALLBACK_MODEL, MODEL_ROUTING, type ModelProvider, type ModelRoute, type ModelTask };

export type ModelCallTaskKind =
  | "extraction_classify"
  | "extraction_form_inventory"
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
  | "application_classify"
  | "application_extract_fields"
  | "application_auto_fill"
  | "application_lookup"
  | "application_parse_answers"
  | "application_batch"
  | "application_email"
  | "application_pdf_mapping"
  | "pce_impact_analysis"
  | "pce_reply_parse"
  | "pce_packet_generation"
  | (string & {});

type ModelFallbackContext = {
  task?: ModelTask;
  taskKind?: ModelCallTaskKind;
  primaryRoute?: ModelRoute;
};

const GPT_55 = "gpt-5.5";
const CLAUDE_HAIKU = "claude-haiku-4-5-20251001";

export function getProviderOptionsForRoute(route: ModelRoute): ProviderOptions | undefined {
  if (route.provider === "openai" && route.model === GPT_55) {
    return { openai: { reasoningEffort: "none" } };
  }
  return undefined;
}

function isMissingApiKeyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /api key is missing/i.test(message);
}

const LOW_COST_NO_ESCALATION_TASKS = new Set<ModelTask>([
  "classification",
  "extraction",
  "email_extraction",
  "document_extraction",
]);

const INTENTIONAL_QUALITY_ESCALATION_TASK_KINDS = new Set<string>([
  // Validation / repair passes over extracted or reasoned output.
  "extraction_review",
  "query_verify",
  // Ambiguous synthesis over retrieved evidence or requested changes.
  "query_reason",
  "pce_impact_analysis",
  // Source-evidence support where the cheap path may fail to resolve references.
  "extraction_referential_lookup",
  // High-risk carrier-facing packet generation.
  "pce_packet_generation",
]);

function sameRoute(left?: ModelRoute, right?: ModelRoute): boolean {
  return !!left && !!right && left.provider === right.provider && left.model === right.model;
}

export function modelTaskForCall(baseTask: ModelTask, taskKind?: ModelCallTaskKind): ModelTask {
  if (!taskKind) return baseTask;
  if (taskKind === "extraction_classify") return "classification";
  if (taskKind.startsWith("extraction_")) return "extraction";
  if (taskKind === "query_classify") return "classification";
  if (taskKind.startsWith("query_")) return "chat";
  if (taskKind === "application_classify") return "classification";
  if (taskKind.startsWith("application_")) return "application_authoring";
  if (taskKind.startsWith("pce_")) return "analysis";
  return baseTask;
}

export function fallbackRouteForCall({
  task,
  taskKind,
  primaryRoute,
}: ModelFallbackContext): ModelRoute | null {
  const effectiveTask = task && modelTaskForCall(task, taskKind);
  const effectivePrimaryRoute =
    primaryRoute ?? (effectiveTask ? MODEL_ROUTING[effectiveTask] : undefined);

  if (sameRoute(effectivePrimaryRoute, FALLBACK_MODEL)) return null;

  if (taskKind && INTENTIONAL_QUALITY_ESCALATION_TASK_KINDS.has(taskKind)) {
    return FALLBACK_MODEL;
  }

  if (effectiveTask && LOW_COST_NO_ESCALATION_TASKS.has(effectiveTask)) {
    return null;
  }

  return FALLBACK_MODEL;
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
    case "moonshot":
      throw new Error("Moonshot routing is disabled");
    case "deepseek":
      return (apiKey ? createDeepSeek({ apiKey }) : deepseek())(model);
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
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
    case "moonshot":
      return undefined;
  }
}

function gatewayModelId(route: ModelRoute): string {
  return route.model.includes("/") ? route.model : `${route.provider}/${route.model}`;
}

function nativeProviderModel(route: ModelRoute): string | null {
  switch (route.provider) {
    case "anthropic":
      if (route.model === "claude-3-haiku") return "claude-3-haiku-20240307";
      return route.model.replace(/\.(\d+)/g, "-$1");
    case "deepseek":
      return route.model === "deepseek-chat" || route.model === "deepseek-reasoner"
        ? route.model
        : null;
    case "moonshot":
      return null;
    default:
      return route.model;
  }
}

function modelFromRoute(route: ModelRoute, apiKey?: string): LanguageModel {
  const nativeModel = nativeProviderModel(route);
  if (apiKey && nativeModel) {
    return providerModel(route.provider, nativeModel, apiKey);
  }
  if (nativeModel && directProviderApiKey(route.provider)) {
    return providerModel(route.provider, nativeModel);
  }
  return gateway(gatewayModelId(route));
}

export function getModelForRoute(route: ModelRoute): LanguageModel {
  return modelFromRoute(route);
}

export function getModel(task: ModelTask): LanguageModel {
  if (task === "embeddings") {
    console.warn('Embeddings requested through getModel(), falling back to chat');
    return modelFromRoute(MODEL_ROUTING.chat);
  }
  try {
    return modelFromRoute(MODEL_ROUTING[task] ?? MODEL_ROUTING.chat);
  } catch {
    console.warn(`Provider for task "${task}" not available, falling back to Claude Haiku`);
    return anthropic()(CLAUDE_HAIKU);
  }
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
): Promise<{ model: LanguageModel; route: ModelRoute }> {
  try {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
    const configuredRoute = settings?.routes?.[task];
    const routeSource = settings?.routeSources?.[task];
    const configuredApiKey = routeSource === "broker" && configuredRoute
      ? settings?.providerKeys?.[configuredRoute.provider]
      : undefined;
    const canUseConfiguredRoute =
      configuredRoute &&
      configuredRoute.provider !== "moonshot" &&
      (routeSource !== "broker" || configuredApiKey);
    const route = canUseConfiguredRoute ? configuredRoute : MODEL_ROUTING[task];
    const apiKey = canUseConfiguredRoute ? configuredApiKey : undefined;
    return { model: modelFromRoute(route, apiKey), route };
  } catch (err) {
    console.warn(
      `Configured model for task "${task}" unavailable: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to static routing.`,
    );
    return { model: getModel(task), route: MODEL_ROUTING[task] };
  }
}

export async function generateTextWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
  fallbackContext: ModelFallbackContext = {},
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(options);
  } catch (err: unknown) {
    const modelId = (options.model as Record<string, unknown>)?.modelId as string || "unknown";
    if (isMissingApiKeyError(err)) throw err;
    const fallbackRoute = fallbackRouteForCall(fallbackContext);
    if (!fallbackRoute) throw err;
    console.warn(
      `Primary model (${modelId}) failed: ${err instanceof Error ? err.message : String(err)}. Retrying with ${fallbackRoute.model}.`,
    );
    return await generateText({
      ...options,
      model: modelFromRoute(fallbackRoute),
      providerOptions: mergeProviderOptions(
        getProviderOptionsForRoute(fallbackRoute),
        options.providerOptions,
      ),
    });
  }
}

export async function generateStructuredWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
  fallbackContext: ModelFallbackContext = {},
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(options);
  } catch (err: unknown) {
    const modelId = (options.model as Record<string, unknown>)?.modelId as string || "unknown";
    if (isMissingApiKeyError(err)) throw err;
    const fallbackRoute = fallbackRouteForCall(fallbackContext);
    if (!fallbackRoute) throw err;
    console.warn(
      `Primary model (${modelId}) failed for structured output: ${err instanceof Error ? err.message : String(err)}. Retrying with ${fallbackRoute.model}.`,
    );
    return await generateText({
      ...options,
      model: modelFromRoute(fallbackRoute),
      providerOptions: mergeProviderOptions(
        getProviderOptionsForRoute(fallbackRoute),
        options.providerOptions,
      ),
    });
  }
}

export function availableProviders(): string[] {
  const providers: string[] = [];
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY) providers.push("google");
  if (process.env.XAI_API_KEY) providers.push("xai");
  if (process.env.MISTRAL_API_KEY) providers.push("mistral");
  if (process.env.COHERE_API_KEY) providers.push("cohere");
  if (process.env.DEEPSEEK_API_KEY) providers.push("deepseek");
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) providers.push("gateway");
  return providers;
}
