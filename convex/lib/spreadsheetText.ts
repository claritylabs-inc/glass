"use node";

import dayjs from "dayjs";
import readXlsxFile, { type Row } from "read-excel-file/node";

type SpreadsheetCell = Row[number] | Date;
type SpreadsheetRow = SpreadsheetCell[];

export function isXlsxSpreadsheetAttachment(
  filename: string,
  contentType: string,
) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lowerName.endsWith(".xlsx")
  );
}

export function isUnsupportedSpreadsheetAttachment(
  filename: string,
  contentType: string,
) {
  if (isXlsxSpreadsheetAttachment(filename, contentType)) return false;

  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type.includes("spreadsheet") ||
    type.includes("excel") ||
    type === "application/vnd.ms-excel" ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xlsm")
  );
}

function spreadsheetCellToText(value: SpreadsheetCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return dayjs(value).format("YYYY-MM-DD");
  return String(value);
}

function csvCell(value: SpreadsheetCell): string {
  const text = spreadsheetCellToText(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function spreadsheetRowsToCsv(rows: SpreadsheetRow[]): string {
  return rows
    .map((row) => {
      const cells = [...row];
      while (
        cells.length > 0 &&
        spreadsheetCellToText(cells[cells.length - 1] ?? null).trim() === ""
      ) {
        cells.pop();
      }
      return cells.map(csvCell).join(",");
    })
    .filter((row) => row.trim())
    .join("\n");
}

export async function spreadsheetBufferToText(buffer: Buffer): Promise<string> {
  const sheets = await readXlsxFile(buffer);
  const sections: string[] = [];
  for (const { sheet, data } of sheets) {
    const csv = spreadsheetRowsToCsv(data).trim();
    if (!csv) continue;
    sections.push(`Sheet: ${sheet}\n${csv}`);
  }
  return sections.join("\n\n");
}
