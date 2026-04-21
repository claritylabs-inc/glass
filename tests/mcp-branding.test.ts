import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const TOOLS_DIR = join(__dirname, "../mcp-server/src/tools");

/**
 * Confirm no user-facing "Glass" strings appear in MCP tool description fields.
 * Internal identifiers (GlassClient type references) are excluded.
 */
describe("MCP tool descriptions", () => {
  const toolFiles = readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".ts"));

  for (const file of toolFiles) {
    it(`${file} has no user-facing "Glass" in description strings`, () => {
      const src = readFileSync(join(TOOLS_DIR, file), "utf-8");
      // Extract description field values from tool registration calls
      const descriptionMatches = [...src.matchAll(/description:\s*["'`]([^"'`]+)["'`]/g)];
      for (const match of descriptionMatches) {
        expect(match[1]).not.toMatch(/Glass/i);
      }
    });
  }
});
