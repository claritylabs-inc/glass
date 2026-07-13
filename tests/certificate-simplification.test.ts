import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { resolveCertificateRequestMetadata } from "../convex/certificates";

const ROOT = join(__dirname, "..");

describe("simplified certificate request routing", () => {
  it("treats holder-only requests as reusable holder certificates without address requirements", () => {
    const metadata = resolveCertificateRequestMetadata({
      holderName: "Acme Property Management",
    });

    expect(metadata).toMatchObject({
      requiredChanges: [],
      hasEndorsementRequest: false,
      additionalInsuredOnly: false,
      requestKind: "holder",
      additionalInsuredName: undefined,
      requestSignature: "holder:acme property management",
    });
  });

  it("keeps source-backed operations wording out of ordinary holder certificate reuse", () => {
    const metadata = resolveCertificateRequestMetadata({
      holderName: "Acme Property Management",
      descriptionOfOperations:
        "Acme provides technology services including software development, AI/ML, and SaaS/PaaS offerings.",
    });

    expect(metadata).toMatchObject({
      requiredChanges: [],
      hasEndorsementRequest: false,
      requestKind: "holder",
    });
    expect(metadata.requestSignature).toContain("holder:acme property management|operations:");
    expect(metadata.requestSignature).toContain("saas/paas offerings");
  });

  it("uses additional-insured metadata only for pure additional-insured requests", () => {
    const metadata = resolveCertificateRequestMetadata({
      holderName: "Acme Property Management",
      additionalInsuredName: "Acme Owner LLC",
    });

    expect(metadata).toMatchObject({
      requiredChanges: ["additional_insured"],
      hasEndorsementRequest: true,
      additionalInsuredOnly: true,
      evidenceGatedOnly: true,
      requestKind: "additional_insured",
      additionalInsuredName: "Acme Owner LLC",
      requestSignature: "additional_insured:acme owner llc",
    });
  });

  it("routes evidence-gated endorsements through evidence review and holds true policy changes", () => {
    const waiverMetadata = resolveCertificateRequestMetadata({
      holderName: "Acme Property Management",
      requestedEndorsements: ["waiver_of_subrogation"],
    });
    const namedInsuredMetadata = resolveCertificateRequestMetadata({
      holderName: "Acme Property Management",
      requestedEndorsements: ["named_insured"],
    });
    const certificates = readFileSync(join(ROOT, "convex/certificates.ts"), "utf-8");

    expect(waiverMetadata).toMatchObject({
      evidenceGatedOnly: true,
      requestSignature: "holder:acme property management|waiver_of_subrogation",
    });
    expect(namedInsuredMetadata).toMatchObject({
      evidenceGatedOnly: false,
    });
    expect(certificates).toContain("else if (evidenceGatedOnly)");
    expect(certificates).toContain("evaluateCertificateRequestGateWithLlm");
    expect(certificates).toContain("unsupportedEndorsementGate(requiredChanges)");
    expect(certificates).not.toContain("createFromChatInternal");
    expect(certificates).toContain("buildEndorsementRequestEmail");
    expect(certificates).toContain("findIssuedCertificateHolderCandidatesInternal");
    expect(certificates).toContain("args.forceReissue");
    expect(readFileSync(join(ROOT, "convex/actions/generateCoi.ts"), "utf-8")).toContain(
      "applyEndorsementsToCertificateData",
    );
  });

  it("routes same-holder reuse and explicit reissue through the lifecycle resolver", () => {
    const certificates = readFileSync(join(ROOT, "convex/certificates.ts"), "utf-8");
    const lifecycle = readFileSync(join(ROOT, "convex/certificateLifecycle.ts"), "utf-8");
    const ui = readFileSync(
      join(ROOT, "components/certificates/certificate-workspace.tsx"),
      "utf-8",
    );
    const policyPage = readFileSync(
      join(ROOT, "app/policies/[id]/policy-detail-body.tsx"),
      "utf-8",
    );

    expect(certificates).toContain("resolveDeterministicCertificateHolder");
    expect(certificates).toContain("matchedIssuedCandidate && !args.forceReissue");
    expect(certificates).toContain("matchedIssuedCandidate?.data.policyCertificateId");
    expect(certificates).toContain("status: \"ambiguous_certificate_holder\"");
    expect(lifecycle).toContain("cleanupDuplicatePolicyCertificatesForOperator");
    expect(lifecycle).toContain("dryRun = args.dryRun ?? true");
    expect(ui).toContain("Reissue");
    expect(policyPage).toContain("forceReissue: true");
  });
});

describe("removed program-admin surfaces", () => {
  it("does not leave program-admin app routes or artifacts on disk", () => {
    const removedPaths = [
      "app/partner",
      "app/operator/mgas",
      "app/onboarding/program-admin",
      "app/signup/program-admin",
      "components/agent-thread/artifacts/certificate-program-selection.tsx",
      "convex/partnerPrograms.ts",
      "convex/lib/certificateProgramSelection.ts",
      "convex/lib/coiTemplateOverlay.ts",
      "tests/program-admin-authority.test.ts",
    ];

    for (const removedPath of removedPaths) {
      expect(existsSync(join(ROOT, removedPath))).toBe(false);
    }
  });

  it("removes active program-admin tables while keeping a cleanup mutation for old data", () => {
    const schema = readFileSync(join(ROOT, "convex/schema.ts"), "utf-8");
    const operator = readFileSync(join(ROOT, "convex/operator.ts"), "utf-8");
    const removedTables = [
      "partnerPrograms",
      "partnerProgramEmbeddings",
      "coiTemplates",
      "standingAuthorizations",
      "certificateRequests",
      "certificateApprovals",
    ];

    for (const table of removedTables) {
      expect(schema).not.toContain(`${table}: defineTable`);
      expect(operator).toContain(table);
    }
    expect(operator).toContain("cleanupRemovedProgramAdminData");
    expect(operator).toContain("isRemovedProgramAdminOrg");
  });

  it("removes program IDs and certificate authority fields from tool-facing schemas", () => {
    const chatTools = readFileSync(join(ROOT, "convex/lib/chatTools.ts"), "utf-8");
    const http = readFileSync(join(ROOT, "convex/http.ts"), "utf-8");
    const notificationTypes = readFileSync(
      join(ROOT, "convex/lib/notificationTypes.ts"),
      "utf-8",
    );
    const forbidden = [
      "partnerProgramId",
      "selectedPartnerProgramId",
      "standingAuthorizationId",
      "authorityType",
      "certificationStatus",
      "pending_approval",
      "needs_program_selection",
    ];

    for (const term of forbidden) {
      expect(chatTools).not.toContain(term);
      expect(http).not.toContain(term);
      expect(notificationTypes).not.toContain(term);
    }
    expect(notificationTypes).not.toContain("program_admin_certificate_request");
    expect(notificationTypes).not.toContain("program_admin_pce_request");
  });
});
