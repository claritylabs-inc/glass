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
export type { LogFn, PolicyType, ContextKeyMapping, TokenUsage, ConvertPdfToImagesFn } from "@claritylabs/cl-sdk";
export type { ExtractorConfig, ExtractionResult, ExtractionState, ExtractOptions, InsuranceDocument, DocumentChunk, PipelineCheckpoint, AuxiliaryFact } from "@claritylabs/cl-sdk";

// ── Local re-exports ──
export { insuranceDocToPolicy, policyToInsuranceDoc } from "./documentMapping";

// ── Prism extraction factory ──
import { createExtractor } from "@claritylabs/cl-sdk";
import type { ExtractionResult, ExtractionState, LogFn, PipelineCheckpoint, TokenUsage } from "@claritylabs/cl-sdk";
import { makeGenerateText, makeGenerateObject } from "./sdkCallbacks";

/**
 * Build an extractor pre-configured with Prism's model routing.
 *
 * The SDK's coordinator uses generateText for classification and planning,
 * and generateObject for focused extraction workers. Prism routes both
 * through its multi-model config.
 */
export function buildExtractor(opts?: {
  log?: LogFn;
  onProgress?: (message: string) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
  onCheckpointSave?: (checkpoint: PipelineCheckpoint<ExtractionState>) => Promise<void>;
}) {
  return createExtractor({
    generateText: makeGenerateText("extraction"),
    generateObject: makeGenerateObject("extraction"),
    concurrency: 2,
    maxReviewRounds: 2,
    log: opts?.log,
    onProgress: opts?.onProgress,
    onTokenUsage: opts?.onTokenUsage,
    onCheckpointSave: opts?.onCheckpointSave,
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
