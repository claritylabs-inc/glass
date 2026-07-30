import { describe, expect, it } from "vitest";
import { formatDisplayPolicyPeriod } from "../../lib/date-format";
import { policyTermTypeFromVersionSnapshot } from "./policyVersioning";

describe("policy version snapshots", () => {
  it("reads a stored policy term type for historical period formatting", () => {
    const policyTermType = policyTermTypeFromVersionSnapshot({
      policyTermType: " continuous ",
    });
    expect(policyTermType).toBe("continuous");
    expect(formatDisplayPolicyPeriod(
      "01/01/2026",
      "01/01/2027",
      policyTermType,
    )).toBe("Jan 1, 2026 — Until Cancelled");
  });

  it("ignores missing or malformed policy term types", () => {
    expect(policyTermTypeFromVersionSnapshot(undefined)).toBeUndefined();
    expect(policyTermTypeFromVersionSnapshot({
      policyTermType: 12,
    })).toBeUndefined();
  });
});
