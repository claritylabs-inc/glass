"use node";

import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

type SourceSpanLike = {
  text?: string;
  pageStart?: number;
};

export type ExtractedPolicyPeriod = {
  effectiveDate: string;
  expirationDate: string;
  pageNumber?: number;
  source: "policy_period_label" | "declarations_field";
};

const PLACEHOLDER_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "extracting...",
  "extracting",
  "-",
  "—",
]);

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function isMissingCriticalValue(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

export function normalizeCriticalString(value: unknown): string | undefined {
  if (typeof value !== "string" || isMissingCriticalValue(value)) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatDate(date: dayjs.Dayjs) {
  return date.format("MM/DD/YYYY");
}

export function normalizePolicyDate(value: unknown): string | undefined {
  const normalized = normalizeCriticalString(value);
  if (!normalized) return undefined;
  const parsed = dayjs(
    normalized,
    [
      "MM/DD/YYYY",
      "M/D/YYYY",
      "YYYY-MM-DD",
      "YYYY/M/D",
      "MMM D, YYYY",
      "MMMM D, YYYY",
    ],
    true,
  );
  return parsed.isValid() ? parsed.format("MM/DD/YYYY") : normalized;
}

function validDate(month: number, day: number, year: number) {
  const parsed = dayjs(
    `${month}/${day}/${year}`,
    ["M/D/YYYY", "MM/DD/YYYY"],
    true,
  );
  return parsed.isValid() ? formatDate(parsed) : undefined;
}

function dateFromParts(
  first: number,
  second: number,
  year: number,
  order: "month_day" | "day_month" | "ambiguous",
) {
  if (year < 1900 || year > 2100) return undefined;
  if (order === "day_month") return validDate(second, first, year);
  if (order === "month_day") return validDate(first, second, year);

  if (first > 12 && second <= 12) return validDate(second, first, year);
  if (second > 12 && first <= 12) return validDate(first, second, year);
  return validDate(first, second, year);
}

function inferLabelDateOrder(text: string): "month_day" | "day_month" | "ambiguous" {
  const upper = text.toUpperCase();
  if (/DAY\s+MONTH\s+YEAR/.test(upper)) return "day_month";
  if (/MONTH\s+DAY\s+YEAR/.test(upper)) return "month_day";
  if (/MM\s*[/.-]\s*DD\s*[/.-]\s*YYYY/.test(upper)) return "month_day";
  if (/DD\s*[/.-]\s*MM\s*[/.-]\s*YYYY/.test(upper)) return "day_month";
  return "ambiguous";
}

function parseExplicitDates(text: string): string[] {
  const dates: string[] = [];
  const regex =
    /\b([0-9]{1,2})\s*[/-]\s*([0-9]{1,2})\s*[/-]\s*([0-9]{2,4})\b/g;
  for (const match of text.matchAll(regex)) {
    const year = Number(match[3]?.length === 2 ? `20${match[3]}` : match[3]);
    const date = dateFromParts(
      Number(match[1]),
      Number(match[2]),
      year,
      inferLabelDateOrder(text),
    );
    if (date) dates.push(date);
  }
  return dates;
}

function parseTripletDates(text: string): string[] {
  const dates: string[] = [];
  const order = inferLabelDateOrder(text);
  const normalized = normalizeText(text);
  const regex = /\b([0-9]{1,2})\s+([0-9]{1,2})\s+((?:19|20)[0-9]{2})\b/g;
  for (const match of normalized.matchAll(regex)) {
    const date = dateFromParts(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      order,
    );
    if (date) dates.push(date);
  }
  return dates;
}

function findPolicyPeriodInText(text: string): Omit<ExtractedPolicyPeriod, "pageNumber"> | null {
  const normalized = normalizeText(text);
  const labelRegex = /\b(?:ITEM\s*[0-9A-Z.:-]*\s*)?(?:PERIOD\s+OF\s+INSURANCE|POLICY\s+PERIOD|POLICY\s+TERM)\b/gi;

  for (const labelMatch of normalized.matchAll(labelRegex)) {
    if (labelMatch.index == null) continue;
    const window = normalized.slice(labelMatch.index, labelMatch.index + 900);
    const dates = [...parseExplicitDates(window), ...parseTripletDates(window)];
    const uniqueDates = [...new Set(dates)];
    if (uniqueDates.length < 2) continue;

    return {
      effectiveDate: uniqueDates[0],
      expirationDate: uniqueDates[1],
      source: "policy_period_label",
    };
  }

  return null;
}

function shouldReplaceDate(existing: unknown, replacement: string) {
  if (isMissingCriticalValue(existing)) return true;
  if (typeof existing !== "string") return true;
  const parsedExisting = dayjs(
    existing,
    ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD", "YYYY/M/D"],
    true,
  );
  const parsedReplacement = dayjs(replacement, "MM/DD/YYYY", true);
  if (!parsedExisting.isValid()) return true;
  return !parsedExisting.isSame(parsedReplacement, "day");
}

export function extractPolicyPeriodFromSourceSpans(
  sourceSpans: SourceSpanLike[],
): ExtractedPolicyPeriod | null {
  for (const span of sourceSpans) {
    if (!span.text) continue;
    const period = findPolicyPeriodInText(span.text);
    if (period) return { ...period, pageNumber: span.pageStart };
  }
  return null;
}

export function declarationFieldValue(
  declarations: unknown,
  fieldNames: string[],
): string | undefined {
  if (!declarations || typeof declarations !== "object") return undefined;
  const fields = (declarations as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return undefined;

  const wanted = new Set(fieldNames.map((field) => field.toLowerCase()));
  for (const rawField of fields) {
    if (!rawField || typeof rawField !== "object") continue;
    const field = rawField as { field?: unknown; value?: unknown };
    if (typeof field.field !== "string") continue;
    if (!wanted.has(field.field.toLowerCase())) continue;
    const value = normalizeCriticalString(field.value);
    if (value) return value;
  }
  return undefined;
}

export function extractPolicyPeriodFromDeclarations(
  document: Record<string, unknown>,
): ExtractedPolicyPeriod | null {
  const effectiveDate = normalizePolicyDate(
    declarationFieldValue(document.declarations, [
      "policyPeriodFrom",
      "policyEffectiveDate",
      "effectiveDate",
    ]),
  );
  const expirationDate = normalizePolicyDate(
    declarationFieldValue(document.declarations, [
      "policyPeriodTo",
      "policyExpirationDate",
      "expirationDate",
    ]),
  );

  if (!effectiveDate || !expirationDate) return null;
  return {
    effectiveDate,
    expirationDate,
    source: "declarations_field",
  };
}

export function resolvePolicyPeriod(
  document: Record<string, unknown>,
  sourceSpans: SourceSpanLike[] = [],
): ExtractedPolicyPeriod | null {
  return (
    extractPolicyPeriodFromSourceSpans(sourceSpans) ??
    extractPolicyPeriodFromDeclarations(document)
  );
}

export function applyPolicyPeriodFallback(
  document: Record<string, unknown>,
  sourceSpans: SourceSpanLike[],
): { document: Record<string, unknown>; period: ExtractedPolicyPeriod | null; changed: boolean } {
  const period = resolvePolicyPeriod(document, sourceSpans);
  if (!period) return { document, period: null, changed: false };

  const next = { ...document };
  let changed = false;
  if (shouldReplaceDate(next.effectiveDate, period.effectiveDate)) {
    next.effectiveDate = period.effectiveDate;
    changed = true;
  }
  if (shouldReplaceDate(next.expirationDate, period.expirationDate)) {
    next.expirationDate = period.expirationDate;
    changed = true;
  }

  return { document: next, period, changed };
}
