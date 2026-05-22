"use node";

/**
 * Provider-agnostic callback adapters for cl-sdk.
 *
 * Wraps Glass's existing AI SDK model routing (lib/models.ts) into the
 * simple callback interfaces the new SDK expects: GenerateText, GenerateObject, EmbedText.
 */

import dayjs from "dayjs";
import { Output, embed, gateway } from "ai";
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
  traceId?: string;
  tracePolicyId?: Id<"policies"> | string;
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

function nowMs(): number {
  return dayjs().valueOf();
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

const POLICY_PERIOD_EXTRACTION_GUIDANCE = `

Critical policy period rule:
- Treat "Effective Date", "Effective Date / Time", "Policy Effective Date", "From", "Start Date", and close variants as the policy period start.
- Treat "Expiration Date", "Expiry Date", "Expiration Date / Time", "Policy Expiration Date", "To", "End Date", and close variants as the policy period end.
- When these labels appear inside a POLICY PERIOD / POLICY TERM / PERIOD OF INSURANCE table, populate top-level effectiveDate and expirationDate from them even if the table does not literally repeat "policy period" on each row.
- Do not leave effectiveDate or expirationDate unknown when declaration-page policy-period rows are visible.`;

function addPolicyPeriodGuidance(prompt: string): string {
  if (!prompt.includes("effectiveDate") && !prompt.includes("expirationDate")) {
    return prompt;
  }
  if (prompt.includes("Critical policy period rule:")) return prompt;
  return `${prompt}${POLICY_PERIOD_EXTRACTION_GUIDANCE}`;
}

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

async function recordModelTrace(
  routing: ModelRoutingContext | undefined,
  event: {
    label: string;
    task: ModelTask;
    taskKind?: ModelCallTaskKind;
    route?: ModelRoute;
    routeSource?: string;
    transport?: string;
    durationMs: number;
    usage?: TokenUsage;
    status: "complete" | "error";
    error?: string;
  },
) {
  if (!routing?.ctx || !routing.traceId) return;
  try {
    await routing.ctx.runMutation((internal as any).extractionTraces.recordEvent, {
      traceId: routing.traceId,
      kind: "model_call",
      label: event.label,
      task: event.task,
      taskKind: event.taskKind,
      provider: event.route?.provider,
      model: event.route?.model,
      routeSource: event.routeSource,
      transport: event.transport,
      attempt: 1,
      status: event.status,
      durationMs: event.durationMs,
      inputTokens: event.usage?.inputTokens,
      outputTokens: event.usage?.outputTokens,
      error: event.error,
    });
  } catch {
    // Telemetry should never fail a user-facing extraction.
  }
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
    const guidedPrompt = addPolicyPeriodGuidance(prompt);
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    const effectiveMaxTokens = getEffectiveMaxTokens(effectiveTask, guidedPrompt, maxTokens);
    let primaryRoute: ModelRoute | undefined;
    let routeSource: string | undefined;
    let transport: string | undefined;
    const model = routing?.ctx && routing.orgId
      ? await getModelAndRouteForOrg(routing.ctx, routing.orgId, effectiveTask).then((resolved) => {
        primaryRoute = resolved.route;
        routeSource = resolved.routeSource;
        transport = resolved.transport;
        return resolved.model;
      })
      : getModel(effectiveTask);
    const startedAt = nowMs();
    try {
      const result = await generateTextWithFallback({
        model,
        system,
        ...buildPromptInput(guidedPrompt, providerOptions as Record<string, unknown> | undefined),
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
      const usage = mapUsage(result.usage);
      await recordModelTrace(routing, {
        label: "generateText",
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        usage,
        status: "complete",
      });
      return {
        text: result.text,
        usage,
      };
    } catch (error) {
      await recordModelTrace(routing, {
        label: "generateText",
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    const guidedPrompt = addPolicyPeriodGuidance(prompt);
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    const effectiveMaxTokens = getEffectiveMaxTokens(effectiveTask, guidedPrompt, maxTokens);
    let primaryRoute: ModelRoute | undefined;
    let routeSource: string | undefined;
    let transport: string | undefined;
    const model = routing?.ctx && routing.orgId
      ? await getModelAndRouteForOrg(routing.ctx, routing.orgId, effectiveTask).then((resolved) => {
        primaryRoute = resolved.route;
        routeSource = resolved.routeSource;
        transport = resolved.transport;
        return resolved.model;
      })
      : getModel(effectiveTask);
    const startedAt = nowMs();
    try {
      const result = await generateStructuredWithFallback({
        model,
        system,
        ...buildPromptInput(guidedPrompt, providerOptions as Record<string, unknown> | undefined),
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
      const usage = mapUsage(result.usage);
      await recordModelTrace(routing, {
        label: "generateObject",
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        usage,
        status: "complete",
      });
      return {
        object: result.output!,
        usage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isSectionsExtractor =
        effectiveTask === "extraction" && guidedPrompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER);

      if (isSectionsExtractor && message.includes("No output generated")) {
        await recordModelTrace(routing, {
          label: "generateObject",
          task: effectiveTask,
          taskKind,
          route: primaryRoute,
          routeSource,
          transport,
          durationMs: nowMs() - startedAt,
          status: "error",
          error: message,
        });
        return {
          object: { sections: [] } as unknown,
          usage: undefined,
        };
      }

      await recordModelTrace(routing, {
        label: "generateObject",
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: message,
      });
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
    let model = "text-embedding-3-small";
    let apiKey: string | undefined;
    if (ctx && orgId) {
      const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
      const route = settings?.routes?.embeddings;
      if (route?.provider === "openai") {
        apiKey = settings?.routeSources?.embeddings === "broker"
          ? settings?.providerKeys?.openai
          : undefined;
        model = route.model;
      }
    }
    const embeddingModel = apiKey || process.env.OPENAI_API_KEY
      ? (apiKey ? createOpenAI({ apiKey }) : openai()).embedding(model)
      : gateway.textEmbeddingModel(`openai/${model}`);
    const { embedding } = await embed({
      model: embeddingModel,
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
