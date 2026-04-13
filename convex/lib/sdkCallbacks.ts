"use node";

/**
 * Provider-agnostic callback adapters for cl-sdk.
 *
 * Wraps Prism's existing AI SDK model routing (lib/models.ts) into the
 * simple callback interfaces the new SDK expects: GenerateText, GenerateObject, EmbedText.
 */

import { generateText, Output, embed } from "ai";
import type { LanguageModelUsage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createOpenAI } from "@ai-sdk/openai";
import { getModel, type ModelTask } from "./models";
import type { GenerateText, GenerateObject, EmbedText, TokenUsage } from "@claritylabs/cl-sdk";

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
  images?: ExtractionImage[];
};

const EXTRACTION_MAX_TOKEN_OVERRIDES: Record<string, number> = {
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

  const pdfBase64 = options?.pdfBase64;
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

  if (!pdfBase64) {
    // cl-sdk's application pipeline embeds base64 PDF directly in the prompt
    // text instead of using providerOptions.pdfBase64. Detect this and convert
    // to a proper file content part so the model can actually read the PDF.
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

  return {
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          {
            type: "file" as const,
            data: pdfBase64,
            mediaType: "application/pdf",
            filename: "document.pdf",
          },
        ],
      },
    ],
  };
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
 * Create a GenerateText callback backed by Prism's model router.
 * The task parameter selects which model to use (extraction, classification, etc.).
 */
export function makeGenerateText(task: ModelTask = "extraction"): GenerateText {
  return async ({ prompt, system, maxTokens, providerOptions }) => {
    const effectiveMaxTokens = getEffectiveMaxTokens(task, prompt, maxTokens);
    const result = await generateText({
      model: getModel(task),
      system,
      ...buildPromptInput(prompt, providerOptions),
      maxOutputTokens: effectiveMaxTokens,
      providerOptions: providerOptions as ProviderOptions,
    });
    return {
      text: result.text,
      usage: mapUsage(result.usage),
    };
  };
}

/**
 * Create a GenerateObject callback backed by Prism's model router.
 * Uses AI SDK v6's generateText + Output.object() for structured output.
 */
export function makeGenerateObject(task: ModelTask = "extraction"): GenerateObject {
  return async ({ prompt, system, schema, maxTokens, providerOptions }) => {
    const effectiveMaxTokens = getEffectiveMaxTokens(task, prompt, maxTokens);
    try {
      const result = await generateText({
        model: getModel(task),
        system,
        ...buildPromptInput(prompt, providerOptions),
        output: Output.object({ schema }),
        maxOutputTokens: effectiveMaxTokens,
        providerOptions: providerOptions as ProviderOptions,
      });
      return {
        object: result.output!,
        usage: mapUsage(result.usage),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isSectionsExtractor =
        task === "extraction" && prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER);

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
