import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("Meta tags and OG image branding", () => {
  it("app/layout.tsx has the full platform default title", () => {
    const src = readFileSync(join(__dirname, "../app/layout.tsx"), "utf-8");
    expect(src).toContain('const DEFAULT_TITLE = "Glass from Clarity Labs"');
    expect(src).not.toMatch(/default:\s*["']Glass["']/);
    expect(src).not.toMatch(/siteName:\s*["']Glass["']/);
  });

  it("app/opengraph-image.tsx alt uses the full platform name", () => {
    const src = readFileSync(join(__dirname, "../app/opengraph-image.tsx"), "utf-8");
    expect(src).toContain('alt = "Glass from Clarity Labs"');
    expect(src).not.toContain('alt = "Glass"');
  });
});
