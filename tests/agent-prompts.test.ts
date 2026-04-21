import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Static analysis: confirm user-facing "Glass" strings are removed from
 * agent system prompts and convex action files.
 */

const AGENT_ACTION_FILES = [
  "convex/actions/handleInboundEmail.ts",
  "convex/actions/processThreadChat.ts",
  "convex/actions/generateEmailBody.ts",
];

// Lines that are comments, internal identifiers, or regex patterns that intentionally
// reference the old string for backward-compat matching — allowed to remain.
const ALLOW_PATTERNS = [
  /\/\/.*Glass/,       // comment lines
  /GlassClient/,       // internal type identifier
  /GlassBot/,          // User-Agent string (not user-facing copy)
];

function isAllowed(line: string): boolean {
  return ALLOW_PATTERNS.some((p) => p.test(line));
}

describe("Agent prompts: no user-facing Glass strings", () => {
  for (const relPath of AGENT_ACTION_FILES) {
    it(`${relPath} has no user-facing "Glass" copy`, () => {
      const src = readFileSync(join(__dirname, "..", relPath), "utf-8");
      const violations = src
        .split("\n")
        .filter((line) => /Glass/.test(line) && !isAllowed(line));
      expect(violations).toEqual([]);
    });
  }
});
