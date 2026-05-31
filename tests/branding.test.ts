import { describe, it, expect } from "vitest";
import { getDefaultBranding, getBrandingContext } from "../convex/lib/branding";

describe("getDefaultBranding", () => {
  it("returns Glass as default brand name", () => {
    const b = getDefaultBranding();
    expect(b.brandName).toBe("Glass");
    expect(b.shortBrandName).toBe("Glass");
    expect(b.agentDisplayName).toBe("Glass Agent");
  });

  it("returns a logo URL", () => {
    const b = getDefaultBranding();
    expect(b.logoUrl).toBeTruthy();
  });

  it("keeps platform-owned user-facing fields branded", () => {
    const b = getDefaultBranding();
    expect(b.brandName).toMatch(/Glass/i);
    expect(b.shortBrandName).toMatch(/Glass/i);
    expect(b.agentDisplayName).toMatch(/Glass/i);
  });
});

describe("getBrandingContext with org overrides", () => {
  it("falls back to Glass defaults when no overrides", () => {
    const b = getBrandingContext();
    expect(b.brandName).toBe("Glass");
    expect(b.agentDisplayName).toBe("Glass Agent");
  });

  it("uses org agentDisplayName as brandName", () => {
    const b = getBrandingContext({ agentDisplayName: "Acme Insurance" });
    expect(b.brandName).toBe("Acme Insurance");
    expect(b.agentDisplayName).toBe("Acme Insurance Agent");
  });

  it("uses org brandingColor", () => {
    const b = getBrandingContext({ brandingColor: "#FF0000" });
    expect(b.brandColor).toBe("#FF0000");
  });

  it("falls back to default color when not provided", () => {
    const b = getBrandingContext({});
    expect(b.brandColor).toBe("#2563EB");
  });
});
