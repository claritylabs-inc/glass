import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const FILES_TO_CHECK = [
  "app/agent/thread/[id]/page.tsx",
  "app/onboarding/page.tsx",
  "app/policies/[id]/page.tsx",
  "app/weather/page.tsx",
  "app/oauth/authorize/page.tsx",
];

describe("UI copy: Glass branding stays intentional", () => {
  for (const relPath of FILES_TO_CHECK) {
    it(`${relPath} avoids bare legacy metadata branding`, () => {
      const src = readFileSync(join(__dirname, "..", relPath), "utf-8");
      const violations = src
        .split("\n")
        .filter((line) => /default:\s*["']Glass["']|siteName:\s*["']Glass["']|alt\s*=\s*["']Glass["']/.test(line));
      expect(violations).toEqual([]);
    });
  }

  it("keeps the platform identity visible on product-owned surfaces", () => {
    const weather = readFileSync(join(__dirname, "..", "app/weather/page.tsx"), "utf-8");
    const oauth = readFileSync(join(__dirname, "..", "app/oauth/authorize/page.tsx"), "utf-8");

    expect(weather).toContain("from Clarity Labs");
    expect(oauth).toContain("Glass account");
  });
});
