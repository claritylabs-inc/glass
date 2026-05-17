"use node";

import dayjs from "dayjs";
import {
  chunkSourceSpans,
  normalizeDoclingDocument,
  type DoclingDocumentLike,
  type SourceChunk,
  type SourceSpan,
} from "@claritylabs/cl-sdk";
import { buildPdfSourceSpans, type GlassSourceChunk, type GlassSourceSpan } from "./pdfSourceSpans";

type DoclingSourceKind = "policy_pdf" | "application_pdf" | "email" | "attachment" | "manual_note";

export type PdfPreparationResult = {
  text: string;
  parserBackend: "docling" | "pdfjs";
  parserVersion?: string;
  parsedAt: number;
  parsingMs?: number;
  doclingDocument?: DoclingDocumentLike;
  sourceSpans: Array<SourceSpan | GlassSourceSpan>;
  sourceChunks: Array<SourceChunk | GlassSourceChunk>;
};

export type DoclingConvertResult = {
  document: DoclingDocumentLike;
  metadata: {
    parserBackend: "docling";
    parserVersion?: string;
    parsedAt?: number;
    parsingMs?: number;
  };
};

const DEFAULT_TIMEOUT_MS = readBoundedIntEnv("DOCLING_CONVERT_TIMEOUT_MS", 120_000, 1_000, 15 * 60_000);

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function workerUrl(): string | undefined {
  const raw = process.env.EXTRACTION_WORKER_URL;
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

function sourceTextFromSpans(sourceSpans: Array<SourceSpan | GlassSourceSpan>): string {
  const pageSpans = sourceSpans.filter(
    (span) => (span as { metadata?: Record<string, unknown> }).metadata?.sourceUnit !== "section_candidate",
  );
  return pageSpans
    .map((span) => {
      const page = typeof span.pageStart === "number" ? `Page ${span.pageStart}\n` : "";
      return `${page}${span.text}`;
    })
    .filter((text) => text.trim())
    .join("\n\n");
}

export async function tryConvertPdfWithDocling(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: DoclingSourceKind;
  timeoutMs?: number;
}): Promise<DoclingConvertResult | null> {
  const baseUrl = workerUrl();
  const secret = process.env.EXTRACTION_WORKER_SECRET;
  if (!baseUrl || !secret) return null;

  try {
    const response = await fetch(`${baseUrl}/docling/convert`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        documentId: params.documentId,
        sourceKind: params.sourceKind ?? "policy_pdf",
        pdfBase64: Buffer.from(params.pdfBytes).toString("base64"),
      }),
      signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Docling worker returned ${response.status}`);
    }
    const payload = await response.json() as {
      document?: unknown;
      metadata?: DoclingConvertResult["metadata"];
    };
    if (!payload.document || typeof payload.document !== "object") {
      throw new Error("Docling worker returned no document");
    }
    return {
      document: payload.document as DoclingDocumentLike,
      metadata: {
        parserBackend: "docling",
        ...payload.metadata,
      },
    };
  } catch (error) {
    console.warn(`Docling conversion unavailable; using PDF fallback: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function preparePdfTextWithDoclingFallback(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: DoclingSourceKind;
}): Promise<PdfPreparationResult> {
  const startedAt = dayjs().valueOf();
  const converted = await tryConvertPdfWithDocling(params);
  if (converted) {
    const normalized = normalizeDoclingDocument(converted.document, {
      documentId: params.documentId,
      sourceKind: params.sourceKind ?? "policy_pdf",
    });
    const sourceChunks = chunkSourceSpans(normalized.sourceSpans);
    return {
      text: normalized.fullText,
      parserBackend: "docling",
      parserVersion: converted.metadata.parserVersion,
      parsedAt: converted.metadata.parsedAt ?? dayjs().valueOf(),
      parsingMs: converted.metadata.parsingMs,
      doclingDocument: converted.document,
      sourceSpans: normalized.sourceSpans,
      sourceChunks,
    };
  }

  const pdfSource = await buildPdfSourceSpans({
    pdfBytes: params.pdfBytes,
    documentId: params.documentId,
    sourceKind: params.sourceKind,
  });
  return {
    text: sourceTextFromSpans(pdfSource.sourceSpans),
    parserBackend: "pdfjs",
    parsedAt: dayjs().valueOf(),
    parsingMs: dayjs().valueOf() - startedAt,
    sourceSpans: pdfSource.sourceSpans,
    sourceChunks: pdfSource.sourceChunks,
  };
}

export async function tryBuildDoclingPdfText(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: DoclingSourceKind;
  maxChars?: number;
  timeoutMs?: number;
}): Promise<string | null> {
  const converted = await tryConvertPdfWithDocling(params);
  if (!converted) return null;
  const normalized = normalizeDoclingDocument(converted.document, {
    documentId: params.documentId,
    sourceKind: params.sourceKind ?? "attachment",
  });
  const text = normalized.fullText.trim();
  if (!text) return null;
  const maxChars = params.maxChars ?? 40_000;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
