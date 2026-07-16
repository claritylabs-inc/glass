import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("OAuth-only API and MCP authentication", () => {
  it("does not expose long-lived Glass API keys or the legacy stdio server", () => {
    const http = read("convex/http.ts");
    const schema = read("convex/schema.ts");
    const connections = read("components/settings/connections-section.tsx");

    expect(http).toContain('rawToken.startsWith("prsm_at_")');
    expect(http).not.toContain('rawToken.startsWith("glass_")');
    expect(http).not.toContain("internal.apiKeys");
    expect(schema).not.toContain("apiKeys: defineTable");
    expect(connections).not.toContain("api.apiKeys");
    expect(existsSync(join(ROOT, "convex/apiKeys.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "convex/lib/mcpAuth.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "mcp-server/package.json"))).toBe(false);
  });
});
