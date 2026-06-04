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
  pageScreenshots?: PageScreenshot[];
  metadata: LiteParseConversionMetadata;
};

export type PageScreenshot = {
  page: number;
  imageBase64: string;
  mimeType: "image/png";
  width: number;
  height: number;
};

type PositionedCell = {
  text: string;
  item: TextItem;
};

type PositionedBbox = { page: number; x: number; y: number; width: number; height: number };

type PositionedRow = {
  cells: PositionedCell[];
  pageNum: number;
  bbox: PositionedBbox;
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

function spanWithBbox(
  span: SourceSpan,
  bbox: PositionedRow["bbox"],
  pageDims: { width: number; height: number },
): SourceSpan {
  return {
    ...span,
    bbox: [bbox],
    metadata: {
      ...(span.metadata ?? {}),
      bbox: `${formatNumber(bbox.x)},${formatNumber(bbox.y)},${formatNumber(bbox.width)},${formatNumber(bbox.height)}`,
      bboxCoordinateWidth: formatNumber(pageDims.width),
      bboxCoordinateHeight: formatNumber(pageDims.height),
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

function unionBbox(left: PositionedBbox, right: PositionedBbox): PositionedBbox {
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return {
    page: left.page,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function cellBbox(cell: PositionedCell): PositionedBbox {
  return {
    page: 0,
    x: cell.item.x,
    y: cell.item.y,
    width: cell.item.width,
    height: cell.item.height,
  };
}

function mergeCell(left: PositionedCell, right: PositionedCell): PositionedCell {
  const bbox = unionBbox(cellBbox(left), cellBbox(right));
  const text = normalizeWhitespace(`${left.text} ${right.text}`);
  return {
    text,
    item: {
      ...left.item,
      text,
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height,
    },
  };
}

function mergeRows(left: PositionedRow, right: PositionedRow): PositionedRow {
  const cells = [...left.cells];
  for (const incoming of right.cells) {
    const targetIndex = nearestCellIndex(cells, incoming);
    if (targetIndex === undefined) {
      cells.push(incoming);
    } else {
      cells[targetIndex] = mergeCell(cells[targetIndex], incoming);
    }
  }
  cells.sort((a, b) => a.item.x - b.item.x);
  return {
    cells,
    pageNum: left.pageNum,
    bbox: unionBbox(left.bbox, right.bbox),
    text: cells.map((cell) => cell.text).join(" "),
  };
}

function nearestCellIndex(cells: PositionedCell[], incoming: PositionedCell): number | undefined {
  let bestIndex: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, cell] of cells.entries()) {
    const distance = Math.abs(cell.item.x - incoming.item.x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestDistance <= 48 ? bestIndex : undefined;
}

function startsNewLogicalTableRow(row: PositionedRow): boolean {
  const first = row.cells[0]?.text ?? row.text;
  if (row.cells.some((cell) => /^item\s+\d+\./i.test(cell.text))) return true;
  return /^(item\s+\d+\.|[A-Z]\.\s+|coverage\b|limit\b|basis\b|retroactive\b|deductible\b|premium\b|tax\b|fee\b)/i.test(first);
}

function endsWithContinuationMarker(value: string): boolean {
  return /(?:\b(and|of|the|for|under|within|with|from|to|or|plus)|[&,:;(-])$/i.test(value.trim());
}

function isPageFooterRow(row: PositionedRow, pageHeight: number): boolean {
  const text = normalizeWhitespace(row.text);
  const nearBottom = row.bbox.y >= pageHeight - Math.max(72, pageHeight * 0.08);
  if (!nearBottom) return false;
  if (/\bpage\s+\d+\s+of\s+\d+\b/i.test(text)) return true;
  return /^[A-Z]{2,}(?:-[A-Z0-9]+)+\s+\d{2}\s+\d{2}$/i.test(text);
}

function isContinuationTableRow(previous: PositionedRow, row: PositionedRow): boolean {
  if (!isTableLikeRow(previous)) return false;
  const previousHasContinuationMarker =
    endsWithContinuationMarker(previous.cells[0]?.text ?? "") ||
    previous.cells.some((cell) => endsWithContinuationMarker(cell.text));
  if (!previousHasContinuationMarker && isHeaderRow(row)) return false;
  if (startsNewLogicalTableRow(row)) return false;

  const previousFirst = previous.cells[0]?.text ?? "";
  const rowFirst = row.cells[0]?.text ?? "";
  if (previous.cells.length >= 2 && row.cells.length === 1) {
    const nearestIndex = nearestCellIndex(previous.cells, row.cells[0]);
    return nearestIndex !== undefined && (nearestIndex > 0 || previousHasContinuationMarker);
  }
  if (/^item\s+\d+\./i.test(previousFirst) && !/^item\s+\d+\./i.test(rowFirst)) return true;
  return previousHasContinuationMarker;
}

function sharesColumnGrid(left: PositionedRow, right: PositionedRow): boolean {
  if (left.cells.length < 2 || right.cells.length < 2) return false;
  const comparable = Math.min(left.cells.length, right.cells.length);
  let matches = 0;
  for (let index = 0; index < comparable; index += 1) {
    if (Math.abs(left.cells[index].item.x - right.cells[index].item.x) <= 36) {
      matches += 1;
    }
  }
  return matches >= Math.min(2, comparable);
}

function isSingleCellTableBridgeRow(
  previous: PositionedRow,
  row: PositionedRow,
  next: PositionedRow | undefined,
): boolean {
  if (row.cells.length !== 1 || !next) return false;
  if (!isTableLikeRow(previous) || !isTableLikeRow(next)) return false;
  if (!sharesColumnGrid(previous, next)) return false;
  if (startsNewLogicalTableRow(row) && !TABLE_VALUE_PATTERN.test(row.text)) return false;
  const nearestIndex = nearestCellIndex(previous.cells, row.cells[0]);
  return nearestIndex !== undefined || TABLE_HEADER_PATTERN.test(row.text) || TABLE_VALUE_PATTERN.test(row.text);
}

function normalizeLiteParseRows(rows: PositionedRow[], pageHeight: number): PositionedRow[] {
  const normalized: PositionedRow[] = [];
  for (const [index, row] of rows.entries()) {
    if (isPageFooterRow(row, pageHeight)) continue;
    const previous = normalized[normalized.length - 1];
    const next = rows[index + 1];
    if (previous && (isContinuationTableRow(previous, row) || isSingleCellTableBridgeRow(previous, row, next))) {
      normalized[normalized.length - 1] = mergeRows(previous, row);
      continue;
    }
    normalized.push(row);
  }
  return normalized;
}

function continuesCurrentTable(row: PositionedRow, next: PositionedRow | undefined): boolean {
  if (row.cells.length !== 1) return false;
  if (isHeaderRow(row)) return false;
  if (startsNewLogicalTableRow(row)) return true;
  if (TABLE_HEADER_PATTERN.test(row.text) || TABLE_VALUE_PATTERN.test(row.text)) return true;
  return Boolean(next && isTableLikeRow(next) && /\b(coverage|endorsement|aggregate|claim|loss|sublimit|sub-limit|defense)\b/i.test(row.text));
}

function classifyTextElement(row: PositionedRow, pageRows: PositionedRow[]): "title" | "paragraph" {
  const text = row.text.trim();
  const heights = pageRows
    .map((item) => item.bbox.height)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : row.bbox.height;
  const looksLikeHeading =
    row.bbox.height >= medianHeight * 1.2 ||
    (/^[A-Z0-9][A-Z0-9\s,.'&/():-]{6,}$/.test(text) && text.length <= 120) ||
    /^(section|coverage|endorsement|declarations?|schedule|exclusions?|conditions?)\b/i.test(text);
  return looksLikeHeading ? "title" : "paragraph";
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
      const pageSpan = {
        ...buildSourceSpan({
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
        }, sourceSpans.length),
        bbox: [{ page: page.pageNum, x: 0, y: 0, width: page.width, height: page.height }],
      };
      sourceSpans.push(pageSpan);
    }

    const rows = normalizeLiteParseRows(groupRows(page), page.height);
    let currentHeaders: string[] = [];
    let tableIndex = 0;
    let rowIndex = 0;
    let inTable = false;

    for (const [index, row] of rows.entries()) {
      const tableLike = isTableLikeRow(row) || (inTable && continuesCurrentTable(row, rows[index + 1]));
      if (!tableLike) {
        inTable = false;
        currentHeaders = [];
        if (row.text.length >= 12) {
          const elementType = classifyTextElement(row, rows);
          const textSpan = spanWithBbox(buildSourceSpan({
            documentId: params.documentId,
            sourceKind: params.sourceKind,
            text: row.text,
            pageStart: page.pageNum,
            pageEnd: page.pageNum,
            sourceUnit: "text",
            metadata: {
              sourceSystem: "liteparse",
              sourceUnit: elementType,
              elementType,
              pageWidth: formatNumber(page.width),
              pageHeight: formatNumber(page.height),
            },
          }, sourceSpans.length), row.bbox, { width: page.width, height: page.height });
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
          elementType: headerRow ? "table_header" : "table_row",
          tableId,
          isHeader: String(headerRow),
          pageWidth: formatNumber(page.width),
          pageHeight: formatNumber(page.height),
        },
      }, sourceSpans.length), row.bbox, { width: page.width, height: page.height });
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
            elementType: "table_cell",
            tableId,
            parentSpanId: rowSpan.id,
            columnName: columnName ?? "",
            isHeader: String(headerRow),
            pageWidth: formatNumber(page.width),
            pageHeight: formatNumber(page.height),
          },
        }, sourceSpans.length), cellBbox, { width: page.width, height: page.height });
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

async function buildPageScreenshots(params: {
  parser: LiteParse;
  pdfBytes: Uint8Array;
  pages: ParsedPage[];
}): Promise<PageScreenshot[]> {
  const maxPages = readBoundedIntEnv("LITEPARSE_SCREENSHOT_MAX_PAGES", 12, 0, 100);
  if (maxPages <= 0) return [];
  const pageNumbers = params.pages
    .map((page) => page.pageNum)
    .slice(0, maxPages);
  if (pageNumbers.length === 0) return [];
  try {
    const screenshots = await params.parser.screenshot(Buffer.from(params.pdfBytes), pageNumbers);
    return screenshots.map((shot) => ({
      page: shot.pageNum,
      imageBase64: shot.imageBuffer.toString("base64"),
      mimeType: "image/png" as const,
      width: shot.width,
      height: shot.height,
    }));
  } catch (error) {
    console.warn(`LiteParse screenshots unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
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
  const pageScreenshots = await buildPageScreenshots({
    parser,
    pdfBytes: params.pdfBytes,
    pages: parsed.pages,
  });

  return {
    text: parsed.text,
    sourceSpans,
    sourceChunks: chunkSourceSpans(sourceSpans),
    pageScreenshots,
    metadata: {
      parserBackend: "liteparse",
      parserVersion: LITEPARSE_VERSION,
      parsedAt: dayjs().valueOf(),
      parsingMs: dayjs().valueOf() - startedAt,
      pageCount: parsed.pages.length,
    },
  };
}
