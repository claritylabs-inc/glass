import { LiteParse, type ParsedPage, type TextItem } from "@llamaindex/liteparse";
import dayjs from "dayjs";
import {
  buildSourceSpan,
  chunkSourceSpans,
  type SourceChunk,
  type SourceKind,
  type SourceSpan,
} from "@claritylabs/cl-sdk";

type SourceKindInput = Extract<SourceKind, "policy_pdf" | "application_pdf" | "email" | "attachment" | "manual_note">;

export type LiteParseConversionMetadata = {
  parserBackend: "liteparse";
  parserVersion?: string;
  parsedAt: number;
  parsingMs: number;
  pageCount: number;
};

export type LiteParseConversionResult = {
  text: string;
  sourceSpans: SourceSpan[];
  sourceChunks: SourceChunk[];
  metadata: LiteParseConversionMetadata;
};

type PositionedCell = {
  text: string;
  item: TextItem;
};

type PositionedRow = {
  cells: PositionedCell[];
  pageNum: number;
  bbox: { page: number; x: number; y: number; width: number; height: number };
  text: string;
};

const LITEPARSE_VERSION = "2.0.3";
const TABLE_HEADER_PATTERN = /\b(coverage|limit|limits?|basis|retroactive|deductible|premium|tax|fee|sub-?limit|aggregate|claim)\b/i;
const TABLE_VALUE_PATTERN = /\b(CAD|USD|\$|limit|aggregate|claim|shared|claims?-made|prior acts?|full prior|deductible|premium|tax|fee)\b/i;

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function spanWithBbox(span: SourceSpan, bbox: PositionedRow["bbox"]): SourceSpan {
  return {
    ...span,
    bbox: [bbox],
    metadata: {
      ...(span.metadata ?? {}),
      bbox: `${formatNumber(bbox.x)},${formatNumber(bbox.y)},${formatNumber(bbox.width)},${formatNumber(bbox.height)}`,
    },
  };
}

function textItemCenterY(item: TextItem): number {
  return item.y + item.height / 2;
}

function rowTolerance(items: TextItem[]): number {
  const fontSizes = items
    .map((item) => item.fontSize ?? item.height)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const median = fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 10;
  return Math.max(2, median * 0.65);
}

function groupRows(page: ParsedPage): PositionedRow[] {
  const items = page.textItems
    .map((item) => ({ ...item, text: normalizeWhitespace(item.text) }))
    .filter((item) => item.text.length > 0)
    .sort((a, b) => textItemCenterY(a) - textItemCenterY(b) || a.x - b.x);
  const tolerance = rowTolerance(items);
  const rowItems: TextItem[][] = [];

  for (const item of items) {
    const current = rowItems[rowItems.length - 1];
    if (!current || Math.abs(textItemCenterY(current[0]) - textItemCenterY(item)) > tolerance) {
      rowItems.push([item]);
    } else {
      current.push(item);
    }
  }

  return rowItems
    .map((cells) => {
      const ordered = cells.sort((a, b) => a.x - b.x);
      const minX = Math.min(...ordered.map((item) => item.x));
      const minY = Math.min(...ordered.map((item) => item.y));
      const maxX = Math.max(...ordered.map((item) => item.x + item.width));
      const maxY = Math.max(...ordered.map((item) => item.y + item.height));
      return {
        cells: ordered.map((item) => ({ item, text: normalizeWhitespace(item.text) })),
        pageNum: page.pageNum,
        bbox: {
          page: page.pageNum,
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        },
        text: ordered.map((item) => item.text).join(" "),
      };
    })
    .filter((row) => row.text.trim().length > 0);
}

function isTableLikeRow(row: PositionedRow): boolean {
  if (row.cells.length < 2) return false;
  const rowText = row.text;
  if (TABLE_HEADER_PATTERN.test(rowText) || TABLE_VALUE_PATTERN.test(rowText)) return true;
  return row.cells.some((cell, index) => {
    const next = row.cells[index + 1];
    return next ? next.item.x - (cell.item.x + cell.item.width) > 18 : false;
  });
}

function isHeaderRow(row: PositionedRow): boolean {
  return row.cells.length >= 2 && TABLE_HEADER_PATTERN.test(row.text) && !/\$|\bCAD\b|\bUSD\b|\d{2,}/i.test(row.text);
}

function normalizeHeader(value: string, index: number): string {
  const normalized = normalizeWhitespace(value).replace(/[:*]+$/g, "");
  return normalized || `Column ${index + 1}`;
}

function alignHeaders(headers: string[], cells: PositionedCell[]): string[] {
  if (headers.length === cells.length) return headers;
  if (headers.length > 0 && headers.length < cells.length) {
    return [
      ...headers,
      ...Array.from({ length: cells.length - headers.length }, (_, index) => `Column ${headers.length + index + 1}`),
    ];
  }
  return cells.map((_, index) => `Column ${index + 1}`);
}

function rowTextWithHeaders(row: PositionedRow, headers: string[]): string {
  const alignedHeaders = alignHeaders(headers, row.cells);
  if (alignedHeaders.length === 0) {
    return row.cells.map((cell) => cell.text).join(" | ");
  }
  return row.cells
    .map((cell, index) => `${alignedHeaders[index]}: ${cell.text}`)
    .join(" | ");
}

function buildLiteParseSourceSpans(params: {
  pages: ParsedPage[];
  text: string;
  documentId: string;
  sourceKind: SourceKindInput;
}): SourceSpan[] {
  const sourceSpans: SourceSpan[] = [];

  for (const page of params.pages) {
    const pageText = normalizeWhitespace(page.text);
    if (pageText) {
      const pageSpan = buildSourceSpan({
        documentId: params.documentId,
        sourceKind: params.sourceKind,
        text: pageText,
        pageStart: page.pageNum,
        pageEnd: page.pageNum,
        sourceUnit: "page",
        metadata: {
          sourceSystem: "liteparse",
          sourceUnit: "page",
          pageWidth: formatNumber(page.width),
          pageHeight: formatNumber(page.height),
        },
      }, sourceSpans.length);
      sourceSpans.push(pageSpan);
    }

    const rows = groupRows(page);
    let currentHeaders: string[] = [];
    let tableIndex = 0;
    let rowIndex = 0;
    let inTable = false;

    for (const row of rows) {
      const tableLike = isTableLikeRow(row);
      if (!tableLike) {
        inTable = false;
        currentHeaders = [];
        if (row.text.length >= 12) {
          const textSpan = spanWithBbox(buildSourceSpan({
            documentId: params.documentId,
            sourceKind: params.sourceKind,
            text: row.text,
            pageStart: page.pageNum,
            pageEnd: page.pageNum,
            sourceUnit: "text",
            metadata: {
              sourceSystem: "liteparse",
              sourceUnit: "line",
            },
          }, sourceSpans.length), row.bbox);
          sourceSpans.push(textSpan);
        }
        continue;
      }

      if (!inTable) {
        tableIndex += 1;
        rowIndex = 0;
        inTable = true;
      }

      const tableId = `${params.documentId}:liteparse:p${page.pageNum}:table${tableIndex}`;
      const headerRow = isHeaderRow(row);
      const rowText = headerRow ? row.cells.map((cell) => cell.text).join(" | ") : rowTextWithHeaders(row, currentHeaders);
      const rowSpan = spanWithBbox(buildSourceSpan({
        documentId: params.documentId,
        sourceKind: params.sourceKind,
        text: rowText,
        pageStart: page.pageNum,
        pageEnd: page.pageNum,
        sourceUnit: "table_row",
        table: {
          tableId,
          rowIndex,
          isHeader: headerRow,
        },
        metadata: {
          sourceSystem: "liteparse",
          sourceUnit: "table_row",
          tableId,
          isHeader: String(headerRow),
        },
      }, sourceSpans.length), row.bbox);
      sourceSpans.push(rowSpan);

      const alignedHeaders = alignHeaders(currentHeaders, row.cells);
      for (const [columnIndex, cell] of row.cells.entries()) {
        const cellBbox = {
          page: page.pageNum,
          x: cell.item.x,
          y: cell.item.y,
          width: cell.item.width,
          height: cell.item.height,
        };
        const columnName = alignedHeaders[columnIndex];
        const cellSpan = spanWithBbox(buildSourceSpan({
          documentId: params.documentId,
          sourceKind: params.sourceKind,
          text: cell.text,
          pageStart: page.pageNum,
          pageEnd: page.pageNum,
          sourceUnit: "table_cell",
          parentSpanId: rowSpan.id,
          table: {
            tableId,
            rowIndex,
            columnIndex,
            columnName,
            rowSpanId: rowSpan.id,
            isHeader: headerRow,
          },
          metadata: {
            sourceSystem: "liteparse",
            sourceUnit: "table_cell",
            tableId,
            parentSpanId: rowSpan.id,
            columnName: columnName ?? "",
            isHeader: String(headerRow),
          },
        }, sourceSpans.length), cellBbox);
        sourceSpans.push(cellSpan);
      }

      if (headerRow) {
        currentHeaders = row.cells.map((cell, index) => normalizeHeader(cell.text, index));
      }
      rowIndex += 1;
    }
  }

  return sourceSpans;
}

export async function convertPdfWithLiteParse(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: SourceKindInput;
  maxPages?: number;
  maxFileSize?: number;
}): Promise<LiteParseConversionResult> {
  if (params.maxFileSize && params.pdfBytes.byteLength > params.maxFileSize) {
    throw new Error(`PDF exceeds LiteParse maximum size (${params.pdfBytes.byteLength} > ${params.maxFileSize})`);
  }

  const startedAt = dayjs().valueOf();
  const parser = new LiteParse({
    ocrEnabled: readBooleanEnv("LITEPARSE_OCR_ENABLED", false),
    ocrLanguage: process.env.LITEPARSE_OCR_LANGUAGE ?? "eng",
    maxPages: params.maxPages ?? readBoundedIntEnv("LITEPARSE_MAX_PAGES", 1000, 1, 5000),
    dpi: readBoundedIntEnv("LITEPARSE_DPI", 150, 72, 600),
    quiet: true,
    numWorkers: readBoundedIntEnv("LITEPARSE_NUM_WORKERS", 4, 1, 32),
  });
  const parsed = await parser.parse(Buffer.from(params.pdfBytes));
  const sourceSpans = buildLiteParseSourceSpans({
    pages: parsed.pages,
    text: parsed.text,
    documentId: params.documentId,
    sourceKind: params.sourceKind ?? "policy_pdf",
  });

  return {
    text: parsed.text,
    sourceSpans,
    sourceChunks: chunkSourceSpans(sourceSpans),
    metadata: {
      parserBackend: "liteparse",
      parserVersion: LITEPARSE_VERSION,
      parsedAt: dayjs().valueOf(),
      parsingMs: dayjs().valueOf() - startedAt,
      pageCount: parsed.pages.length,
    },
  };
}
