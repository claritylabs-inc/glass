import { describe, expect, it } from "vitest";
import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayDateTimeWithSeconds,
} from "@/lib/date-format";

describe("display date formatting", () => {
  it.each([
    ["03/08/2026", "Mar 8, 2026"],
    ["3/8/2026", "Mar 8, 2026"],
    ["2026-03-08", "Mar 8, 2026"],
    ["March 8, 2026", "Mar 8, 2026"],
  ])("formats %s as the canonical calendar date", (value, expected) => {
    expect(formatDisplayDate(value)).toBe(expected);
  });

  it("uses the same date portion for timestamps", () => {
    const timestamp = "2026-03-08T14:05:09";

    expect(formatDisplayDateTime(timestamp)).toBe("Mar 8, 2026 at 2:05 PM");
    expect(formatDisplayDateTimeWithSeconds(timestamp)).toBe(
      "Mar 8, 2026 at 2:05:09 PM",
    );
  });

  it("uses the caller fallback for missing or invalid values", () => {
    expect(formatDisplayDate(undefined, "Not listed")).toBe("Not listed");
    expect(formatDisplayDate("not-a-date", "Unknown")).toBe("Unknown");
  });
});
