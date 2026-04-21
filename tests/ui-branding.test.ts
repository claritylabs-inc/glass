import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Static analysis: confirm hardcoded "Glass" user-facing strings are gone
 * from the key UI files we rebrand in Task 4.
 */

const FILES_TO_CHECK = [
  "app/agent/thread/[id]/page.tsx",
  "app/onboarding/page.tsx",
  "app/policies/[id]/page.tsx",
  "app/weather/page.tsx",
  "app/oauth/authorize/page.tsx",
];

// Patterns that are internal identifiers — allowed to remain
const INTERNAL_PATTERNS = [
  /GlassPromptInput/,
  /GlassPromptInputHandle/,
  /GlassStarIcon/,
  /glass-prompt/,
];

function isInternal(line: string): boolean {
  return INTERNAL_PATTERNS.some((p) => p.test(line));
}

describe("UI copy: no user-facing Glass strings", () => {
  for (const relPath of FILES_TO_CHECK) {
    it(`${relPath} contains no user-facing "Glass" literals`, () => {
      const src = readFileSync(join(__dirname, "..", relPath), "utf-8");
      const violations = src
        .split("\n")
        .filter((line) => /Glass/.test(line) && !isInternal(line));
      expect(violations).toEqual([]);
    });
  }
});
