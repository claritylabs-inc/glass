"use node";

/**
 * Provider-agnostic callback adapters for cl-sdk v0.5.0.
 *
 * Wraps Prism's existing AI SDK model routing (lib/models.ts) into the
 * simple callback interfaces the new SDK expects: GenerateText, GenerateObject, EmbedText.
 */

import { generateText, embed } from "ai";
import { stripFences } from "@claritylabs/cl-sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { getModel, type ModelTask } from "./models";
import type { GenerateText, GenerateObject, EmbedText, TokenUsage } from "@claritylabs/cl-sdk";

function mapUsage(aiSdkUsage: Record<string, any>): TokenUsage {
  return {
    inputTokens: aiSdkUsage.promptTokens ?? 0,
    outputTokens: aiSdkUsage.completionTokens ?? 0,
  };
}

/**
 * Create a GenerateText callback backed by Prism's model router.
 * The task parameter selects which model to use (extraction, classification, etc.).
 */
export function makeGenerateText(task: ModelTask = "extraction"): GenerateText {
  return async ({ prompt, system, maxTokens, providerOptions }) => {
    const result = await generateText({
      model: getModel(task),
      system,
      prompt,
      maxOutputTokens: maxTokens,
      providerOptions: providerOptions as any,
    });
    return {
      text: result.text,
      usage: mapUsage(result.usage),
    };
  };
}

/**
 * Create a GenerateObject callback backed by Prism's model router.
 *
 * Uses text generation + JSON parsing instead of Output.object() structured output.
 * Output.object() forces the provider to compile Zod schemas into constrained grammars,
 * which times out on complex insurance schemas (coverage_limits, endorsements, declarations)
 * causing "Grammar compilation timed out" errors and incomplete extractions.
 *
 * The cl-sdk prompts already instruct the model to return JSON — the Zod schema
 * validates the response, it doesn't need to constrain generation.
 */
export function makeGenerateObject(task: ModelTask = "extraction"): GenerateObject {
  return async ({ prompt, system, schema, maxTokens, providerOptions }) => {
    const jsonSystem = system
      ? `${system}\n\nRespond with valid JSON only. No markdown fences, no prose before or after.`
      : "Respond with valid JSON only. No markdown fences, no prose before or after.";

    const result = await generateText({
      model: getModel(task),
      system: jsonSystem,
      prompt,
      maxOutputTokens: maxTokens,
      providerOptions: providerOptions as any,
    });

    const cleaned = stripFences(result.text).trim();
    const parsed = JSON.parse(cleaned);
    const validated = schema.parse(parsed);

    return {
      object: validated,
      usage: mapUsage(result.usage),
    };
  };
}

// Lazy OpenAI provider for embeddings
let _openai: ReturnType<typeof createOpenAI> | null = null;
function openai() {
  if (!_openai) _openai = createOpenAI();
  return _openai;
}

/**
 * Create an EmbedText callback using OpenAI text-embedding-3-small (1536 dims).
 * Cost: ~$0.02 per 1M tokens.
 */
export function makeEmbedText(): EmbedText {
  return async (text: string) => {
    const { embedding } = await embed({
      model: openai().embedding("text-embedding-3-small"),
      value: text,
    });
    return embedding;
  };
}

/** Embedding dimensions — must match the vector index in schema.ts. */
export const EMBEDDING_DIMENSIONS = 1536;
