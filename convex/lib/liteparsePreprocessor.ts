"use node";

import dayjs from "dayjs";
import {
  chunkSourceSpans,
  type SourceChunk,
  type SourceSpan,
} from "@claritylabs/cl-sdk";
import {
  buildPdfSourceSpans,
  type GlassSourceChunk,
  type GlassSourceSpan,
} from "./pdfSourceSpans";

type ParsedPdfSourceKind =
  | "policy_pdf"
  | "application_pdf"
  | "email"
  | "attachment"
  | "manual_note";

export type PdfPreparationResult = {
  text: string;
  parserBackend: "liteparse" | "pdfjs";
  parserVersion?: string;
  parsedAt: number;
  parsingMs?: number;
  sourceSpans: Array<SourceSpan | GlassSourceSpan>;
  sourceChunks: Array<SourceChunk | GlassSourceChunk>;
  pageScreenshots?: PageScreenshot[];
};

export type PageScreenshot = {
  page: number;
  imageBase64: string;
  mimeType: "image/png";
  width: number;
  height: number;
};

export type LiteParseConvertResult = {
  text: string;
  sourceSpans: SourceSpan[];
  sourceChunks?: SourceChunk[];
  pageScreenshots?: PageScreenshot[];
  metadata: {
    parserBackend: "liteparse";
    parserVersion?: string;
    parsedAt?: number;
    parsingMs?: number;
    pageCount?: number;
  };
};

const DEFAULT_TIMEOUT_MS = readBoundedIntEnv(
  "LITEPARSE_CONVERT_TIMEOUT_MS",
  120_000,
  1_000,
  15 * 60_000,
);

function readBoundedIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
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

function sourceTextFromSpans(
  sourceSpans: Array<SourceSpan | GlassSourceSpan>,
): string {
  const pageSpans = sourceSpans.filter(
    (span) =>
      (span as { metadata?: Record<string, unknown> }).metadata?.sourceUnit !==
      "section_candidate",
  );
  return pageSpans
    .map((span) => {
      const page =
        typeof span.pageStart === "number" ? `Page ${span.pageStart}\n` : "";
      return `${page}${span.text}`;
    })
    .filter((text) => text.trim())
    .join("\n\n");
}

export async function tryConvertPdfWithLiteParse(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: ParsedPdfSourceKind;
  timeoutMs?: number;
}): Promise<LiteParseConvertResult | null> {
  const baseUrl = workerUrl();
  const secret = process.env.EXTRACTION_WORKER_SECRET;
  if (!baseUrl || !secret) return null;

  try {
    const response = await fetch(`${baseUrl}/liteparse/convert`, {
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
      throw new Error(`LiteParse worker returned ${response.status}`);
    }
    const payload = (await response.json()) as {
      text?: unknown;
      sourceSpans?: unknown;
      sourceChunks?: unknown;
      pageScreenshots?: unknown;
      metadata?: LiteParseConvertResult["metadata"];
    };
    if (
      typeof payload.text !== "string" ||
      !Array.isArray(payload.sourceSpans)
    ) {
      throw new Error("LiteParse worker returned no text/source spans");
    }
    return {
      text: payload.text,
      sourceSpans: payload.sourceSpans as SourceSpan[],
      sourceChunks: Array.isArray(payload.sourceChunks)
        ? (payload.sourceChunks as SourceChunk[])
        : undefined,
      pageScreenshots: Array.isArray(payload.pageScreenshots)
        ? (payload.pageScreenshots as PageScreenshot[])
        : undefined,
      metadata: {
        parserBackend: "liteparse",
        ...payload.metadata,
      },
    };
  } catch (error) {
    console.warn(
      `LiteParse conversion unavailable; using PDF fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function preparePdfTextWithParserFallback(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: ParsedPdfSourceKind;
}): Promise<PdfPreparationResult> {
  const startedAt = dayjs().valueOf();
  const converted = await tryConvertPdfWithLiteParse(params);
  if (converted) {
    const rawSource = await buildPdfSourceSpans({
      pdfBytes: params.pdfBytes,
      documentId: params.documentId,
      sourceKind: params.sourceKind ?? "policy_pdf",
    });
    const sourceSpans = [...converted.sourceSpans, ...rawSource.sourceSpans];
    const sourceChunks = [
      ...(converted.sourceChunks ?? chunkSourceSpans(converted.sourceSpans)),
      ...rawSource.sourceChunks,
    ];
    return {
      text: converted.text,
      parserBackend: "liteparse",
      parserVersion: converted.metadata.parserVersion,
      parsedAt: converted.metadata.parsedAt ?? dayjs().valueOf(),
      parsingMs: converted.metadata.parsingMs,
      sourceSpans,
      sourceChunks,
      pageScreenshots: converted.pageScreenshots,
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

export async function tryBuildParsedPdfText(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: ParsedPdfSourceKind;
  maxChars?: number;
  timeoutMs?: number;
}): Promise<string | null> {
  const converted = await tryConvertPdfWithLiteParse(params);
  if (!converted) return null;
  const text = converted.text.trim();
  if (!text) return null;
  const maxChars = params.maxChars ?? 40_000;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
