"use node";

/**
 * Provider-agnostic callback adapters for cl-sdk.
 *
 * Wraps Glass's existing AI SDK model routing (lib/models.ts) into the
 * simple callback interfaces the new SDK expects: GenerateText, GenerateObject, EmbedText.
 */

import dayjs from "dayjs";
import { Output, embed, embedMany, gateway } from "ai";
import type { EmbeddingModel, LanguageModel, LanguageModelUsage } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createFireworks } from "@ai-sdk/fireworks";
import {
  getModel,
  getModelAndRouteForOrg,
  getModelForRoute,
  getProviderOptionsForRoute,
  getProviderOptionsForTask,
  generateStructuredWithFallback,
  generateTextWithFallback,
  mergeProviderOptions,
  modelTaskForCall,
  MODEL_ROUTING,
  primaryRouteForCall,
  type ModelCallTaskKind,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./models";
import {
  COVERAGE_CLEANUP_MODEL,
  FORM_INVENTORY_MODEL,
  modelCapabilitiesForRoute,
  modelCapabilitiesForTask,
  modelSupportsImageInput,
  VISUAL_TABLE_REPAIR_MODEL,
} from "./modelCatalog";
import { structuredOutputSchemaForRoute } from "./fireworksStructuredOutput";
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
  trace?: unknown;
};

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
    extraction_coverage_cleanup: "Clean coverage limits",
    extraction_form_inventory: "Extract form inventory",
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

function isVisualTableRepairTrace(trace: ModelCallTraceDetails | undefined): boolean {
  return typeof trace?.label === "string" && trace.label.startsWith("source_tree_visual_table_repair_");
}

function shouldReturnEmptyFormInventory(taskKind: ModelCallTaskKind | undefined): boolean {
  return taskKind === "extraction_form_inventory";
}

function shouldReturnEmptyVisualTableRepair(trace: ModelCallTraceDetails | undefined): boolean {
  return isVisualTableRepairTrace(trace);
}

function visualTableRepairRouteOverride(
  trace: ModelCallTraceDetails | undefined,
  visualTableRepairRoute: ModelRoute | undefined,
): ModelRoute | null {
  if (!isVisualTableRepairTrace(trace)) return null;
  const route = visualTableRepairRoute ?? VISUAL_TABLE_REPAIR_MODEL;
  return modelSupportsImageInput(route) ? route : VISUAL_TABLE_REPAIR_MODEL;
}

function formInventoryRouteOverride(
  taskKind: ModelCallTaskKind | undefined,
  formInventoryRoute: ModelRoute | undefined,
): ModelRoute | null {
  if (taskKind !== "extraction_form_inventory") return null;
  return formInventoryRoute ?? FORM_INVENTORY_MODEL;
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
    durationMs: number;
    usage?: TokenUsage;
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
      attempt: 1,
      status: event.status,
      durationMs: event.durationMs,
      inputTokens: event.usage?.inputTokens,
      outputTokens: event.usage?.outputTokens,
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
  return async (params) => {
    const { prompt, system, maxTokens, providerOptions } = params;
    const guidedPrompt = addPolicyPeriodGuidance(prompt);
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const trace = readTraceDetails(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    let primaryRoute: ModelRoute | undefined;
    let qualityRoute: ModelRoute | undefined;
    let formInventoryRoute: ModelRoute | undefined;
    let coverageCleanupRoute: ModelRoute | undefined;
    let visualTableRepairRoute: ModelRoute | undefined;
    let fallbackRoute: ModelRoute | undefined;
    let routeSource: string | undefined;
    let transport: string | undefined;
    let model: LanguageModel = routing?.ctx && routing.orgId
      ? await getModelAndRouteForOrg(routing.ctx, routing.orgId, effectiveTask).then((resolved) => {
        primaryRoute = resolved.route;
        qualityRoute = resolved.qualityRoute;
        formInventoryRoute = resolved.formInventoryRoute;
        coverageCleanupRoute = resolved.coverageCleanupRoute;
        visualTableRepairRoute = resolved.visualTableRepairRoute;
        fallbackRoute = resolved.fallbackRoute;
        routeSource = resolved.routeSource;
        transport = resolved.transport;
        return resolved.model;
      })
      : (() => {
        primaryRoute = MODEL_ROUTING[effectiveTask];
        routeSource = "static";
        return getModel(effectiveTask);
      })();
    const primaryRouteOverride = primaryRouteForCall({ task: effectiveTask, taskKind, primaryRoute, qualityRoute });
    if (primaryRouteOverride) {
      primaryRoute = primaryRouteOverride;
      routeSource = "quality";
      transport = undefined;
      model = getModelForRoute(primaryRouteOverride);
    }
    const formInventoryRouteOverrideValue = formInventoryRouteOverride(taskKind, formInventoryRoute);
    if (formInventoryRouteOverrideValue) {
      primaryRoute = formInventoryRouteOverrideValue;
      routeSource = "form_inventory";
      transport = undefined;
      model = getModelForRoute(formInventoryRouteOverrideValue);
    }
    const coverageCleanupRouteOverrideValue = coverageCleanupRouteOverride(taskKind, trace, coverageCleanupRoute);
    if (coverageCleanupRouteOverrideValue) {
      primaryRoute = coverageCleanupRouteOverrideValue;
      routeSource = "coverage_cleanup";
      transport = undefined;
      model = getModelForRoute(coverageCleanupRouteOverrideValue);
    }
    const visualRepairRouteOverride = visualTableRepairRouteOverride(trace, visualTableRepairRoute);
    if (visualRepairRouteOverride) {
      primaryRoute = visualRepairRouteOverride;
      routeSource = "visual_table_repair";
      transport = undefined;
      model = getModelForRoute(visualRepairRouteOverride);
    }
    const effectiveMaxTokens = getEffectiveMaxTokens(effectiveTask, taskKind, maxTokens, primaryRoute);
    const startedAt = nowMs();
    const label = modelTraceLabel("generateText", taskKind, effectiveTask, trace);
    try {
      const result = await generateTextWithFallback({
        model,
        system,
        ...buildPromptInput(
          guidedPrompt,
          providerOptions as Record<string, unknown> | undefined,
          primaryRoute,
        ),
        maxOutputTokens: effectiveMaxTokens,
        providerOptions: mergeProviderOptions(
          primaryRoute ? getProviderOptionsForRoute(primaryRoute) : getProviderOptionsForTask(effectiveTask),
          providerOptions as ProviderOptions,
        ),
      }, {
        task: effectiveTask,
        taskKind,
        primaryRoute,
        fallbackRoute,
        allowFallback: !visualRepairRouteOverride,
      });
      const usage = mapUsage(result.usage);
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        usage,
        status: "complete",
        details: modelTraceDetails({
          kind: "generateText",
          label,
          task: effectiveTask,
          taskKind,
          prompt: guidedPrompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          providerOptions: providerOptions as ProviderOptions,
          trace,
          output: result.text,
          outputKind: "text",
        }),
      });
      return {
        text: result.text,
        usage,
      };
    } catch (error) {
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        details: modelTraceDetails({
          kind: "generateText",
          label,
          task: effectiveTask,
          taskKind,
          prompt: guidedPrompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          providerOptions: providerOptions as ProviderOptions,
          trace,
        }),
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
    const trace = readTraceDetails(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    let primaryRoute: ModelRoute | undefined;
    let qualityRoute: ModelRoute | undefined;
    let formInventoryRoute: ModelRoute | undefined;
    let coverageCleanupRoute: ModelRoute | undefined;
    let visualTableRepairRoute: ModelRoute | undefined;
    let fallbackRoute: ModelRoute | undefined;
    let routeSource: string | undefined;
    let transport: string | undefined;
    let model: LanguageModel = routing?.ctx && routing.orgId
      ? await getModelAndRouteForOrg(routing.ctx, routing.orgId, effectiveTask).then((resolved) => {
        primaryRoute = resolved.route;
        qualityRoute = resolved.qualityRoute;
        formInventoryRoute = resolved.formInventoryRoute;
        coverageCleanupRoute = resolved.coverageCleanupRoute;
        visualTableRepairRoute = resolved.visualTableRepairRoute;
        fallbackRoute = resolved.fallbackRoute;
        routeSource = resolved.routeSource;
        transport = resolved.transport;
        return resolved.model;
      })
      : (() => {
        primaryRoute = MODEL_ROUTING[effectiveTask];
        routeSource = "static";
        return getModel(effectiveTask);
      })();
    const primaryRouteOverride = primaryRouteForCall({ task: effectiveTask, taskKind, primaryRoute, qualityRoute });
    if (primaryRouteOverride) {
      primaryRoute = primaryRouteOverride;
      routeSource = "quality";
      transport = undefined;
      model = getModelForRoute(primaryRouteOverride);
    }
    const formInventoryRouteOverrideValue = formInventoryRouteOverride(taskKind, formInventoryRoute);
    if (formInventoryRouteOverrideValue) {
      primaryRoute = formInventoryRouteOverrideValue;
      routeSource = "form_inventory";
      transport = undefined;
      model = getModelForRoute(formInventoryRouteOverrideValue);
    }
    const coverageCleanupRouteOverrideValue = coverageCleanupRouteOverride(taskKind, trace, coverageCleanupRoute);
    if (coverageCleanupRouteOverrideValue) {
      primaryRoute = coverageCleanupRouteOverrideValue;
      routeSource = "coverage_cleanup";
      transport = undefined;
      model = getModelForRoute(coverageCleanupRouteOverrideValue);
    }
    const visualRepairRouteOverride = visualTableRepairRouteOverride(trace, visualTableRepairRoute);
    if (visualRepairRouteOverride) {
      primaryRoute = visualRepairRouteOverride;
      routeSource = "visual_table_repair";
      transport = undefined;
      model = getModelForRoute(visualRepairRouteOverride);
    }
    const effectiveMaxTokens = getEffectiveMaxTokens(effectiveTask, taskKind, maxTokens, primaryRoute);
    const startedAt = nowMs();
    const label = modelTraceLabel("generateObject", taskKind, effectiveTask, trace);
    try {
      const result = await generateStructuredWithFallback({
        model,
        system,
        ...buildPromptInput(
          guidedPrompt,
          providerOptions as Record<string, unknown> | undefined,
          primaryRoute,
        ),
        output: Output.object({ schema: structuredOutputSchemaForRoute(schema, primaryRoute) }),
        maxOutputTokens: effectiveMaxTokens,
        providerOptions: mergeProviderOptions(
          primaryRoute ? getProviderOptionsForRoute(primaryRoute) : getProviderOptionsForTask(effectiveTask),
          providerOptions as ProviderOptions,
        ),
      }, {
        task: effectiveTask,
        taskKind,
        primaryRoute,
        fallbackRoute,
        allowFallback: !visualRepairRouteOverride,
      });
      const usage = mapUsage(result.usage);
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        usage,
        status: "complete",
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: effectiveTask,
          taskKind,
          prompt: guidedPrompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          providerOptions: providerOptions as ProviderOptions,
          trace,
          output: result.output,
          outputKind: "object",
        }),
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
          label,
          task: effectiveTask,
          taskKind,
          route: primaryRoute,
          routeSource,
          transport,
          durationMs: nowMs() - startedAt,
          status: "soft_failed",
          error: message,
          details: modelTraceDetails({
            kind: "generateObject",
            label,
            task: effectiveTask,
            taskKind,
            prompt: guidedPrompt,
            system,
            maxOutputTokens: effectiveMaxTokens,
            providerOptions: providerOptions as ProviderOptions,
            trace,
            output: { sections: [] },
            outputKind: "object",
          }),
        });
        return {
          object: { sections: [] } as unknown,
          usage: undefined,
        };
      }

      if (shouldReturnEmptyFormInventory(taskKind)) {
        await recordModelTrace(routing, {
          label,
          task: effectiveTask,
          taskKind,
          route: primaryRoute,
          routeSource,
          transport,
          durationMs: nowMs() - startedAt,
          status: "soft_failed",
          error: message,
          details: modelTraceDetails({
            kind: "generateObject",
            label,
            task: effectiveTask,
            taskKind,
            prompt: guidedPrompt,
            system,
            maxOutputTokens: effectiveMaxTokens,
            providerOptions: providerOptions as ProviderOptions,
            trace,
            output: { forms: [] },
            outputKind: "object",
          }),
        });
        return {
          object: { forms: [] } as unknown,
          usage: undefined,
        };
      }

      if (shouldReturnEmptyVisualTableRepair(trace)) {
        await recordModelTrace(routing, {
          label,
          task: effectiveTask,
          taskKind,
          route: primaryRoute,
          routeSource,
          transport,
          durationMs: nowMs() - startedAt,
          status: "soft_failed",
          error: message,
          details: modelTraceDetails({
            kind: "generateObject",
            label,
            task: effectiveTask,
            taskKind,
            prompt: guidedPrompt,
            system,
            maxOutputTokens: effectiveMaxTokens,
            providerOptions: providerOptions as ProviderOptions,
            trace,
            output: { tables: [], warnings: [] },
            outputKind: "object",
          }),
        });
        return {
          object: { tables: [], warnings: [] } as unknown,
          usage: undefined,
        };
      }

      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: primaryRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: message,
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: effectiveTask,
          taskKind,
          prompt: guidedPrompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          providerOptions: providerOptions as ProviderOptions,
          trace,
        }),
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
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "google":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;
    case "fireworks":
      return process.env.FIREWORKS_API_KEY;
    default:
      return undefined;
  }
}

function embeddingGatewayModelId(route: ModelRoute) {
  if (route.provider === "fireworks") return `fireworks/${route.model}`;
  return route.model.includes("/") ? route.model : `${route.provider}/${route.model}`;
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
      return gateway.embeddingModel(embeddingGatewayModelId(route));
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
  let route: ModelRoute = { provider: "openai", model: "text-embedding-3-small" };
  let apiKey: string | undefined;
  if (ctx && orgId) {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
    const configuredRoute = settings?.routes?.embeddings;
    if (configuredRoute) {
      route = configuredRoute;
      apiKey = settings?.routeSources?.embeddings === "broker"
        ? settings?.providerKeys?.[configuredRoute.provider]
        : undefined;
    }
  }
  const envApiKey = directEmbeddingApiKey(route.provider);
  const embeddingModel = apiKey || envApiKey
    ? embeddingProviderModel(route, apiKey)
    : gateway.embeddingModel(embeddingGatewayModelId(route));
  return {
    embeddingModel,
    providerOptions: embeddingProviderOptions(route),
  };
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
  const getConfig = () => {
    configPromise ??= resolveEmbeddingConfig(ctx, orgId);
    return configPromise;
  };

  return async (texts: string[]) => {
    if (!texts.length) return [];
    const { embeddingModel, providerOptions } = await getConfig();
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: texts,
      maxParallelCalls: options?.maxParallelCalls,
      providerOptions,
    });
    return embeddings;
  };
}

/**
 * Create an EmbedText callback. Broker overrides are only used when the broker
 * has supplied a matching provider key; otherwise Glass uses its default config.
 */
export function makeEmbedText(ctx?: ActionCtx, orgId?: Id<"organizations">): EmbedText {
  let configPromise: ReturnType<typeof resolveEmbeddingConfig> | null = null;
  const getConfig = () => {
    configPromise ??= resolveEmbeddingConfig(ctx, orgId);
    return configPromise;
  };

  return async (text: string) => {
    const { embeddingModel, providerOptions } = await getConfig();
    const { embedding } = await embed({
      model: embeddingModel,
      providerOptions,
      value: text,
    });
    return embedding;
  };
}

/** Embedding dimensions — must match the vector index in schema.ts. */
export const EMBEDDING_DIMENSIONS = 1536;
