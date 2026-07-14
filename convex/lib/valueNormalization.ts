import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

const DATE_FORMATS = [
  "MM/DD/YYYY",
  "M/D/YYYY",
  "MM/DD/YY",
  "M/D/YY",
  "MM-DD-YYYY",
  "M-D-YYYY",
  "MM-DD-YY",
  "M-D-YY",
  "MM.DD.YYYY",
  "M.D.YYYY",
  "YYYY-MM-DD",
  "YYYY-M-D",
  "YYYY/MM/DD",
  "YYYY/M/D",
  "YYYY.MM.DD",
  "YYYY.M.D",
  "YYYYMMDD",
  "MMM D, YYYY",
  "MMM DD, YYYY",
  "MMMM D, YYYY",
  "MMMM DD, YYYY",
  "MMM D YYYY",
  "MMM DD YYYY",
  "MMMM D YYYY",
  "MMMM DD YYYY",
  "D MMM YYYY",
  "DD MMM YYYY",
  "D MMMM YYYY",
  "DD MMMM YYYY",
];

const MISSING_VALUES = new Set([
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

export function normalizeExtractedString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (MISSING_VALUES.has(trimmed.toLowerCase())) return undefined;
  return trimmed || undefined;
}

export function normalizeExtractedDate(value: unknown): string | undefined {
  const normalized = normalizeExtractedString(value);
  if (!normalized) return undefined;

  const iso = normalized.match(
    /\b(?:19|20)[0-9]{2}\s*[./-]\s*[0-9]{1,2}\s*[./-]\s*[0-9]{1,2}(?![0-9])/,
  );
  const explicit = normalized.match(
    /\b([0-9]{1,2})\s*[./-]\s*([0-9]{1,2})\s*[./-]\s*([0-9]{2,4})\b/,
  );
  const named = normalized.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)[0-9]{2}\b|\b[0-9]{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:19|20)[0-9]{2}\b/i,
  );
  const rawDate = (iso?.[0] ?? explicit?.[0] ?? named?.[0] ?? normalized)
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/i, "$1")
    .replace(/\bSept\.?\b/i, "Sep")
    .replace(/\./g, "");
  const parsed = dayjs(rawDate, DATE_FORMATS, true);
  return parsed.isValid() ? parsed.format("MM/DD/YYYY") : undefined;
}

function fieldNameTokens(fieldName: string): string[] {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isExtractedDateField(fieldName: string): boolean {
  const tokens = fieldNameTokens(fieldName);
  if (tokens.some((token) => ["date", "effective", "expiration", "expiry", "inception"].includes(token))) {
    return true;
  }
  return tokens.some((token) => ["period", "term"].includes(token)) &&
    tokens.some((token) => ["start", "end", "from", "to"].includes(token));
}

const DATE_VALUE_KEYS = new Set(["value", "normalizedValue", "rawValue", "displayValue"]);

function normalizeDateBearingValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeExtractedDate(value) ?? value;
  if (Array.isArray(value)) return value.map(normalizeDateBearingValue);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      DATE_VALUE_KEYS.has(key)
        ? normalizeDateBearingValue(child)
        : normalizeExtractedDateFields(child),
    ]),
  );
}

/** Normalize every recognized date-bearing field in an extracted payload. */
export function normalizeExtractedDateFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeExtractedDateFields);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const describedFields = [record.field, record.key, record.fieldGroup, record.label]
    .filter((field): field is string => typeof field === "string");
  const describedValueIsDate = describedFields.some(isExtractedDateField) ||
    [record.valueKind, record.fieldType, record.type].some(
      (kind) => typeof kind === "string" && kind.toLowerCase() === "date",
    );

  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => {
      const shouldNormalize = isExtractedDateField(key) ||
        (describedValueIsDate && DATE_VALUE_KEYS.has(key));
      return [
        key,
        shouldNormalize
          ? normalizeDateBearingValue(child)
          : normalizeExtractedDateFields(child),
      ];
    }),
  );
}

export function parseExtractedNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const normalized = normalizeExtractedString(value);
  if (!normalized) return undefined;

  const match = normalized.match(
    /(?:\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(m|mm|million|k|thousand)?\b|([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(m|mm|million|k|thousand)\b|([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\b|([0-9]+(?:\.[0-9]+)?)\b)/i,
  );
  if (!match) return undefined;

  const baseText = match[1] ?? match[3] ?? match[5] ?? match[6];
  const base = Number.parseFloat(baseText.replace(/,/g, ""));
  if (!Number.isFinite(base)) return undefined;

  const suffix = (match[2] ?? match[4])?.toLowerCase();
  const scaled =
    suffix === "m" || suffix === "mm" || suffix === "million"
      ? base * 1_000_000
      : suffix === "k" || suffix === "thousand"
        ? base * 1_000
        : base;

  return Math.round((scaled + Number.EPSILON) * 100) / 100;
}

export function formatCurrencyAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function normalizeMoneyString(value: unknown): string | undefined {
  const amount = parseExtractedNumber(value);
  if (amount === undefined) return normalizeExtractedString(value);
  return formatCurrencyAmount(amount);
}

export function normalizeMoneyField(value: unknown): {
  text?: string;
  amount?: number;
} {
  const amount = parseExtractedNumber(value);
  return {
    text: amount === undefined ? normalizeExtractedString(value) : formatCurrencyAmount(amount),
    ...(amount !== undefined ? { amount } : {}),
  };
}
