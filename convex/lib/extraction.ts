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
  const pdfModel = getModel("extraction");    // Sonnet — needs to read PDF files natively
  const textModel = getModel("analysis");     // Kimi K2.5 — text-only passes (sections, enrichment)
  return {
    classification: pdfModel,   // Pass 0: reads PDF pages → needs PDF support
    metadata: pdfModel,         // Pass 1: reads PDF pages → needs PDF support
    sections: textModel,        // Pass 2: text-only chunked extraction
    sectionsFallback: pdfModel, // Pass 2 fallback: retry with Sonnet if Kimi truncates
    enrichment: textModel,      // Pass 3: text-only enrichment
  };
}
