import { describe, expect, it } from "vitest";
import {
  isUnsupportedSpreadsheetAttachment,
  isXlsxSpreadsheetAttachment,
  spreadsheetRowsToCsv,
} from "./spreadsheetText";

describe("spreadsheet attachment text helpers", () => {
  it("recognizes xlsx attachments without sending them through the unsupported spreadsheet path", () => {
    expect(
      isXlsxSpreadsheetAttachment("report.xlsx", "application/octet-stream"),
    ).toBe(true);
    expect(
      isXlsxSpreadsheetAttachment(
        "report",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
    expect(
      isUnsupportedSpreadsheetAttachment(
        "report.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false);
  });

  it("flags legacy or macro spreadsheet formats as unsupported", () => {
    expect(
      isUnsupportedSpreadsheetAttachment("legacy.xls", "application/vnd.ms-excel"),
    ).toBe(true);
    expect(
      isUnsupportedSpreadsheetAttachment(
        "macro.xlsm",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
      ),
    ).toBe(true);
  });

  it("serializes rows into clipped csv text with stable dates and quoting", () => {
    const csv = spreadsheetRowsToCsv([
      ["Name", "Notes"],
      ["Acme", 'hello, "world"'],
      [null, null],
      ["Effective", new Date("2026-01-02T12:00:00.000Z")],
    ]);

    expect(csv).toBe(
      'Name,Notes\nAcme,"hello, ""world"""\nEffective,2026-01-02',
    );
  });
});
