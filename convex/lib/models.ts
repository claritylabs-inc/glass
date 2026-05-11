"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import type { LanguageModel } from "ai";
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
 *   OPENAI_API_KEY — GPT-5.5 for core agent work, GPT-5.4 nano/mini for extraction and fast isolated work
 *   ANTHROPIC_API_KEY — Claude Haiku fallback if the primary provider cannot initialize
 *   MOONSHOTAI_API_KEY — Kimi K2.5 (long-context analysis)
 */

// Lazy provider factories
let _anthropic: ReturnType<typeof createAnthropic> | null = null;
let _openai: ReturnType<typeof createOpenAI> | null = null;
let _moonshot: ReturnType<typeof createMoonshotAI> | null = null;
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

function moonshot() {
  if (!_moonshot) _moonshot = createMoonshotAI();
  return _moonshot;
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

const GPT_55 = "gpt-5.5";
const GPT_54_NANO = "gpt-5.4-nano";
const GPT_54_MINI = "gpt-5.4-mini";
const KIMI_K26 = "kimi-k2.6";
const CLAUDE_HAIKU = "claude-haiku-4-5-20251001";

const MODEL_CONFIG: Record<Exclude<ModelTask, "embeddings">, () => LanguageModel> = {
  chat:             () => openai()(GPT_54_MINI),
  email_draft:      () => openai()(GPT_54_MINI),
  email_reply:      () => openai()(GPT_54_MINI),
  analysis:         () => moonshot()(KIMI_K26),
  summary:          () => openai()(GPT_54_MINI),
  classification:   () => openai()(GPT_54_NANO),
  extraction:       () => openai()(GPT_54_NANO),
  triage:           () => openai()(GPT_54_MINI),
  email_extraction: () => openai()(GPT_54_NANO),
  document_extraction:   () => openai()(GPT_54_NANO),
  security:              () => openai()(GPT_54_MINI),
  application_authoring: () => moonshot()(KIMI_K26),
};

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

function isTerminalModelForFallback(modelId: string): boolean {
  return (
    modelId.includes(FALLBACK_MODEL.model) ||
    modelId.includes("gpt-5.4-nano") ||
    modelId.includes("claude-haiku")
  );
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
      return (apiKey ? createMoonshotAI({ apiKey }) : moonshot())(model);
    case "deepseek":
      return (apiKey ? createDeepSeek({ apiKey }) : deepseek())(model);
  }
}

function modelFromRoute(route: ModelRoute, apiKey?: string): LanguageModel {
  return providerModel(route.provider, route.model, apiKey);
}

export function getModel(task: ModelTask): LanguageModel {
  if (task === "embeddings") {
    console.warn('Embeddings requested through getModel(), falling back to chat');
    return MODEL_CONFIG.chat();
  }
  const factory = MODEL_CONFIG[task];
  if (!factory) {
    console.warn(`Unknown model task "${task}", falling back to chat`);
    return MODEL_CONFIG.chat();
  }
  try {
    return factory();
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
  try {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
    const configuredRoute = settings?.routes?.[task];
    const configuredApiKey = configuredRoute
      ? settings?.providerKeys?.[configuredRoute.provider]
      : undefined;
    const route = configuredRoute && configuredApiKey ? configuredRoute : MODEL_ROUTING[task];
    const apiKey = configuredRoute && configuredApiKey ? configuredApiKey : undefined;
    return modelFromRoute(route, apiKey);
  } catch (err) {
    console.warn(
      `Configured model for task "${task}" unavailable: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to static routing.`,
    );
    return getModel(task);
  }
}

export async function generateTextWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(options);
  } catch (err: unknown) {
    const modelId = (options.model as Record<string, unknown>)?.modelId as string || "unknown";
    if (isMissingApiKeyError(err)) throw err;
    // Do not retry models that are already on the low-cost/low-capacity path.
    // In particular, extraction runs on gpt-5.4-nano by design; escalating a
    // failed extraction call to a larger fallback model adds cost and can reintroduce
    // the over-optimization/overfitting behavior the extraction route avoids.
    if (isTerminalModelForFallback(modelId)) throw err;
    console.warn(
      `Primary model (${modelId}) failed: ${err instanceof Error ? err.message : String(err)}. Retrying with ${FALLBACK_MODEL.model}.`,
    );
    return await generateText({
      ...options,
      model: modelFromRoute(FALLBACK_MODEL),
      providerOptions: mergeProviderOptions(
        getProviderOptionsForRoute(FALLBACK_MODEL),
        options.providerOptions,
      ),
    });
  }
}

export async function generateStructuredWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(options);
  } catch (err: unknown) {
    const modelId = (options.model as Record<string, unknown>)?.modelId as string || "unknown";
    if (isMissingApiKeyError(err)) throw err;
    if (isTerminalModelForFallback(modelId)) throw err;
    console.warn(
      `Primary model (${modelId}) failed for structured output: ${err instanceof Error ? err.message : String(err)}. Retrying with ${FALLBACK_MODEL.model}.`,
    );
    return await generateText({
      ...options,
      model: modelFromRoute(FALLBACK_MODEL),
      providerOptions: mergeProviderOptions(
        getProviderOptionsForRoute(FALLBACK_MODEL),
        options.providerOptions,
      ),
    });
  }
}

export function availableProviders(): string[] {
  const providers: string[] = [];
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.DEEPSEEK_API_KEY) providers.push("deepseek");
  if (process.env.MOONSHOT_API_KEY) providers.push("moonshot");
  return providers;
}
