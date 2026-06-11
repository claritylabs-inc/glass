import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("policy preview extraction", () => {
  it("stores preview state on policies and uses a separate preview queue", () => {
    const schema = read("convex/schema.ts");
    const policiesTable = schema.slice(
      schema.indexOf("policies: defineTable"),
      schema.indexOf("policyQuestions: defineTable"),
    );

    expect(policiesTable).toContain("extractionDataStage");
    expect(policiesTable).toContain("extractionPreviewVersion");
    expect(schema).toContain("policyExtractionPreviewQueue: defineTable");
    expect(schema).toContain("extraction_preview: v.optional(modelRouteValidator)");
  });

  it("routes preview extraction through the low-cost model path without fallback escalation", () => {
    const worker = read("extraction-worker/src/index.ts");
    const modelCatalog = read("convex/lib/modelCatalog.ts");

    expect(modelCatalog).toContain('extraction_preview: { model: "gpt-5.4-nano", provider: "openai" }');
    expect(worker).toContain('type ModelTask = "extraction" | "extraction_preview" | "classification"');
    expect(worker).toContain("POLICY_PREVIEW_VERSION");
    expect(worker).toContain("claimExternalPreviewJob");
    expect(worker).toContain('if (task === "extraction_preview") return null');
  });

  it("keeps the preview structured-output schema strict and nullable", () => {
    const worker = read("extraction-worker/src/index.ts");

    expect(worker).toContain("const PREVIEW_TOP_LEVEL_FIELDS");
    expect(worker).toContain("required: [...PREVIEW_TOP_LEVEL_FIELDS]");
    expect(worker).toContain("required: [...PREVIEW_LIMIT_FIELDS]");
    expect(worker).toContain("required: [...PREVIEW_DEDUCTIBLE_FIELDS]");
    expect(worker).toContain("required: [...PREVIEW_COVERAGE_FIELDS]");
    expect(worker).not.toContain('required: ["name"]');
  });

  it("makes low-risk read surfaces preview-aware", () => {
    for (const path of [
      "convex/lib/agentToolExecutors.ts",
      "convex/lib/policyToolResolution.ts",
      "convex/actions/processThreadChat.ts",
      "convex/actions/handleInboundEmail.ts",
      "convex/actions/handleInboundImessage.ts",
      "convex/actions/mcpChat.ts",
      "convex/http.ts",
      "convex/lib/vendorComplianceTools.ts",
    ]) {
      expect(read(path)).toContain("listAllPreviewReadableInternal");
    }
    expect(read("convex/compliance.ts")).toContain("includePreviewPolicies");
    expect(read("convex/actions/vendorComplianceMonitor.ts")).toContain("includePreviewPolicies: false");
  });

  it("keeps high-impact policy actions final-only", () => {
    const agentTools = read("convex/lib/agentToolExecutors.ts");
    const certificates = read("convex/certificates.ts");
    const policyChanges = read("convex/policyChanges.ts");
    const emailDrafts = read("convex/actions/emailDrafts.ts");
    const policies = read("convex/policies.ts");

    expect(agentTools).toContain("resolveFinalReadablePolicy");
    expect(agentTools).toContain("resolveFinalWritablePolicy");
    expect(certificates).toContain('status: "extraction_in_progress"');
    expect(policyChanges).toContain("assertPolicyReadyForChange");
    expect(emailDrafts).toContain("assertPolicyReadyForDelivery");
    expect(policies).toContain("Policy facts can be confirmed after full source-backed extraction finishes.");
  });

  it("clears stale preview errors when full extraction becomes final", () => {
    const policies = read("convex/policies.ts");

    expect(policies).toContain('fields.extractionDataStage === "final"');
    expect(policies).toContain("fields.extractionPreviewError = undefined");
    expect(policies).toContain('status === "complete" ? { extractionPreviewError: undefined } : {}');
  });

  it("keeps placeholder uploads hidden until preview, final, or error", () => {
    const policies = read("convex/policies.ts");

    expect(policies).toContain("function isVisiblePolicyListRow");
    expect(policies).toContain("if (isPreviewReadablePolicy(policy)) return true");
    expect(policies).toContain('if (policy.pipelineStatus === "error") return true');
    expect(policies).toContain("isVisiblePolicyListRow(p) &&");
  });

  it("uses extraction toasts instead of inline placeholder rows", () => {
    const extractionToast = read("components/shared/extraction-banner.tsx");
    const policyList = read("app/policies/page.tsx");
    const brokerPolicyList = read("app/clients/[clientOrgId]/policies/page.tsx");
    const detailsTab = read("app/policies/[id]/policy-details-tab.tsx");
    const detailBody = read("app/policies/[id]/policy-detail-body.tsx");

    expect(extractionToast).toContain("showPolicyExtractionQueuedToast");
    expect(extractionToast).toContain("showPolicyExtractionReadyToast");
    expect(extractionToast).not.toContain("StatusBanner");
    expect(policyList).toContain("pendingExtractionToasts");
    expect(policyList).toContain("showPolicyExtractionQueuedToast");
    expect(policyList).not.toContain('carrier: "Extracting..."');
    expect(brokerPolicyList).toContain("pendingExtractionToasts");
    expect(brokerPolicyList).toContain("showPolicyExtractionReadyToast");
    expect(brokerPolicyList).not.toContain("upsertBrokerPolicies");
    expect(detailsTab).not.toContain("PolicyExtractionBanner");
    expect(detailBody).toContain("<PolicyExtractionBanner");
  });
});
