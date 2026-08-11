import { describe, expect, it } from "vitest";
import {
  policyOverviewBranding,
  tonePolicyCardColor,
  tonePolicyOverviewColor,
} from "@/lib/policy-card-branding";

describe("policy card branding", () => {
  it("tones saturated website colors into a consistent dark palette", () => {
    expect(tonePolicyCardColor("#009C33")).toBe("#0E6537");
    expect(tonePolicyCardColor("#EE202E")).toBe("#8A2434");
    expect(tonePolicyCardColor("#DA532C")).toBe("#803F33");
  });

  it("keeps the neutral fallback unchanged", () => {
    expect(tonePolicyCardColor()).toBe("#1E293B");
  });

  it("uses a light carrier tint with dark text for policy overviews", () => {
    expect(tonePolicyOverviewColor("#2066AE")).toBe("#90B3D7");
    expect(policyOverviewBranding("#2066AE").surfaceStyle).toEqual({
      backgroundColor: "#90B3D7",
      color: "#0F172A",
    });
  });

  it("uses a quiet neutral overview when no carrier color was recovered", () => {
    expect(tonePolicyOverviewColor()).toBe("#F1F5F9");
  });
});
