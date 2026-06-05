import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("certificate lifecycle browser and API verification coverage", () => {
  it("keeps policy certificate UI usable for empty, held, and generated states", () => {
    const source = read("app/policies/[id]/policy-certificates-tab.tsx");

    expect(source).toContain("No certificates yet");
    expect(source).toContain("Generate a COI from the page header");
    expect(source).toContain("activity.holds");
    expect(source).toContain("on hold");
    expect(source).toContain("Held");
    expect(source).toContain("pending approval");
    expect(source).toContain("min-w-0");
    expect(source).toContain("flex-wrap");
    expect(source).toContain("truncate");
  });

  it("keeps the create/reissue drawer mobile-friendly and endorsement-aware", () => {
    const source = read("app/policies/[id]/policy-certificates-tab.tsx");

    expect(source).toContain("certificate-create-form");
    expect(source).toContain("Generate COI");
    expect(source).toContain("grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_72px_96px]");
    expect(source).toContain("Endorsement-bearing requests are checked against policy wording");
    expect(source).toContain("held_policy_change_required");
  });

  it("exposes compatible REST, MCP, and agent certificate lifecycle responses", () => {
    const http = read("convex/http.ts");
    const apiDto = read("convex/lib/apiDto.ts");
    const tools = read("mcp-server/src/tools/policies.ts");
    const chatTools = read("convex/lib/chatTools.ts");

    expect(http).toContain("/api/v1/policies/:id/certificates");
    expect(http).toContain("/mcp/policies/certificates/list");
    expect(http).toContain("/mcp/policies/certificates/generate");
    expect(apiDto).toContain("certificate_version_id");
    expect(apiDto).toContain("policy_version_id");
    expect(apiDto).toContain("version_number");
    expect(tools).toContain("list_policy_certificates");
    expect(tools).toContain("generate_policy_certificate");
    expect(chatTools).toContain("generateCoi");
  });

  it("keeps settings inheritance controls visible in broker agent settings", () => {
    const settings = read("components/settings/broker-agent-tab.tsx");

    expect(settings).toContain("certificateChangeRequestsEnabled");
    expect(settings).toContain("policyChangeRequestsEnabled");
    expect(settings).toContain("Held certificate requests create a linked policy change case");
  });
});
