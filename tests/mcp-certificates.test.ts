import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

describe("certificate API surfaces", () => {
  it("exposes certificate generation and listing through REST and MCP", () => {
    const http = readFileSync(join(ROOT, "convex/http.ts"), "utf-8");
    const mcpPolicies = readFileSync(join(ROOT, "mcp-server/src/tools/policies.ts"), "utf-8");
    const mcpClient = readFileSync(join(ROOT, "mcp-server/src/client.ts"), "utf-8");

    expect(http).toContain('/api/v1/policies/:id/certificates');
    expect(http).toContain('/mcp/policies/certificates/list');
    expect(http).toContain('/mcp/policies/certificates/generate');
    expect(http).toContain('name: "list_policy_certificates"');
    expect(http).toContain('name: "generate_policy_certificate"');
    expect(http).toContain("authority_type");
    expect(http).toContain("certification_status");
    expect(http).toContain("standing_authorization_id");
    expect(http).toContain("requestedEndorsements");
    expect(http).toContain("requestText");

    expect(mcpPolicies).toContain('"list_policy_certificates"');
    expect(mcpPolicies).toContain('"generate_policy_certificate"');
    expect(mcpPolicies).toContain("requestedEndorsements");
    expect(mcpPolicies).toContain("requestText");
    expect(mcpClient).toContain('/mcp/policies/certificates/list');
    expect(mcpClient).toContain('/mcp/policies/certificates/generate');
    expect(mcpClient).toContain("requestedEndorsements");
  });
});
