import { describe, expect, it } from "vitest";
import { normalizeCertificateDescription } from "../convex/lib/certificateDescription";

describe("certificate description normalization", () => {
  it("removes form branding while preserving meaningful line breaks", () => {
    expect(normalizeCertificateDescription(
      "ACORD 25 Generated using Glass\nRestaurant and bar\n\nWaiver of subrogation applies.",
    )).toBe("Restaurant and bar\n\nWaiver of subrogation applies.");
  });

  it("accepts concise explicit wording without semantic keyword filtering", () => {
    expect(normalizeCertificateDescription("Restaurant and bar")).toBe("Restaurant and bar");
  });
});
