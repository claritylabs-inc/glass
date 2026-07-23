"use node";

/**
 * Provider-agnostic callback adapters for cl-sdk.
 *
 * Wraps Glass's existing AI SDK model routing (lib/models.ts) into the
 * simple callback interfaces the new SDK expects: GenerateText, GenerateObject, EmbedText.
 */

import dayjs from "dayjs";
import { Output, embed, embedMany } from "ai";
import type { EmbeddingModel, LanguageModel, LanguageModelUsage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createFireworks } from "@ai-sdk/fireworks";
import { z } from "zod";
import {
  getModel,
  getModelAndRouteForOrg,
  getModelAndRouteForSettingsSnapshot,
  getModelForRoute,
  getProviderOptionsForRoute,
  generateStructuredWithFallback,
  generateTextWithFallback,
  mergeProviderOptions,
  modelTaskForCall,
  MODEL_ROUTING,
  primaryRouteForCall,
  resolveClRouterSettingsForOrg,
  type ModelCallTaskKind,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./models";
import {
  COVERAGE_CLEANUP_MODEL,
  EXTRACTION_QUALITY_MODEL,
  modelCapabilitiesForRoute,
  modelCapabilitiesForTask,
  modelSupportsImageInput,
} from "./modelCatalog";
import { structuredOutputSchemaForRoute } from "./fireworksStructuredOutput";
import type { GenerateText, GenerateObject, EmbedText, TokenUsage } from "@claritylabs/cl-sdk";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  ClRouterRequestError,
  clRouterEmbed,
  clRouterGenerate,
  shouldUseClRouterForCall,
  shouldUseClRouterForTask,
  withClRouterDirectFallback,
  type ClRouterGenerateResponse,
  type ClRouterMessage,
  type ClRouterMessagePart,
  type ClRouterSettingsSnapshot,
  type ClRouterTraceMetadata,
} from "./clRouterClient";

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
  trace?: unknown;
};

type GenerateObjectParams = Parameters<GenerateObject>[0];
type GlassGenerateObject = (
  params: Omit<GenerateObjectParams, "taskKind"> & { taskKind?: ModelCallTaskKind },
) => ReturnType<GenerateObject>;

type ModelCallTraceDetails = {
  label?: string;
  extractorName?: string;
  startPage?: number;
  endPage?: number;
  batchIndex?: number;
  batchCount?: number;
  phase?: string;
  sourceBacked?: boolean;
};

function readTaskKind(params: ParamsWithOptionalTaskKind): ModelCallTaskKind | undefined {
  return typeof params.taskKind === "string" ? params.taskKind : undefined;
}

function readTraceDetails(params: ParamsWithOptionalTaskKind): ModelCallTraceDetails | undefined {
  if (!params.trace || typeof params.trace !== "object" || Array.isArray(params.trace)) return undefined;
  return params.trace as ModelCallTraceDetails;
}

function nowMs(): number {
  return dayjs().valueOf();
}

function modelTraceLabel(
  kind: "generateText" | "generateObject",
  taskKind?: ModelCallTaskKind,
  task?: ModelTask,
  trace?: ModelCallTraceDetails,
) {
  if (trace?.label) return trace.label;
  if (trace?.extractorName) {
    const pageRange = trace.startPage
      ? ` pages ${trace.startPage}${trace.endPage && trace.endPage !== trace.startPage ? `-${trace.endPage}` : ""}`
      : "";
    return `${trace.extractorName}${pageRange}`;
  }
  if (trace?.phase === "format" && trace.batchIndex && trace.batchCount) {
    return `Format extracted content ${trace.batchIndex}/${trace.batchCount}`;
  }
  const labels: Record<string, string> = {
    extraction_classify: "Classify document",
    extraction_coverage_cleanup: "Clean coverage schedules",
    extraction_source_tree: "Build source-native document tree",
    extraction_operational_profile: "Build operational profile",
    extraction_page_map: "Map policy pages",
    extraction_focused: "Extract policy fields",
    extraction_long_list: "Extract long policy lists",
    extraction_referential_lookup: "Resolve policy references",
    extraction_review: "Review extraction evidence",
    extraction_summary: "Summarize extracted policy",
    extraction_format: "Format extracted policy",
    query_attachment: "Read attachment",
    query_classify: "Classify question",
    query_reason: "Reason over documents",
    query_verify: "Verify answer evidence",
    query_respond: "Write answer",
    pce_impact_analysis: "Analyze policy change",
    pce_reply_parse: "Parse policy-change reply",
    pce_packet_generation: "Generate policy-change packet",
  };
  if (taskKind && labels[taskKind]) return labels[taskKind];
  if (taskKind) {
    return taskKind
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  if (task === "extraction") return kind === "generateText" ? "Extract policy text" : "Extract policy structure";
  if (task === "classification") return "Classify document";
  if (task === "chat") return kind === "generateText" ? "Generate answer" : "Analyze chat context";
  return kind === "generateText" ? "Generate text" : "Generate structured output";
}

const TRACE_TEXT_PREVIEW_LIMIT = 6000;
const TRACE_OUTPUT_PREVIEW_LIMIT = 6000;

function truncateTraceText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function redactEmbeddedPdfBase64(value: string) {
  return value.replace(/JVBER[A-Za-z0-9+/=\s]{200,}/g, (match) => {
    const compact = match.replace(/\s/g, "");
    return `[PDF base64 omitted: ${compact.length} chars]`;
  });
}

function traceTextPreview(value: unknown, limit = TRACE_TEXT_PREVIEW_LIMIT) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return truncateTraceText(redactEmbeddedPdfBase64(value), limit);
}

function traceJsonPreview(value: unknown) {
  try {
    return truncateTraceText(JSON.stringify(value, null, 2), TRACE_OUTPUT_PREVIEW_LIMIT);
  } catch {
    return truncateTraceText(String(value), TRACE_OUTPUT_PREVIEW_LIMIT);
  }
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  );
}

function providerInputSummary(providerOptions: ProviderOptions | undefined) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  if (!options) return undefined;
  return {
    hasPdfBase64: typeof options.pdfBase64 === "string",
    pdfBase64Chars: typeof options.pdfBase64 === "string" ? options.pdfBase64.length : undefined,
    hasPdfUrl: !!options.pdfUrl,
    pdfUrl: typeof options.pdfUrl === "string"
      ? options.pdfUrl
      : options.pdfUrl instanceof URL
        ? options.pdfUrl.toString()
        : undefined,
    hasPdfBytes: options.pdfBytes instanceof Uint8Array,
    pdfBytes: options.pdfBytes instanceof Uint8Array ? options.pdfBytes.byteLength : undefined,
    fileId: typeof options.fileId === "string" ? options.fileId : undefined,
    mimeType: typeof options.mimeType === "string" ? options.mimeType : undefined,
    images: Array.isArray(options.images)
      ? options.images.map((image) => ({
        mimeType: image.mimeType,
        base64Chars: image.imageBase64.length,
      }))
      : undefined,
  };
}

function modelTraceDetails(params: {
  kind: "generateText" | "generateObject";
  label: string;
  task: ModelTask;
  taskKind?: ModelCallTaskKind;
  prompt: string;
  system?: string;
  maxOutputTokens: number;
  routePurpose?: string;
  providerOptions?: ProviderOptions;
  trace?: ModelCallTraceDetails;
  output?: unknown;
  outputKind?: "text" | "object";
}) {
  return stripUndefined({
    purpose: params.label,
    callKind: params.kind,
    task: params.task,
    taskKind: params.taskKind,
    trace: params.trace,
    maxOutputTokens: params.maxOutputTokens,
    routePurpose: params.routePurpose,
    systemPreview: traceTextPreview(params.system),
    promptPreview: traceTextPreview(params.prompt),
    inputSummary: providerInputSummary(params.providerOptions),
    outputKind: params.outputKind,
    outputPreview: params.outputKind === "object"
      ? traceJsonPreview(params.output)
      : traceTextPreview(params.output, TRACE_OUTPUT_PREVIEW_LIMIT),
  }) as Record<string, unknown>;
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

const SECTIONS_EXTRACTOR_PROMPT_MARKER =
  "Build a compact source-backed section index for this document";

function getEffectiveMaxTokens(
  task: ModelTask,
  taskKind: ModelCallTaskKind | undefined,
  maxTokens: number,
  route?: ModelRoute,
): number {
  const routeCapabilities = route ? modelCapabilitiesForRoute(route) : modelCapabilitiesForTask(task);
  const routeMax = taskKind
    ? routeCapabilities?.taskOutputTokens?.[taskKind] ?? routeCapabilities?.maxOutputTokens
    : routeCapabilities?.maxOutputTokens;
  return routeMax ? Math.min(maxTokens, routeMax) : maxTokens;
}

function buildPromptInput(
  prompt: string,
  providerOptions?: Record<string, unknown>,
  route?: ModelRoute,
) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  const images = options?.images;
  const supportsPdfFileInput = route?.provider !== "fireworks";
  const supportsImageInput = route ? modelSupportsImageInput(route) : true;
  const pdfPart = supportsPdfFileInput
    ? buildPdfFilePart({
        pdfUrl: options?.pdfUrl,
        pdfBytes: options?.pdfBytes,
        pdfBase64: options?.pdfBase64,
        mimeType: options?.mimeType,
      })
    : null;

  if (supportsImageInput && images?.length) {
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
            ...(pdfPart ? [pdfPart] : []),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    };
  }

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

  // Fallback: older cl-sdk calls may embed base64 PDF directly in the prompt
  // text instead of using providerOptions. Detect and lift it into a file part.
  const extracted = supportsPdfFileInput ? extractEmbeddedPdf(prompt) : null;
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

function coverageCleanupRouteOverride(
  taskKind: ModelCallTaskKind | undefined,
  trace: ModelCallTraceDetails | undefined,
  coverageCleanupRoute: ModelRoute | undefined,
): ModelRoute | null {
  if (taskKind !== "extraction_coverage_cleanup" && trace?.phase !== "coverage_cleanup") {
    return null;
  }
  return coverageCleanupRoute ?? COVERAGE_CLEANUP_MODEL;
}

type GenerationRoutePlan = {
  primaryRoute: ModelRoute;
  qualityRoute?: ModelRoute;
  coverageCleanupRoute?: ModelRoute;
  fallbackRoute?: ModelRoute;
  routeSource: string;
  routePurpose?: string;
  transport?: string;
  model?: LanguageModel;
};

type TextGenerationResult = {
  text: string;
  usage: TokenUsage;
  router?: ClRouterGenerateResponse;
};

type ObjectGenerationResult = {
  object: unknown;
  usage: TokenUsage;
  router?: ClRouterGenerateResponse;
};

type RouterOutageFallback = {
  fromTransport: "cl-router";
  toTransport: "direct";
  errorKind: string;
  status?: number;
};

function withRouterFallbackTraceDetails(
  details: Record<string, unknown>,
  fallback: RouterOutageFallback | undefined,
): Record<string, unknown> {
  return fallback ? { ...details, routerFallback: fallback } : details;
}

async function resolveDirectGenerationPlan(
  effectiveTask: ModelTask,
  taskKind: ModelCallTaskKind | undefined,
  trace: ModelCallTraceDetails | undefined,
  routing: ModelRoutingContext | undefined,
  settings?: ClRouterSettingsSnapshot | null,
): Promise<GenerationRoutePlan & { model: LanguageModel }> {
  let plan: GenerationRoutePlan & { model: LanguageModel };
  if (routing?.ctx && routing.orgId) {
    const resolved = settings === undefined
      ? await getModelAndRouteForOrg(routing.ctx, routing.orgId, effectiveTask)
      : getModelAndRouteForSettingsSnapshot(settings, effectiveTask);
    plan = {
      model: resolved.model,
      primaryRoute: resolved.route,
      qualityRoute: resolved.qualityRoute,
      coverageCleanupRoute: resolved.coverageCleanupRoute,
      fallbackRoute: resolved.fallbackRoute,
      routeSource: resolved.routeSource,
      transport: resolved.transport,
    };
    const primaryRouteOverride = primaryRouteForCall({
      task: effectiveTask,
      taskKind,
      primaryRoute: plan.primaryRoute,
      qualityRoute: resolved.qualityRoute,
    });
    if (primaryRouteOverride) {
      plan.primaryRoute = primaryRouteOverride;
      plan.routeSource = resolved.qualityRouteSource ?? plan.routeSource;
      plan.routePurpose = "extraction_quality";
      plan.transport = undefined;
      plan.model = getModelForRoute(primaryRouteOverride);
    }
    const coverageOverride = coverageCleanupRouteOverride(
      taskKind,
      trace,
      resolved.coverageCleanupRoute,
    );
    if (coverageOverride) {
      plan.primaryRoute = coverageOverride;
      plan.routeSource = resolved.coverageCleanupRouteSource ?? plan.routeSource;
      plan.routePurpose = "extraction_coverage_cleanup";
      plan.transport = undefined;
      plan.model = getModelForRoute(coverageOverride);
    }
    return plan;
  }

  const primaryRoute = MODEL_ROUTING[effectiveTask];
  plan = {
    model: getModel(effectiveTask),
    primaryRoute,
    qualityRoute: EXTRACTION_QUALITY_MODEL,
    coverageCleanupRoute: COVERAGE_CLEANUP_MODEL,
    routeSource: "static",
  };
  const primaryRouteOverride = primaryRouteForCall({
    task: effectiveTask,
    taskKind,
    primaryRoute,
    qualityRoute: EXTRACTION_QUALITY_MODEL,
  });
  if (primaryRouteOverride) {
    plan.primaryRoute = primaryRouteOverride;
    plan.routePurpose = "extraction_quality";
    plan.model = getModelForRoute(primaryRouteOverride);
  }
  const coverageOverride = coverageCleanupRouteOverride(
    taskKind,
    trace,
    COVERAGE_CLEANUP_MODEL,
  );
  if (coverageOverride) {
    plan.primaryRoute = coverageOverride;
    plan.routePurpose = "extraction_coverage_cleanup";
    plan.model = getModelForRoute(coverageOverride);
  }
  return plan;
}

function resolveRouterGenerationPlan(
  effectiveTask: ModelTask,
  taskKind: ModelCallTaskKind | undefined,
  trace: ModelCallTraceDetails | undefined,
  settings: ClRouterSettingsSnapshot | null,
): GenerationRoutePlan {
  const primaryRoute = settings?.routes?.[effectiveTask] ?? MODEL_ROUTING[effectiveTask];
  const qualityRoute = settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
  const coverageCleanupRoute =
    settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
  const fallbackRoute = settings?.routes?.fallback;
  const plan: GenerationRoutePlan = {
    primaryRoute,
    qualityRoute,
    coverageCleanupRoute,
    fallbackRoute,
    routeSource: settings?.routeSources?.[effectiveTask] ?? "static",
    transport: "cl-router",
  };
  const qualityOverride = primaryRouteForCall({
    task: effectiveTask,
    taskKind,
    primaryRoute,
    qualityRoute,
  });
  if (qualityOverride) {
    plan.primaryRoute = qualityOverride;
    plan.routeSource = settings?.routeSources?.extraction_quality ?? plan.routeSource;
    plan.routePurpose = "extraction_quality";
  }
  const coverageOverride = coverageCleanupRouteOverride(
    taskKind,
    trace,
    coverageCleanupRoute,
  );
  if (coverageOverride) {
    plan.primaryRoute = coverageOverride;
    plan.routeSource =
      settings?.routeSources?.extraction_coverage_cleanup ?? plan.routeSource;
    plan.routePurpose = "extraction_coverage_cleanup";
  }
  return plan;
}

function clRouterDataContent(data: URL | Uint8Array | string): string {
  if (data instanceof URL) return data.toString();
  return typeof data === "string" ? data : Buffer.from(data).toString("base64");
}

function buildClRouterPromptInput(
  prompt: string,
  providerOptions?: Record<string, unknown>,
): Pick<Parameters<typeof clRouterGenerate>[0], "messages" | "prompt"> {
  const input = buildPromptInput(prompt, providerOptions);
  if ("prompt" in input) return { prompt: input.prompt };
  const messages: ClRouterMessage[] = input.messages.map((message) => ({
    role: message.role,
    content: message.content.map((part): ClRouterMessagePart => {
      if (part.type === "text") return part;
      if (part.type === "image") return part;
      return {
        type: "file",
        data: clRouterDataContent(part.data),
        mediaType: part.mediaType,
        filename: part.filename,
      };
    }),
  }));
  return { messages };
}

function clRouterTrace(
  routing: ModelRoutingContext | undefined,
  label: string,
  taskKind: ModelCallTaskKind | undefined,
  trace: ModelCallTraceDetails | undefined,
): ClRouterTraceMetadata {
  return stripUndefined({
    traceId: routing?.traceId,
    label,
    phase: trace?.phase,
    taskKind,
    policyId: routing?.tracePolicyId ? String(routing.tracePolicyId) : undefined,
    channel: "convex",
  }) as ClRouterTraceMetadata;
}

function mapClRouterUsage(response: ClRouterGenerateResponse): TokenUsage {
  return {
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };
}

async function resolveClRouterSettings(
  routing: ModelRoutingContext | undefined,
): Promise<ClRouterSettingsSnapshot | null> {
  if (!routing?.ctx || !routing.orgId) return null;
  return resolveClRouterSettingsForOrg(routing.ctx, routing.orgId);
}

/**
 * Detect base64 PDF content embedded directly in prompt text.
 * Older cl-sdk calls can concatenate raw pdfBase64 into prompts.
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
    attempt?: number;
    durationMs: number;
    usage?: TokenUsage;
    cachedInputTokens?: number;
    routerRequestId?: string;
    costUsd?: number | null;
    costStatus?: "priced" | "unpriced";
    routingDecision?: string;
    routing?: ClRouterGenerateResponse["routing"];
    status: "complete" | "error" | "soft_failed";
    error?: string;
    details?: Record<string, unknown>;
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
      attempt: event.attempt ?? 1,
      status: event.status,
      durationMs: event.durationMs,
      inputTokens: event.usage?.inputTokens,
      outputTokens: event.usage?.outputTokens,
      cachedInputTokens: event.cachedInputTokens,
      routerRequestId: event.routerRequestId,
      costUsd: event.costUsd,
      costStatus: event.costStatus,
      routingDecision: event.routingDecision,
      routing: event.routing,
      error: event.error,
      details: event.details,
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
  let settingsPromise: ReturnType<typeof resolveClRouterSettings> | null = null;
  const getRouterSettings = () => {
    settingsPromise ??= resolveClRouterSettings(routing);
    return settingsPromise;
  };

  return async (params) => {
    const { prompt, system, maxTokens, providerOptions } = params;
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const trace = readTraceDetails(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    let traceRoute: ModelRoute = MODEL_ROUTING[effectiveTask];
    let routeSource = "static";
    let routePurpose: string | undefined;
    let transport: string | undefined;
    let routerFallback: RouterOutageFallback | undefined;
    let effectiveMaxTokens = maxTokens;
    const startedAt = nowMs();
    const label = modelTraceLabel("generateText", taskKind, effectiveTask, trace);
    const executeDirect = async (settings?: ClRouterSettingsSnapshot | null) => {
      const plan = await resolveDirectGenerationPlan(
        effectiveTask,
        taskKind,
        trace,
        routing,
        settings,
      );
      traceRoute = plan.primaryRoute;
      routeSource = plan.routeSource;
      routePurpose = plan.routePurpose;
      transport = plan.transport;
      effectiveMaxTokens = getEffectiveMaxTokens(
        effectiveTask,
        taskKind,
        maxTokens,
        plan.primaryRoute,
      );
      const result = await generateTextWithFallback({
        model: plan.model,
        system,
        ...buildPromptInput(
          prompt,
          providerOptions as Record<string, unknown> | undefined,
          plan.primaryRoute,
        ),
        maxOutputTokens: effectiveMaxTokens,
        providerOptions: mergeProviderOptions(
          getProviderOptionsForRoute(plan.primaryRoute),
          providerOptions as ProviderOptions,
        ),
      }, {
        task: effectiveTask,
        taskKind,
        primaryRoute: plan.primaryRoute,
        fallbackRoute: plan.fallbackRoute,
      });
      return {
        text: result.text,
        usage: mapUsage(result.usage),
        router: undefined,
      };
    };

    try {
      const result = shouldUseClRouterForCall(effectiveTask, taskKind)
        ? await (async () => {
          const settings = await getRouterSettings();
          const plan = resolveRouterGenerationPlan(
            effectiveTask,
            taskKind,
            trace,
            settings,
          );
          traceRoute = plan.primaryRoute;
          routeSource = plan.routeSource;
          routePurpose = plan.routePurpose;
          transport = "cl-router";
          effectiveMaxTokens = getEffectiveMaxTokens(
            effectiveTask,
            taskKind,
            maxTokens,
            plan.primaryRoute,
          );
          return withClRouterDirectFallback<TextGenerationResult>({
            router: async () => {
              const response = await clRouterGenerate({
                task: effectiveTask,
                taskKind,
                orgId: routing?.orgId ? String(routing.orgId) : undefined,
                settings,
                system,
                ...buildClRouterPromptInput(
                  prompt,
                  providerOptions as Record<string, unknown> | undefined,
                ),
                maxTokens: effectiveMaxTokens,
                sessionKey: routing?.traceId ?? (
                  routing?.tracePolicyId ? String(routing.tracePolicyId) : undefined
                ),
                routing: {
                  allowFallback: true,
                },
                trace: clRouterTrace(routing, label, taskKind, trace),
              });
              if (typeof response.output !== "string") {
                throw new ClRouterRequestError(
                  "invalid_response",
                  "cl-router text generation returned a non-text output",
                );
              }
              traceRoute = response.model;
              routeSource = response.routing.routeSource ?? response.routing.decision;
              routePurpose = plan.routePurpose;
              transport = "cl-router";
              return {
                text: response.output,
                usage: mapClRouterUsage(response),
                router: response,
              };
            },
            direct: () => executeDirect(settings),
            onFallback: (error) => {
              routerFallback = {
                fromTransport: "cl-router",
                toTransport: "direct",
                errorKind: error.kind,
                ...(error.status !== undefined ? { status: error.status } : {}),
              };
              console.warn(
                "cl-router unavailable; using direct cl-sdk text fallback",
                { task: effectiveTask, taskKind, kind: error.kind, status: error.status },
              );
            },
          });
        })()
        : await executeDirect();
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport: routerFallback ? "cl-router-direct-fallback" : transport,
        attempt: result.router?.routing.attemptCount,
        durationMs: nowMs() - startedAt,
        usage: result.usage,
        cachedInputTokens: result.router?.usage.cachedInputTokens,
        routerRequestId: result.router?.requestId,
        costUsd: result.router?.costUsd,
        costStatus: result.router?.costStatus,
        routingDecision: result.router?.routing.decision ?? (
          routerFallback ? "router_outage_fallback" : undefined
        ),
        routing: result.router?.routing,
        status: "complete",
        details: withRouterFallbackTraceDetails(modelTraceDetails({
          kind: "generateText",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
          output: result.text,
          outputKind: "text",
        }), routerFallback),
      });
      return {
        text: result.text,
        usage: result.usage,
      };
    } catch (error) {
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport: routerFallback ? "cl-router-direct-fallback" : transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        routingDecision: routerFallback ? "router_outage_fallback" : undefined,
        details: withRouterFallbackTraceDetails(modelTraceDetails({
          kind: "generateText",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
        }), routerFallback),
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
): GlassGenerateObject {
  let settingsPromise: ReturnType<typeof resolveClRouterSettings> | null = null;
  const getRouterSettings = () => {
    settingsPromise ??= resolveClRouterSettings(routing);
    return settingsPromise;
  };

  return async (params) => {
    const { prompt, system, schema, maxTokens, providerOptions } = params;
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const trace = readTraceDetails(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    let traceRoute: ModelRoute = MODEL_ROUTING[effectiveTask];
    let routeSource = "static";
    let routePurpose: string | undefined;
    let transport: string | undefined;
    let routerFallback: RouterOutageFallback | undefined;
    let effectiveMaxTokens = maxTokens;
    const startedAt = nowMs();
    const label = modelTraceLabel("generateObject", taskKind, effectiveTask, trace);
    const executeDirect = async (settings?: ClRouterSettingsSnapshot | null) => {
      const plan = await resolveDirectGenerationPlan(
        effectiveTask,
        taskKind,
        trace,
        routing,
        settings,
      );
      traceRoute = plan.primaryRoute;
      routeSource = plan.routeSource;
      routePurpose = plan.routePurpose;
      transport = plan.transport;
      effectiveMaxTokens = getEffectiveMaxTokens(
        effectiveTask,
        taskKind,
        maxTokens,
        plan.primaryRoute,
      );
      const result = await generateStructuredWithFallback({
        model: plan.model,
        system,
        ...buildPromptInput(
          prompt,
          providerOptions as Record<string, unknown> | undefined,
          plan.primaryRoute,
        ),
        output: Output.object({
          schema: structuredOutputSchemaForRoute(schema, plan.primaryRoute),
        }),
        maxOutputTokens: effectiveMaxTokens,
        providerOptions: mergeProviderOptions(
          getProviderOptionsForRoute(plan.primaryRoute),
          providerOptions as ProviderOptions,
        ),
      }, {
        task: effectiveTask,
        taskKind,
        primaryRoute: plan.primaryRoute,
        fallbackRoute: plan.fallbackRoute,
      });
      return {
        object: result.output!,
        usage: mapUsage(result.usage),
        router: undefined,
      };
    };

    try {
      const result = shouldUseClRouterForCall(effectiveTask, taskKind)
        ? await (async () => {
          const settings = await getRouterSettings();
          const plan = resolveRouterGenerationPlan(
            effectiveTask,
            taskKind,
            trace,
            settings,
          );
          traceRoute = plan.primaryRoute;
          routeSource = plan.routeSource;
          routePurpose = plan.routePurpose;
          transport = "cl-router";
          effectiveMaxTokens = getEffectiveMaxTokens(
            effectiveTask,
            taskKind,
            maxTokens,
            plan.primaryRoute,
          );
          return withClRouterDirectFallback<ObjectGenerationResult>({
            router: async () => {
              const response = await clRouterGenerate({
                task: effectiveTask,
                taskKind,
                orgId: routing?.orgId ? String(routing.orgId) : undefined,
                settings,
                system,
                ...buildClRouterPromptInput(
                  prompt,
                  providerOptions as Record<string, unknown> | undefined,
                ),
                schema: z.toJSONSchema(schema) as Record<string, unknown>,
                schemaDialect: "https://json-schema.org/draft/2020-12/schema",
                maxTokens: effectiveMaxTokens,
                sessionKey: routing?.traceId ?? (
                  routing?.tracePolicyId ? String(routing.tracePolicyId) : undefined
                ),
                routing: {
                  allowFallback: true,
                },
                trace: clRouterTrace(routing, label, taskKind, trace),
              });
              const parsed = schema.safeParse(response.output);
              if (!parsed.success) {
                throw new ClRouterRequestError(
                  "invalid_response",
                  "cl-router structured generation returned invalid output",
                  { cause: parsed.error },
                );
              }
              traceRoute = response.model;
              routeSource = response.routing.routeSource ?? response.routing.decision;
              routePurpose = plan.routePurpose;
              transport = "cl-router";
              return {
                object: parsed.data,
                usage: mapClRouterUsage(response),
                router: response,
              };
            },
            direct: () => executeDirect(settings),
            onFallback: (error) => {
              routerFallback = {
                fromTransport: "cl-router",
                toTransport: "direct",
                errorKind: error.kind,
                ...(error.status !== undefined ? { status: error.status } : {}),
              };
              console.warn(
                "cl-router unavailable; using direct cl-sdk object fallback",
                { task: effectiveTask, taskKind, kind: error.kind, status: error.status },
              );
            },
          });
        })()
        : await executeDirect();
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport: routerFallback ? "cl-router-direct-fallback" : transport,
        attempt: result.router?.routing.attemptCount,
        durationMs: nowMs() - startedAt,
        usage: result.usage,
        cachedInputTokens: result.router?.usage.cachedInputTokens,
        routerRequestId: result.router?.requestId,
        costUsd: result.router?.costUsd,
        costStatus: result.router?.costStatus,
        routingDecision: result.router?.routing.decision ?? (
          routerFallback ? "router_outage_fallback" : undefined
        ),
        routing: result.router?.routing,
        status: "complete",
        details: withRouterFallbackTraceDetails(modelTraceDetails({
          kind: "generateObject",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
          output: result.object,
          outputKind: "object",
        }), routerFallback),
      });
      return {
        object: result.object,
        usage: result.usage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isSectionsExtractor =
        effectiveTask === "extraction" && prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER);

      if (isSectionsExtractor && message.includes("No output generated")) {
        await recordModelTrace(routing, {
          label,
          task: effectiveTask,
          taskKind,
          route: traceRoute,
          routeSource,
          transport: routerFallback ? "cl-router-direct-fallback" : transport,
          durationMs: nowMs() - startedAt,
          status: "soft_failed",
          error: message,
          routingDecision: routerFallback ? "router_outage_fallback" : undefined,
          details: withRouterFallbackTraceDetails(modelTraceDetails({
            kind: "generateObject",
            label,
            task: effectiveTask,
            taskKind,
            prompt,
            system,
            maxOutputTokens: effectiveMaxTokens,
            routePurpose,
            providerOptions: providerOptions as ProviderOptions,
            trace,
            output: { sections: [] },
            outputKind: "object",
          }), routerFallback),
        });
        return {
          object: { sections: [] } as unknown,
          usage: undefined,
        };
      }

      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport: routerFallback ? "cl-router-direct-fallback" : transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: message,
        routingDecision: routerFallback ? "router_outage_fallback" : undefined,
        details: withRouterFallbackTraceDetails(modelTraceDetails({
          kind: "generateObject",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
        }), routerFallback),
      });
      throw error;
    }
  };
}

// Lazy providers for embeddings
let _openai: ReturnType<typeof createOpenAI> | null = null;
function openai() {
  if (!_openai) _openai = createOpenAI();
  return _openai;
}

let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;
function google() {
  if (!_google) _google = createGoogleGenerativeAI();
  return _google;
}

let _fireworks: ReturnType<typeof createFireworks> | null = null;
function fireworks() {
  if (!_fireworks) _fireworks = createFireworks();
  return _fireworks;
}

function directEmbeddingApiKey(provider: ModelProvider): string | undefined {
  const clean = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed || undefined;
  };
  switch (provider) {
    case "openai":
      return clean(process.env.OPENAI_API_KEY);
    case "google":
      return clean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ?? clean(process.env.GOOGLE_API_KEY);
    case "fireworks":
      return clean(process.env.FIREWORKS_API_KEY);
    default:
      return undefined;
  }
}

function isDirectEmbeddingRoute(route: ModelRoute): boolean {
  return route.provider === "openai" ||
    route.provider === "google" ||
    route.provider === "fireworks";
}

function embeddingProviderModel(route: ModelRoute, apiKey?: string): EmbeddingModel {
  switch (route.provider) {
    case "openai":
      return (apiKey ? createOpenAI({ apiKey }) : openai()).embeddingModel(route.model);
    case "google":
      return (apiKey ? createGoogleGenerativeAI({ apiKey }) : google()).embeddingModel(route.model);
    case "fireworks":
      return (apiKey ? createFireworks({ apiKey }) : fireworks()).embeddingModel(route.model);
    default:
      throw new Error(
        `Embedding route ${route.provider}/${route.model} is not supported by direct embedding providers. Configure OpenAI, Google, or Fireworks embeddings instead.`,
      );
  }
}

function embeddingProviderOptions(route: ModelRoute): ProviderOptions | undefined {
  if (route.provider === "openai" && route.model.startsWith("text-embedding-3-")) {
    return { openai: { dimensions: EMBEDDING_DIMENSIONS } };
  }
  if (route.provider === "google" && route.model === "gemini-embedding-001") {
    return { google: { outputDimensionality: EMBEDDING_DIMENSIONS } };
  }
  if (
    route.provider === "fireworks" &&
    route.model === "accounts/fireworks/models/qwen3-embedding-8b"
  ) {
    return { fireworks: { dimensions: EMBEDDING_DIMENSIONS } };
  }
  return undefined;
}

async function resolveEmbeddingConfig(ctx?: ActionCtx, orgId?: Id<"organizations">) {
  if (ctx && orgId) {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
    return resolveEmbeddingConfigForSettingsSnapshot(settings ?? null);
  }
  return resolveEmbeddingConfigForSettingsSnapshot(null);
}

function resolveEmbeddingConfigForSettingsSnapshot(
  settings: ClRouterSettingsSnapshot | null,
) {
  let route: ModelRoute = MODEL_ROUTING.embeddings;
  let apiKey: string | undefined;
  const configuredRoute = settings?.routes?.embeddings;
  const configuredApiKey = configuredRoute && settings?.routeSources?.embeddings === "broker"
    ? settings?.providerKeys?.[configuredRoute.provider]?.trim()
    : undefined;
  if (
    configuredRoute &&
    isDirectEmbeddingRoute(configuredRoute) &&
    (configuredApiKey || directEmbeddingApiKey(configuredRoute.provider))
  ) {
    route = configuredRoute;
    apiKey = configuredApiKey;
  }
  const directApiKey = apiKey ?? directEmbeddingApiKey(route.provider);
  if (!directApiKey) {
    throw new Error(
      `Direct ${route.provider} API key is missing for embedding route ${route.provider}/${route.model}. AI Gateway is not a fallback for Glass embeddings.`,
    );
  }
  return {
    embeddingModel: embeddingProviderModel(route, directApiKey),
    providerOptions: embeddingProviderOptions(route),
  };
}

async function resolveClRouterEmbeddingSettings(
  ctx?: ActionCtx,
  orgId?: Id<"organizations">,
): Promise<ClRouterSettingsSnapshot | null> {
  if (!ctx || !orgId) return null;
  const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
  if (!settings) return null;
  return {
    routes: settings.routes,
    routeSources: settings.routeSources,
    providerKeys: settings.providerKeys,
  };
}

function warnEmbeddingRouterFallback(error: { kind: string; status?: number }): void {
  console.warn("cl-router unavailable; using direct embedding fallback", {
    task: "embeddings",
    kind: error.kind,
    status: error.status,
  });
}

export type EmbedTexts = (texts: string[]) => Promise<number[][]>;

/**
 * Create an embedding callback. Broker overrides are resolved once per callback
 * instance, then reused across all single or batched embedding requests.
 */
export function makeEmbedTexts(
  ctx?: ActionCtx,
  orgId?: Id<"organizations">,
  options?: { maxParallelCalls?: number },
): EmbedTexts {
  let configPromise: ReturnType<typeof resolveEmbeddingConfig> | null = null;
  let routerSettingsPromise: ReturnType<typeof resolveClRouterEmbeddingSettings> | null = null;
  const getConfig = () => {
    configPromise ??= resolveEmbeddingConfig(ctx, orgId);
    return configPromise;
  };
  const getRouterSettings = () => {
    routerSettingsPromise ??= resolveClRouterEmbeddingSettings(ctx, orgId);
    return routerSettingsPromise;
  };

  return async (texts: string[]) => {
    if (!texts.length) return [];
    const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
      const { embeddingModel, providerOptions } = settings === undefined
        ? await getConfig()
        : resolveEmbeddingConfigForSettingsSnapshot(settings);
      const { embeddings } = await embedMany({
        model: embeddingModel,
        values: texts,
        maxParallelCalls: options?.maxParallelCalls,
        providerOptions,
      });
      return embeddings;
    };
    if (!shouldUseClRouterForTask("embeddings")) return direct();
    const settings = await getRouterSettings();
    return withClRouterDirectFallback({
      router: async () => (await clRouterEmbed({
        orgId,
        settings,
        texts,
        dimensions: EMBEDDING_DIMENSIONS,
        trace: { label: "convex.sdkCallbacks.makeEmbedTexts" },
      })).embeddings,
      direct: () => direct(settings),
      onFallback: warnEmbeddingRouterFallback,
    });
  };
}

/**
 * Create an EmbedText callback. Broker overrides are only used when the broker
 * has supplied a matching provider key; otherwise Glass uses its default config.
 */
export function makeEmbedText(ctx?: ActionCtx, orgId?: Id<"organizations">): EmbedText {
  let configPromise: ReturnType<typeof resolveEmbeddingConfig> | null = null;
  let routerSettingsPromise: ReturnType<typeof resolveClRouterEmbeddingSettings> | null = null;
  const getConfig = () => {
    configPromise ??= resolveEmbeddingConfig(ctx, orgId);
    return configPromise;
  };
  const getRouterSettings = () => {
    routerSettingsPromise ??= resolveClRouterEmbeddingSettings(ctx, orgId);
    return routerSettingsPromise;
  };

  return async (text: string) => {
    const direct = async (settings?: ClRouterSettingsSnapshot | null) => {
      const { embeddingModel, providerOptions } = settings === undefined
        ? await getConfig()
        : resolveEmbeddingConfigForSettingsSnapshot(settings);
      const { embedding } = await embed({
        model: embeddingModel,
        providerOptions,
        value: text,
      });
      return embedding;
    };
    if (!shouldUseClRouterForTask("embeddings")) return direct();
    const settings = await getRouterSettings();
    return withClRouterDirectFallback({
      router: async () => {
        const response = await clRouterEmbed({
          orgId,
          settings,
          texts: [text],
          dimensions: EMBEDDING_DIMENSIONS,
          trace: { label: "convex.sdkCallbacks.makeEmbedText" },
        });
        const embedding = response.embeddings[0];
        if (!embedding) throw new Error("cl-router returned no embedding");
        return embedding;
      },
      direct: () => direct(settings),
      onFallback: warnEmbeddingRouterFallback,
    });
  };
}

/** Embedding dimensions — must match the vector index in schema.ts. */
export const EMBEDDING_DIMENSIONS = 1536;
