import { describe, expect, it } from "vitest";
import {
  policyAsciiShaderDataUri,
  policyCardBranding,
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

  it("uses a black raster fallback and adaptive browser surface", () => {
    expect(tonePolicyCardColor()).toBe("#000000");
    expect(policyCardBranding("Insurance carrier")).toMatchObject({
      cardColor: "#000000",
      textColor: "#FFFFFF",
      surfaceClassName: "border-border bg-background text-foreground",
      surfaceStyle: undefined,
    });
  });

  it("uses a light carrier tint with dark text for policy overviews", () => {
    expect(tonePolicyOverviewColor("#2066AE")).toBe("#90B3D7");
    expect(policyOverviewBranding("Zurich Canada", "#2066AE").surfaceStyle).toEqual({
      backgroundColor: "#90B3D7",
      color: "#0F172A",
    });
  });

  it("uses theme surfaces when no carrier color was recovered", () => {
    const overviewBranding = policyOverviewBranding("Insurance carrier");

    expect(tonePolicyOverviewColor()).toBe("#FFFFFF");
    expect(overviewBranding).toMatchObject({
      surfaceClassName: "bg-background text-foreground",
      surfaceStyle: undefined,
    });
    expect(overviewBranding.patternStyle.backgroundColor).toContain(
      "currentColor",
    );
  });

  it("uses quiet static phases of the Clarity ASCII shader", () => {
    const svgs = [0, 1, 2].map((variant) =>
      decodeURIComponent(
        policyAsciiShaderDataUri(variant, "#FFFFFF").split(",")[1],
      ),
    );

    svgs.forEach((svg, phase) => {
      expect(svg).toContain('data-pattern="ascii-shader"');
      expect(svg).toContain(`data-phase="${phase}"`);
      expect(svg).toContain("<text");
      expect(svg).not.toContain("<path");
      expect(svg).not.toContain("<ellipse");
    });
    expect(new Set(svgs).size).toBe(3);
  });
});
