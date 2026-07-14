import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

export const DISPLAY_DATE_FORMAT = "MMM D, YYYY";
export const DISPLAY_DATE_TIME_FORMAT = "MMM D, YYYY [at] h:mm A";
export const DISPLAY_DATE_TIME_SECONDS_FORMAT = "MMM D, YYYY [at] h:mm:ss A";

const CALENDAR_DATE_INPUT_FORMATS = [
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "MMM D, YYYY",
  "MMMM D, YYYY",
  "MMM D YYYY",
  "MMMM D YYYY",
];

type DisplayDateValue = string | number | Dayjs | null | undefined;

function parseDisplayDate(value: DisplayDateValue) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const calendarDate = dayjs(trimmed, CALENDAR_DATE_INPUT_FORMATS, true);
    if (calendarDate.isValid()) return calendarDate;
    value = trimmed;
  }

  if (value === null || value === undefined) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function formatDisplayValue(
  value: DisplayDateValue,
  format: string,
  fallback: string,
) {
  return parseDisplayDate(value)?.format(format) ?? fallback;
}

export function formatDisplayDate(
  value: DisplayDateValue,
  fallback = "",
) {
  return formatDisplayValue(value, DISPLAY_DATE_FORMAT, fallback);
}

export function formatDisplayDateTime(
  value: DisplayDateValue,
  fallback = "",
) {
  return formatDisplayValue(value, DISPLAY_DATE_TIME_FORMAT, fallback);
}

export function formatDisplayDateTimeWithSeconds(
  value: DisplayDateValue,
  fallback = "",
) {
  return formatDisplayValue(value, DISPLAY_DATE_TIME_SECONDS_FORMAT, fallback);
}
