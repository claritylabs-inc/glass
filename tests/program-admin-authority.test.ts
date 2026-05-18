import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

describe("program administrator authority model", () => {
  it("persists partner registry, standing authorization, certificate requests, and approvals", () => {
    const schema = readFileSync(join(ROOT, "convex/schema.ts"), "utf-8");

    expect(schema).toContain("partnerPrograms: defineTable");
    expect(schema).toContain("coiTemplates: defineTable");
    expect(schema).toContain("standingAuthorizations: defineTable");
    expect(schema).toContain("certificateRequests: defineTable");
    expect(schema).toContain("certificateApprovals: defineTable");
    expect(schema).toContain('v.literal("certified")');
    expect(schema).toContain('v.literal("non_binding")');
  });

  it("routes certificates and PCEs through partner approval surfaces", () => {
    const partners = readFileSync(join(ROOT, "convex/partnerPrograms.ts"), "utf-8");
    const certificates = readFileSync(join(ROOT, "convex/certificates.ts"), "utf-8");
    const pce = readFileSync(join(ROOT, "convex/actions/policyChangeRequests.ts"), "utf-8");

    expect(partners).toContain("resolveCertificateAuthority");
    expect(partners).toContain("createCertificateRequestInternal");
    expect(partners).toContain("approveCertificateRequest");
    expect(partners).toContain("approvePolicyChangeCase");
    expect(certificates).toContain("pending_approval");
    expect(certificates).toContain("standing_authorization");
    expect(pce).toContain("markPolicyChangePendingPartnerInternal");
  });
});
