import { describe, expect, it } from "vitest";
import { policyPeriod } from "../app/share/imessage/[token]/view";

describe("public iMessage app-card policy period", () => {
  it("renders continuous terms independently of an expiration placeholder", () => {
    expect(
      policyPeriod({
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        policyTermType: "continuous",
      }),
    ).toBe("Jan 1, 2026 — Until Cancelled");
  });
});
