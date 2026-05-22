"use node";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import dayjs from "dayjs";
import { formatSecurityPanel, type CoiData } from "./coiGenerator";

type CoverageColumnKey =
  | "coverage_name"
  | "policy_number"
  | "effective_date"
  | "expiration_date"
  | "per_occurrence_limit"
  | "aggregate_limit"
  | "coverage_description"
  | "limits";

export type CoiOverlayField = {
  id?: string;
  type?: "data" | "static" | "custom_smart" | "coverage_table";
  key?: string;
  label?: string;
  value?: string;
  customPrompt?: string;
  coverageConfig?: {
    coverageMode?: "all" | "llm_specified";
    coveragePrompt?: string;
    columns?: CoverageColumnKey[];
    rowHeight?: number;
  };
  page?: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  align?: "left" | "center" | "right";
};

export type CoiOverlayMapping = {
  fields?: CoiOverlayField[];
};

function joinCoverageLimits(data: CoiData) {
  return data.coverages
    .flatMap((coverage) => {
      const limitLines = coverage.limits.map((limit) => `${coverage.type} ${limit.label}: ${limit.value}`);
      if (limitLines.length > 0) return limitLines;
      return [coverage.description, coverage.sectionRef].filter(Boolean).map((value) => `${coverage.type}: ${value}`);
    })
    .join("\n");
}

function fieldValue(data: CoiData, key?: string, fallback?: string) {
  if (!key) return fallback ?? "";
  const generatedAt = dayjs();
  const values: Record<string, string | undefined> = {
    issued_date: generatedAt.format("YYYY-MM-DD"),
    coi_generation_date: generatedAt.format("YYYY-MM-DD"),
    coi_generation_time: generatedAt.format("h:mm A"),
    coi_number: data.certificateNumber,
    certificate_number: data.certificateNumber,
    certificate_holder: data.certificateHolder,
    insured_name: data.insuredName,
    insured_address:
      typeof data.insuredAddress === "string"
        ? data.insuredAddress
        : [
            data.insuredAddress?.street1,
            data.insuredAddress?.city,
            data.insuredAddress?.state,
            data.insuredAddress?.zip,
          ]
            .filter(Boolean)
            .join(", "),
    producer: data.producerAgency,
    producer_contact: data.producerContact,
    producer_phone: data.producerPhone,
    producer_email: data.producerEmail,
    carrier: data.insurers[0]?.name,
    security_panel: formatSecurityPanel(data.securityPanel),
    capacity_panel: formatSecurityPanel(data.securityPanel),
    insurer_panel: formatSecurityPanel(data.securityPanel),
    insurer_a: data.insurers[0]?.name,
    policy_number: data.coverages[0]?.policyNumber,
    effective_date: data.coverages[0]?.effectiveDate,
    expiration_date: data.coverages[0]?.expirationDate,
    coverage_summary: data.coverages.map((coverage) => coverage.type).join(", "),
    limits: joinCoverageLimits(data),
    description: data.description,
    certified_notice: data.certificationNotice,
  };
  return values[key] ?? fallback ?? "";
}

function normalizeUnit(value: number, size: number) {
  if (!Number.isFinite(value)) return 0;
  return value <= 1 ? value * size : value;
}

function alignX(
  text: string,
  x: number,
  width: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  fontSize: number,
  align: CoiOverlayField["align"],
) {
  if (align === "center") {
    return x + Math.max(0, width - font.widthOfTextAtSize(text, fontSize)) / 2;
  }
  if (align === "right") {
    return x + Math.max(0, width - font.widthOfTextAtSize(text, fontSize));
  }
  return x;
}

function coverageLimitValue(coverage: CoiData["coverages"][number], match: "per_occurrence" | "aggregate") {
  const limit = coverage.limits.find((item) => {
    const label = item.label.toLowerCase();
    return match === "per_occurrence"
      ? label.includes("occurrence") || label.includes("accident")
      : label.includes("aggregate");
  });
  return limit?.value ?? "";
}

function coverageColumnValue(
  coverage: CoiData["coverages"][number],
  column: CoverageColumnKey,
) {
  switch (column) {
    case "coverage_name":
      return coverage.type;
    case "policy_number":
      return coverage.policyNumber ?? "";
    case "effective_date":
      return coverage.effectiveDate ?? "";
    case "expiration_date":
      return coverage.expirationDate ?? "";
    case "per_occurrence_limit":
      return coverageLimitValue(coverage, "per_occurrence");
    case "aggregate_limit":
      return coverageLimitValue(coverage, "aggregate");
    case "coverage_description":
      return coverage.description ?? coverage.typeNotes ?? "";
    case "limits":
      return [
        ...coverage.limits.map((limit) => `${limit.label}: ${limit.value}`),
        coverage.sectionRef ? `Section: ${coverage.sectionRef}` : undefined,
      ]
        .filter(Boolean)
        .join("; ");
  }
}

function coverageColumnWeight(column: CoverageColumnKey) {
  switch (column) {
    case "coverage_name":
      return 1.6;
    case "policy_number":
      return 1.35;
    case "effective_date":
    case "expiration_date":
      return 0.85;
    case "per_occurrence_limit":
    case "aggregate_limit":
      return 1;
    case "coverage_description":
      return 1.8;
    case "limits":
      return 1.5;
  }
}

function coverageColumnAlign(column: CoverageColumnKey): CoiOverlayField["align"] {
  switch (column) {
    case "effective_date":
    case "expiration_date":
    case "per_occurrence_limit":
    case "aggregate_limit":
      return "center";
    default:
      return "left";
  }
}

function normalizeCellText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function fitSingleLineText(
  text: string,
  width: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  preferredSize: number,
) {
  const normalized = normalizeCellText(text);
  const minSize = Math.max(4.5, preferredSize * 0.62);
  let size = preferredSize;
  while (size > minSize && font.widthOfTextAtSize(normalized, size) > width) {
    size -= 0.25;
  }
  if (font.widthOfTextAtSize(normalized, size) <= width) {
    return { text: normalized, size };
  }

  const ellipsis = "...";
  let truncated = normalized;
  while (truncated.length > 1 && font.widthOfTextAtSize(`${truncated}${ellipsis}`, size) > width) {
    truncated = truncated.slice(0, -1);
  }
  return { text: `${truncated.trimEnd()}${ellipsis}`, size };
}

function filteredCoverages(data: CoiData, field: CoiOverlayField) {
  const config = field.coverageConfig;
  if (config?.coverageMode !== "llm_specified" || !config.coveragePrompt?.trim()) {
    return data.coverages;
  }
  const terms = config.coveragePrompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
  if (terms.length === 0) return data.coverages;
  const matches = data.coverages.filter((coverage) => {
    const haystack = [
      coverage.type,
      coverage.typeNotes,
      coverage.description,
      coverage.sectionRef,
      coverage.deductible,
      coverage.policyNumber,
      ...coverage.limits.flatMap((limit) => [limit.label, limit.value]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
  return matches.length > 0 ? matches : data.coverages;
}

function drawCoverageTable(
  page: ReturnType<PDFDocument["getPages"]>[number],
  data: CoiData,
  field: CoiOverlayField,
  box: { x: number; yTop: number; width: number; height: number; pageHeight: number },
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  fontSize: number,
) {
  const columns = field.coverageConfig?.columns?.length
    ? field.coverageConfig.columns
    : (["coverage_name", "policy_number", "effective_date", "expiration_date", "per_occurrence_limit", "aggregate_limit"] as CoverageColumnKey[]);
  const rowHeight = Math.max(fontSize + 4, normalizeUnit(field.coverageConfig?.rowHeight ?? 0.045, box.pageHeight));
  const totalWeight = columns.reduce((sum, column) => sum + coverageColumnWeight(column), 0);
  const columnWidths = columns.map((column) => (box.width * coverageColumnWeight(column)) / totalWeight);
  const rows = filteredCoverages(data, field);
  const maxRows = Math.max(1, Math.floor(box.height / rowHeight));

  rows.slice(0, maxRows).forEach((coverage, rowIndex) => {
    const rowTop = box.pageHeight - box.yTop - rowIndex * rowHeight;
    columns.forEach((column, columnIndex) => {
      const text = coverageColumnValue(coverage, column);
      if (!text.trim()) return;
      const columnX = box.x + columnWidths.slice(0, columnIndex).reduce((sum, width) => sum + width, 0);
      const cellWidth = Math.max(8, columnWidths[columnIndex] - 4);
      const fitted = fitSingleLineText(text, cellWidth, font, fontSize);
      const y = rowTop - (rowHeight + fitted.size) / 2;
      page.drawText(fitted.text, {
        x: alignX(fitted.text, columnX + 2, cellWidth, font, fitted.size, coverageColumnAlign(column)),
        y,
        size: fitted.size,
        font,
        color: rgb(0, 0, 0),
      });
    });
  });
}

export async function renderCoiPdfOverlay(
  templateBytes: ArrayBuffer,
  data: CoiData,
  mapping: CoiOverlayMapping,
): Promise<Buffer> {
  const pdf = await PDFDocument.load(templateBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const fields = Array.isArray(mapping.fields) ? mapping.fields : [];

  for (const field of fields) {
    const page = pages[Math.max(0, Math.min(pages.length - 1, (field.page ?? 1) - 1))];
    if (!page) continue;
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const width = normalizeUnit(field.width ?? 0.2, pageWidth);
    const height = normalizeUnit(field.height ?? 0.03, pageHeight);
    const x = normalizeUnit(field.x, pageWidth);
    const yTop = normalizeUnit(field.y, pageHeight);
    const fontSize = field.fontSize ?? 9;
    if (field.type === "coverage_table") {
      drawCoverageTable(page, data, field, { x, yTop, width, height, pageHeight }, font, fontSize);
      continue;
    }
    const text =
      field.type === "static"
        ? field.value ?? ""
        : field.type === "custom_smart"
          ? field.value ?? ""
        : fieldValue(data, field.key, field.value);
    if (!text.trim()) continue;

    const lines = text.split(/\r?\n/).slice(0, Math.max(1, Math.floor(height / (fontSize + 2))));
    lines.forEach((line, index) => {
      const y = pageHeight - yTop - fontSize - index * (fontSize + 2);
      page.drawText(line, {
        x: alignX(line, x, width, font, fontSize, field.align),
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: width,
      });
    });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
