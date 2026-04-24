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
 *   ANTHROPIC_API_KEY — Claude Haiku (classification), Claude Sonnet (extraction/fallback)
 *   DEEPSEEK_API_KEY — DeepSeek V3 (primary for chat/tool-calling Q&A)
 *   MOONSHOTAI_API_KEY — Kimi K2.5 (reasoning: analysis, email writing)
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

const MODEL_CONFIG: Record<Exclude<ModelTask, "embeddings">, () => LanguageModel> = {
  chat:             () => openai()("gpt-5.4-mini"),
  email_draft:      () => moonshot()("kimi-k2.5"),
  email_reply:      () => moonshot()("kimi-k2.5"),
  analysis:         () => moonshot()("kimi-k2.5"),
  summary:          () => anthropic()("claude-haiku-4-5-20251001"),
  classification:   () => anthropic()("claude-haiku-4-5-20251001"),
  extraction:       () => openai()("gpt-5.4-mini"),
  triage:           () => openai()("gpt-5.4-nano"),
  email_extraction: () => openai()("gpt-5.4-nano"),
  document_extraction:   () => anthropic()("claude-haiku-4-5-20251001"),
  security:              () => openai()("gpt-4.1-nano"),
  application_authoring: () => openai()("gpt-5.4-mini"),
};

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
    return anthropic()("claude-haiku-4-5-20251001");
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
    // If already on a fallback model, don't retry
    if (modelId.includes("gpt-5.4-mini") || modelId.includes("claude-haiku")) throw err;
    console.warn(
      `Primary model (${modelId}) failed: ${err instanceof Error ? err.message : String(err)}. Retrying with GPT-5.4-mini.`,
    );
    return await generateText({
      ...options,
      model: openai()("gpt-5.4-mini"),
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
    if (modelId.includes("gpt-5.4-mini") || modelId.includes("claude-haiku")) throw err;
    console.warn(
      `Primary model (${modelId}) failed for structured output: ${err instanceof Error ? err.message : String(err)}. Retrying with GPT-5.4-mini.`,
    );
    return await generateText({
      ...options,
      model: openai()("gpt-5.4-mini"),
    });
  }
}

export function availableProviders(): string[] {
  const providers: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.DEEPSEEK_API_KEY) providers.push("deepseek");
  if (process.env.MOONSHOT_API_KEY) providers.push("moonshot");
  return providers;
}
