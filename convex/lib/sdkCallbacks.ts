"use node";

/**
 * Provider-agnostic callback adapters for cl-sdk.
 *
 * Wraps Glass's existing AI SDK model routing (lib/models.ts) into the
 * simple callback interfaces the new SDK expects: GenerateText, GenerateObject, EmbedText.
 */

import { Output, embed } from "ai";
import type { LanguageModelUsage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createOpenAI } from "@ai-sdk/openai";
import {
  getModel,
  getModelAndRouteForOrg,
  getProviderOptionsForTask,
  generateStructuredWithFallback,
  generateTextWithFallback,
  mergeProviderOptions,
  modelTaskForCall,
  type ModelCallTaskKind,
  type ModelRoute,
  type ModelTask,
} from "./models";
import type { GenerateText, GenerateObject, EmbedText, TokenUsage } from "@claritylabs/cl-sdk";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

function mapUsage(aiSdkUsage?: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: aiSdkUsage?.inputTokens ?? 0,
    outputTokens: aiSdkUsage?.outputTokens ?? 0,
  };
}

type ExtractionImage = {
  imageBase64: string;
  mimeType: string;
};

type ExtractionProviderOptions = ProviderOptions & {
  pdfBase64?: string;
  pdfUrl?: URL | string;
  pdfBytes?: Uint8Array;
  fileId?: string;
  mimeType?: string;
  images?: ExtractionImage[];
};

type ModelRoutingContext = {
  ctx?: ActionCtx;
  orgId?: Id<"organizations">;
};

type PdfFilePart = {
  type: "file";
  data: URL | Uint8Array | string;
  mediaType: string;
  filename: string;
};

type ParamsWithOptionalTaskKind = {
  taskKind?: unknown;
};

function readTaskKind(params: ParamsWithOptionalTaskKind): ModelCallTaskKind | undefined {
  return typeof params.taskKind === "string" ? params.taskKind : undefined;
}

/**
 * Build a single AI SDK file message part for the PDF, preferring memory-efficient
 * inputs over the legacy base64 fallback. The AI SDK handles provider-specific
 * encoding (OpenAI and Anthropic both accept URL / bytes / base64 `file` parts).
 */
function buildPdfFilePart(opts: {
  pdfUrl?: URL | string;
  pdfBytes?: Uint8Array;
  pdfBase64?: string;
  mimeType?: string;
}): PdfFilePart | null {
  const mediaType = opts.mimeType ?? "application/pdf";
  const filename = "document.pdf";
  if (opts.pdfUrl) {
    const url = opts.pdfUrl instanceof URL ? opts.pdfUrl : new URL(opts.pdfUrl);
    return { type: "file", data: url, mediaType, filename };
  }
  if (opts.pdfBytes) {
    return { type: "file", data: opts.pdfBytes, mediaType, filename };
  }
  if (opts.pdfBase64) {
    return { type: "file", data: opts.pdfBase64, mediaType, filename };
  }
  return null;
}

const EXTRACTION_MAX_TOKEN_OVERRIDES: Record<string, number> = {
  coveredReasons: 24576,
  exclusions: 8192,
};

const SECTIONS_EXTRACTOR_PROMPT_MARKER =
  "Extract ALL sections, clauses, endorsements, and schedules from this document";

function getEffectiveMaxTokens(
  task: ModelTask,
  prompt: string,
  maxTokens: number,
): number {
  if (task !== "extraction") return maxTokens;
  if (prompt.includes("Extract ALL covered reasons from this document")) {
    return Math.max(maxTokens, EXTRACTION_MAX_TOKEN_OVERRIDES.coveredReasons);
  }
  if (prompt.includes("Extract ALL exclusions from this document")) {
    return Math.max(maxTokens, EXTRACTION_MAX_TOKEN_OVERRIDES.exclusions);
  }
  return maxTokens;
}

function buildPromptInput(
  prompt: string,
  providerOptions?: Record<string, unknown>,
) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  const images = options?.images;

  if (images?.length) {
    return {
      messages: [
        {
          role: "user" as const,
          content: [
            ...images.map((img: ExtractionImage) => ({
              type: "image" as const,
              image: img.imageBase64,
              mediaType: img.mimeType,
            })),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    };
  }

  const pdfPart = buildPdfFilePart({
    pdfUrl: options?.pdfUrl,
    pdfBytes: options?.pdfBytes,
    pdfBase64: options?.pdfBase64,
    mimeType: options?.mimeType,
  });

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

  // Fallback: cl-sdk's application pipeline embeds base64 PDF directly in the prompt
  // text instead of using providerOptions. Detect and lift it into a file part.
  const extracted = extractEmbeddedPdf(prompt);
  if (extracted) {
    return {
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: extracted.text },
            {
              type: "file" as const,
              data: extracted.pdfBase64,
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

/**
 * Detect base64 PDF content embedded directly in prompt text.
 * The cl-sdk application pipeline concatenates raw pdfBase64 into prompts
 * (e.g. "Extract fields from this application:\n{base64}").
 * We detect this by looking for the PDF magic bytes in base64 ("JVBER" = "%PDF").
 */
function extractEmbeddedPdf(
  prompt: string,
): { text: string; pdfBase64: string } | null {
  // Match a long base64 PDF blob at the end of the prompt (after a newline)
  const match = prompt.match(
    /^([\s\S]+?\n)(JVBER[A-Za-z0-9+/=\s]{200,})$/,
  );
  if (!match) return null;
  const text = match[1].trim();
  const pdfBase64 = match[2].replace(/\s/g, "");
  return { text, pdfBase64 };
}

/**
 * Create a GenerateText callback backed by Glass's model router.
 * The task parameter selects which model to use (extraction, classification, etc.).
 */
export function makeGenerateText(
  task: ModelTask = "extraction",
  routing?: ModelRoutingContext,
): GenerateText {
  return async (params) => {
    const { prompt, system, maxTokens, providerOptions } = params;
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    const effectiveMaxTokens = getEffectiveMaxTokens(effectiveTask, prompt, maxTokens);
    let primaryRoute: ModelRoute | undefined;
    const model = routing?.ctx && routing.orgId
      ? await getModelAndRouteForOrg(routing.ctx, routing.orgId, effectiveTask).then((resolved) => {
        primaryRoute = resolved.route;
        return resolved.model;
      })
      : getModel(effectiveTask);
    const result = await generateTextWithFallback({
      model,
      system,
      ...buildPromptInput(prompt, providerOptions),
      maxOutputTokens: effectiveMaxTokens,
      providerOptions: mergeProviderOptions(
        getProviderOptionsForTask(effectiveTask),
        providerOptions as ProviderOptions,
      ),
    }, {
      task: effectiveTask,
      taskKind,
      primaryRoute,
    });
    return {
      text: result.text,
      usage: mapUsage(result.usage),
    };
  };
}

/**
 * Create a GenerateObject callback backed by Glass's model router.
 * Uses AI SDK v6's generateText + Output.object() for structured output.
 */
export function makeGenerateObject(
  task: ModelTask = "extraction",
  routing?: ModelRoutingContext,
): GenerateObject {
  return async (params) => {
    const { prompt, system, schema, maxTokens, providerOptions } = params;
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    const effectiveMaxTokens = getEffectiveMaxTokens(effectiveTask, prompt, maxTokens);
    let primaryRoute: ModelRoute | undefined;
    const model = routing?.ctx && routing.orgId
      ? await getModelAndRouteForOrg(routing.ctx, routing.orgId, effectiveTask).then((resolved) => {
        primaryRoute = resolved.route;
        return resolved.model;
      })
      : getModel(effectiveTask);
    try {
      const result = await generateStructuredWithFallback({
        model,
        system,
        ...buildPromptInput(prompt, providerOptions),
        output: Output.object({ schema }),
        maxOutputTokens: effectiveMaxTokens,
        providerOptions: mergeProviderOptions(
          getProviderOptionsForTask(effectiveTask),
          providerOptions as ProviderOptions,
        ),
      }, {
        task: effectiveTask,
        taskKind,
        primaryRoute,
      });
      return {
        object: result.output!,
        usage: mapUsage(result.usage),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isSectionsExtractor =
        effectiveTask === "extraction" && prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER);

      if (isSectionsExtractor && message.includes("No output generated")) {
        return {
          object: { sections: [] } as unknown,
          usage: undefined,
        };
      }

      throw error;
    }
  };
}

// Lazy OpenAI provider for embeddings
let _openai: ReturnType<typeof createOpenAI> | null = null;
function openai() {
  if (!_openai) _openai = createOpenAI();
  return _openai;
}

/**
 * Create an EmbedText callback. Broker overrides are only used when the broker
 * has supplied a matching provider key; otherwise Glass uses its default config.
 */
export function makeEmbedText(ctx?: ActionCtx, orgId?: Id<"organizations">): EmbedText {
  return async (text: string) => {
    let provider = openai();
    let model = "text-embedding-3-small";
    if (ctx && orgId) {
      const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
      const route = settings?.routes?.embeddings;
      const apiKey = route?.provider === "openai" ? settings?.providerKeys?.openai : undefined;
      if (route?.provider === "openai" && apiKey) {
        provider = createOpenAI({ apiKey });
        model = route.model;
      }
    }
    const { embedding } = await embed({
      model: provider.embedding(model),
      providerOptions: {
        openai: { dimensions: EMBEDDING_DIMENSIONS },
      },
      value: text,
    });
    return embedding;
  };
}

/** Embedding dimensions — must match the vector index in schema.ts. */
export const EMBEDDING_DIMENSIONS = 1536;
