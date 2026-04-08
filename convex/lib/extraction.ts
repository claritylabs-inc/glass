export {
  createUniformModelConfig,
  stripFences,
  sanitizeNulls,
  applyExtracted,
  applyExtractedQuote,
  mergeChunkedSections,
  mergeChunkedQuoteSections,
  getPageChunks,
  enrichSupplementaryFields,
  classifyDocumentType,
  extractFromPdf,
  extractSectionsOnly,
  extractQuoteFromPdf,
  extractPageRange,
  getPdfPageCount,
  POLICY_TYPES,
  CONTEXT_KEY_MAP,
} from "@claritylabs/cl-sdk";

export type { LogFn, PromptBuilder, PolicyType, ContextKeyMapping, TokenUsage, ModelConfig, PdfContentFormat, ConvertPdfToImagesFn } from "@claritylabs/cl-sdk";

import { getModel } from "./models";
import type { ModelConfig } from "@claritylabs/cl-sdk";

/**
 * Build Prism's extraction ModelConfig using the centralized model router.
 * Classification + sections + enrichment → Haiku (fast)
 * Metadata + sectionsFallback → extraction model (Kimi K2.5 or Sonnet)
 */
export function buildExtractionModels(): ModelConfig {
  const haiku = getModel("classification");   // Claude Haiku — fast classification
  const kimi = getModel("analysis");          // Kimi K2.5 — reliable JSON, good quality
  const sonnet = getModel("extraction");      // Claude Sonnet — fallback only
  return {
    classification: haiku,      // Pass 0: quick policy/quote detection
    metadata: kimi,             // Pass 1: metadata extraction (Kimi better JSON than Sonnet)
    sections: kimi,             // Pass 2: text-only chunked extraction
    sectionsFallback: sonnet,   // Pass 2 fallback: retry with Sonnet if Kimi truncates
    enrichment: kimi,           // Pass 3: text-only enrichment
  };
}
