import { describe, expect, it } from "vitest";
import { policySearchScore } from "./aiUtils";

describe("policySearchScore", () => {
  it("keeps structured-only carrier matches", () => {
    expect(
      policySearchScore(
        { carrier: "Travelers" },
        "",
        undefined,
        "Travelers",
      ),
    ).toBeGreaterThan(0);
  });

  it("keeps structured-only line-of-business matches", () => {
    expect(
      policySearchScore({ linesOfBusiness: ["CGL"] }, "", "CGL"),
    ).toBeGreaterThan(0);
  });

  it("rejects structured-only mismatches", () => {
    expect(
      policySearchScore(
        { carrier: "Travelers", linesOfBusiness: ["CGL"] },
        "",
        "PROP",
        "Zurich",
      ),
    ).toBe(0);
  });
});
