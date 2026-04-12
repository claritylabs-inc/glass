"use node";

/**
 * Extraction pipeline — cl-sdk v0.5.0
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
export type { ExtractorConfig, ExtractionResult, InsuranceDocument, DocumentChunk } from "@claritylabs/cl-sdk";

// ── Local re-exports ──
export { insuranceDocToPolicy, policyToInsuranceDoc } from "./documentMapping";

// ── Prism extraction factory ──
import { createExtractor } from "@claritylabs/cl-sdk";
import type { LogFn, TokenUsage } from "@claritylabs/cl-sdk";
import { makeGenerateText, makeGenerateObject } from "./sdkCallbacks";

/**
 * Build an extractor pre-configured with Prism's model routing.
 *
 * The SDK's coordinator uses generateText for classification and planning,
 * and generateObject for focused extraction workers. Prism routes both
 * through its multi-model config (Sonnet for extraction, Haiku for classification).
 */
export function buildExtractor(opts?: {
  log?: LogFn;
  onProgress?: (message: string) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
}) {
  return createExtractor({
    generateText: makeGenerateText("extraction"),
    generateObject: makeGenerateObject("extraction"),
    concurrency: 2,
    maxReviewRounds: 2,
    log: opts?.log,
    onProgress: opts?.onProgress,
    onTokenUsage: opts?.onTokenUsage,
  });
}
