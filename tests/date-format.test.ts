import { describe, expect, it } from "vitest";
import {
  formatDisplayDate,
  formatDisplayPolicyPeriod,
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

  it("describes a policy with no expiration as ongoing from its start date", () => {
    expect(formatDisplayPolicyPeriod("07/28/2026", undefined)).toBe(
      "Ongoing from Jul 28, 2026",
    );
    expect(formatDisplayPolicyPeriod("07/28/2026", "07/28/2027")).toBe(
      "Jul 28, 2026 – Jul 28, 2027",
    );
  });

  it("preserves continuous-term semantics even when an expiration is stored", () => {
    expect(
      formatDisplayPolicyPeriod(
        "07/28/2026",
        "07/28/2027",
        "continuous",
      ),
    ).toBe("Jul 28, 2026 — Until Cancelled");
    expect(
      formatDisplayPolicyPeriod(undefined, "07/28/2027", "CONTINUOUS"),
    ).toBe("Until Cancelled");
  });
});
