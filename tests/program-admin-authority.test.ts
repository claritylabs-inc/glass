import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

describe("program administrator authority model", () => {
  it("persists partner registry, standing authorization, certificate requests, and approvals", () => {
    const schema = readFileSync(join(ROOT, "convex/schema.ts"), "utf-8");

    expect(schema).toContain("partnerPrograms: defineTable");
    expect(schema).toContain("categoryLabels");
    expect(schema).toContain("partnerProgramEmbeddings: defineTable");
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
    const signup = readFileSync(join(ROOT, "app/signup/page.tsx"), "utf-8");
    const programAdminSignup = readFileSync(join(ROOT, "app/signup/program-admin/page.tsx"), "utf-8");
    const programAdminOnboarding = readFileSync(join(ROOT, "app/onboarding/program-admin/page.tsx"), "utf-8");

    expect(partners).toContain("resolveCertificateAuthority");
    expect(partners).toContain("saveProgram");
    expect(partners).toContain("vectorSearch");
    expect(partners).toContain("needs_program_selection");
    expect(partners).toContain("createCertificateRequestInternal");
    expect(partners).toContain("approveCertificateRequest");
    expect(partners).toContain("approvePolicyChangeCase");
    expect(certificates).toContain("pending_approval");
    expect(certificates).toContain("standing_authorization");
    expect(pce).toContain("markPolicyChangePendingPartnerInternal");
    expect(signup).toContain("I&apos;m a broker or insurance agent");
    expect(signup).toContain("I&apos;m an MGA or program administrator");
    expect(programAdminSignup).toContain('role="partner"');
    expect(programAdminOnboarding).toContain("createPartnerOrg");
  });

  it("exposes program management, template building, and role-specific notification settings", () => {
    const nav = readFileSync(join(ROOT, "components/app-sidebar/nav-config.tsx"), "utf-8");
    const partners = readFileSync(join(ROOT, "convex/partnerPrograms.ts"), "utf-8");
    const programsPage = readFileSync(join(ROOT, "app/partner/programs/page.tsx"), "utf-8");
    const templatesPage = readFileSync(join(ROOT, "app/partner/templates/page.tsx"), "utf-8");
    const notificationsPage = readFileSync(join(ROOT, "app/settings/notifications/page.tsx"), "utf-8");

    expect(nav).toContain("/partner/programs");
    expect(nav).toContain("/partner/templates");
    expect(programsPage).toContain("auto_approve_all");
    expect(programsPage).toContain("llm_review");
    expect(programsPage).toContain("TagListEditor");
    expect(programsPage).toContain("@/components/ui/select");
    expect(programsPage).toContain("saveProgram");
    expect(templatesPage).toContain("react-moveable");
    expect(templatesPage).toContain("pdf_overlay");
    expect(templatesPage).toContain("custom_smart");
    expect(templatesPage).toContain("Autofill prompt");
    expect(partners).toContain("autoPlaceTemplateFields");
    expect(notificationsPage).toContain("PARTNER_PREF_ROWS");
    expect(notificationsPage).toContain("CLIENT_PREF_ROWS");
    expect(notificationsPage).toContain("BROKER_PREF_ROWS");
  });
});
