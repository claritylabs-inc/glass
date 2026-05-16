"use node";

/**
 * Extraction pipeline — cl-sdk
 *
 * Replaces the old multi-pass extraction (classifyDocumentType → extractFromPdf/extractQuoteFromPdf → applyExtracted)
 * with the new coordinator/worker pipeline: createExtractor(config).extract(pdfBase64).
 *
 * The new SDK handles classification, extraction, and assembly internally.
 * It returns a validated InsuranceDocument + retrieval-friendly DocumentChunks.
 */

// ── Still exported from SDK ──
export { stripFences, sanitizeNulls, extractPageRange, getPdfPageCount } from "@claritylabs/cl-sdk";
export { POLICY_TYPES, CONTEXT_KEY_MAP } from "@claritylabs/cl-sdk";
export { chunkDocument, createExtractor } from "@claritylabs/cl-sdk";

// ── Types ──
export type { LogFn, PolicyType, ContextKeyMapping, TokenUsage, ConvertPdfToImagesFn, PdfInput } from "@claritylabs/cl-sdk";
export type { ExtractorConfig, ExtractionResult, ExtractionState, ExtractOptions, InsuranceDocument, DocumentChunk, PipelineCheckpoint, AuxiliaryFact } from "@claritylabs/cl-sdk";

// ── Local re-exports ──
export { insuranceDocToPolicy, policyToInsuranceDoc } from "./documentMapping";

// ── Glass extraction factory ──
import { createExtractor } from "@claritylabs/cl-sdk";
import type { ExtractionResult, ExtractionState, LogFn, PipelineCheckpoint, TokenUsage } from "@claritylabs/cl-sdk";
import { makeGenerateText, makeGenerateObject, type DoclingMeta } from "./sdkCallbacks";
import { modelCapabilitiesForTask } from "./modelCatalog";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function readReviewModeEnv(name: string, fallback: "always" | "auto" | "skip"): "always" | "auto" | "skip" {
  const raw = process.env[name];
  if (raw === "always" || raw === "auto" || raw === "skip") return raw;
  return fallback;
}

/**
 * Build an extractor pre-configured with Glass's model routing.
 *
 * The SDK's coordinator uses generateText for classification and planning,
 * and generateObject for focused extraction workers. Glass routes both
 * through its multi-model config.
 */
export function buildExtractor(opts?: {
  ctx?: ActionCtx;
  orgId?: Id<"organizations">;
  log?: LogFn;
  onProgress?: (message: string) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
  onCheckpointSave?: (checkpoint: PipelineCheckpoint<ExtractionState>) => Promise<void>;
  onDoclingMeta?: (meta: DoclingMeta) => void;
  shouldCancel?: () => Promise<boolean>;
}) {
  const routing = opts?.ctx && opts.orgId
    ? { ctx: opts.ctx, orgId: opts.orgId, onDoclingMeta: opts.onDoclingMeta }
    : undefined;
  const generateText = makeGenerateText("extraction", routing);
  const generateObject = makeGenerateObject("extraction", routing);
  const concurrency = readBoundedIntEnv("EXTRACTION_CONCURRENCY", 6, 1, 8);
  const throwIfCancelled = async () => {
    if (await opts?.shouldCancel?.()) {
      throw new Error("Cancelled by user");
    }
  };

  return createExtractor({
    generateText: async (params) => {
      await throwIfCancelled();
      const result = await generateText(params);
      await throwIfCancelled();
      return result;
    },
    generateObject: async (params) => {
      await throwIfCancelled();
      const result = await generateObject(params);
      await throwIfCancelled();
      return result;
    },
    concurrency,
    pageMapConcurrency: readBoundedIntEnv(
      "EXTRACTION_PAGE_MAP_CONCURRENCY",
      concurrency,
      1,
      8,
    ),
    extractorConcurrency: readBoundedIntEnv(
      "EXTRACTION_EXTRACTOR_CONCURRENCY",
      concurrency,
      1,
      8,
    ),
    formatConcurrency: readBoundedIntEnv(
      "EXTRACTION_FORMAT_CONCURRENCY",
      concurrency,
      1,
      8,
    ),
    // Let cl-sdk's evidence-gated auto review decide when a repair pass is useful.
    // Hosts can still disable it explicitly via EXTRACTION_REVIEW_MODE=skip.
    maxReviewRounds: readBoundedIntEnv("EXTRACTION_MAX_REVIEW_ROUNDS", 1, 0, 2),
    reviewMode: readReviewModeEnv("EXTRACTION_REVIEW_MODE", "auto"),
    log: opts?.log,
    onProgress: opts?.onProgress,
    onTokenUsage: opts?.onTokenUsage,
    onCheckpointSave: opts?.onCheckpointSave,
    modelCapabilities: modelCapabilitiesForTask("extraction"),
  });
}

export function summarizeExtractionCheckpoint(
  result: { checkpoint?: ExtractionResult["checkpoint"] },
): string[] {
  const state = result.checkpoint?.state as
    | {
        pageAssignments?: Array<{ localPageNumber: number; extractorNames?: string[] }>;
        plan?: { tasks?: Array<{ extractorName: string; startPage: number; endPage: number }> };
      }
    | undefined;

  if (!state) return [];

  const lines: string[] = [];

  if (state.pageAssignments?.length) {
    const pageMap = state.pageAssignments
      .filter((assignment) => assignment.extractorNames?.length)
      .map((assignment) => `${assignment.localPageNumber}:${assignment.extractorNames!.join("|")}`)
      .join(", ");

    if (pageMap) lines.push(`Checkpoint page map: ${pageMap}`);
  }

  if (state.plan?.tasks?.length) {
    const taskSummary = state.plan.tasks
      .map((task) => `${task.extractorName} ${task.startPage}-${task.endPage}`)
      .join(", ");
    lines.push(`Checkpoint task plan: ${taskSummary}`);
  }

  return lines;
}
