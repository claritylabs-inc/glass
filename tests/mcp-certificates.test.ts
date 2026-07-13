import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

describe("certificate API surfaces", () => {
  it("exposes certificate generation and listing through REST and MCP", () => {
    const http = readFileSync(join(ROOT, "convex/http.ts"), "utf-8");
    const apiDto = readFileSync(join(ROOT, "convex/lib/apiDto.ts"), "utf-8");

    expect(http).toContain('pathPrefix: "/api/v1/policies/"');
    expect(http).toContain("handlePolicyRestGet");
    expect(http).toContain("handlePolicyRestPost");
    expect(http).toContain("parts.length > 5");
    expect(http).toContain("parts.length !== 5");
    expect(http).toContain('/api/v1/certificate-holders');
    expect(http).toContain('"/api/v1/policies/{id}/certificates"');
    expect(http).toContain('"/api/v1/policies/{id}/versions"');
    expect(http).toContain('"/api/v1/policies/{id}/certificate-versions"');
    expect(http).toContain('/api/v1/certificate-review-jobs');
    expect(http).toContain('/mcp/policies/certificates/list');
    expect(http).toContain('/mcp/policies/certificates/generate');
    expect(http).toContain('/mcp/certificates/holders/list');
    expect(http).toContain('/mcp/policies/versions/list');
    expect(http).toContain('/mcp/policies/certificates/versions/list');
    expect(http).toContain('/mcp/certificates/review-jobs/list');
    expect(http).toContain('name: "list_policy_certificates"');
    expect(http).toContain('name: "generate_policy_certificate"');
    expect(http).toContain('name: "list_certificate_holders"');
    expect(http).toContain('name: "list_policy_versions"');
    expect(http).toContain('name: "list_certificate_versions"');
    expect(http).toContain('name: "list_certificate_review_jobs"');
    expect(http).toContain("toCertificateDto");
    expect(http).toContain("forceReissue");
    expect(apiDto).toContain("request_kind");
    expect(apiDto).toContain("additional_insured_name");
    expect(apiDto).toContain("description_of_operations");
    expect(apiDto).not.toContain("standing_authorization_id");
    expect(apiDto).toContain("policy_certificate_id");
    expect(apiDto).toContain("version_kind");
    expect(apiDto).toContain("recipient_email");
    expect(http).toContain("requestedEndorsements");
    expect(http).toContain("requestText");
    expect(http).toContain("holderEmail");
    expect(http).toContain("certificate_holder_email");
    expect(http).toContain("certificate_holder_country");
    expect(http).toContain('country: {');
  });
});
