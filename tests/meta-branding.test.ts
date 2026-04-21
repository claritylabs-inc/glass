import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("Meta tags and OG image branding", () => {
  it("app/layout.tsx has Glass as default title", () => {
    const src = readFileSync(join(__dirname, "../app/layout.tsx"), "utf-8");
    expect(src).toContain('"Glass"');
    expect(src).not.toMatch(/default:\s*["']Glass["']/);
    expect(src).not.toMatch(/siteName:\s*["']Glass["']/);
  });

  it("app/opengraph-image.tsx alt and text use Glass", () => {
    const src = readFileSync(join(__dirname, "../app/opengraph-image.tsx"), "utf-8");
    expect(src).toContain('alt = "Glass"');
    expect(src).not.toMatch(/["']Glass["']/);
  });
});
