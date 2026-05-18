import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

const DATE_FORMATS = [
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "YYYY/M/D",
  "MMM D, YYYY",
  "MMMM D, YYYY",
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

  const explicit = normalized.match(
    /\b([0-9]{1,2})\s*[/-]\s*([0-9]{1,2})\s*[/-]\s*([0-9]{2,4})\b/,
  );
  const rawDate = explicit?.[0] ?? normalized;
  const parsed = dayjs(rawDate, DATE_FORMATS, true);
  return parsed.isValid() ? parsed.format("MM/DD/YYYY") : undefined;
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
