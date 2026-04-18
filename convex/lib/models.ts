"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";

/**
 * Centralized model configuration for Prism.
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function deepseek() {
  if (!_deepseek) _deepseek = createDeepSeek();
  return _deepseek;
}

/**
 * Task types used throughout the codebase.
 */
export type ModelTask =
  | "chat"
  | "email_draft"
  | "email_reply"
  | "extraction"
  | "classification"
  | "analysis"
  | "summary"
  | "triage"
  | "email_extraction"
  | "security";

/**
 * Model routing.
 *
 * GPT-5.4 mini: chat, tools, extraction (strong structured output)
 * GPT-5.4 nano: triage, email extraction (cheap, high token limits)
 * GPT-4.1 nano: security classification (cheapest available)
 * Kimi K2.5: analysis, email drafting (256K context)
 * Claude Haiku: classification, summary (fast, cheap) + fallback
 */
/** Static metadata for each task — exposed via the /weather page. */
export const MODEL_ROUTING: Record<ModelTask, { model: string; provider: string }> = {
  chat:             { model: "gpt-5.4-mini",              provider: "OpenAI" },
  email_draft:      { model: "kimi-k2.5",                 provider: "MoonshotAI" },
  email_reply:      { model: "kimi-k2.5",                 provider: "MoonshotAI" },
  analysis:         { model: "kimi-k2.5",                 provider: "MoonshotAI" },
  summary:          { model: "claude-haiku-4-5-20251001",  provider: "Anthropic" },
  classification:   { model: "claude-haiku-4-5-20251001",  provider: "Anthropic" },
  extraction:       { model: "gpt-5.4-mini",              provider: "OpenAI" },
  triage:           { model: "gpt-5.4-nano",              provider: "OpenAI" },
  email_extraction: { model: "gpt-5.4-nano",              provider: "OpenAI" },
  security:         { model: "gpt-4.1-nano",              provider: "OpenAI" },
};

export const FALLBACK_MODEL = { model: "gpt-5.4-mini", provider: "OpenAI" };

const MODEL_CONFIG: Record<ModelTask, () => LanguageModel> = {
  chat:             () => openai()("gpt-5.4-mini"),
  email_draft:      () => moonshot()("kimi-k2.5"),
  email_reply:      () => moonshot()("kimi-k2.5"),
  analysis:         () => moonshot()("kimi-k2.5"),
  summary:          () => anthropic()("claude-haiku-4-5-20251001"),
  classification:   () => anthropic()("claude-haiku-4-5-20251001"),
  extraction:       () => openai()("gpt-5.4-mini"),
  triage:           () => openai()("gpt-5.4-nano"),
  email_extraction: () => openai()("gpt-5.4-nano"),
  security:         () => openai()("gpt-4.1-nano"),
};

export function getModel(task: ModelTask): LanguageModel {
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
