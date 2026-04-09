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

export type { LogFn, PromptBuilder, PolicyType, ContextKeyMapping, TokenUsage, ModelConfig, PdfContentFormat, ConvertPdfToImagesFn, TokenLimits } from "@claritylabs/cl-sdk";

/**
 * Prism's token limit overrides — more generous than cl-sdk defaults
 * to handle complex commercial policies with many coverages/schedules.
 */
export const PRISM_TOKEN_LIMITS = {
  classification: 1024,
  metadata: 32768,
  sections: 16384,
  sectionsFallback: 32768,
  enrichment: 8192,
};

import { getModel } from "./models";
import type { ModelConfig } from "@claritylabs/cl-sdk";

/**
 * Build Prism's extraction ModelConfig using the centralized model router.
 * Classification + sections + enrichment → Haiku (fast)
 * Metadata + sectionsFallback → extraction model (Kimi K2.5 or Sonnet)
 */
export function buildExtractionModels(): ModelConfig {
  const haiku = getModel("classification");   // Claude Haiku — fast classification
  const kimi = getModel("analysis");          // Kimi K2.5 — text-only (no PDF via AI SDK)
  const sonnet = getModel("extraction");      // Claude Sonnet — native PDF reading
  return {
    classification: haiku,      // Pass 0: reads PDF → needs native support
    metadata: sonnet,           // Pass 1: reads PDF → needs native support
    sections: sonnet,           // Pass 2: reads PDF → Kimi can't read PDFs via AI SDK
    sectionsFallback: sonnet,   // Pass 2 fallback
    enrichment: kimi,           // Pass 3: text-only enrichment (no PDF needed)
  };
}
