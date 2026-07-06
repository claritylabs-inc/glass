import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("requirement semantics surfaces", () => {
  it("renders evidence-target badges and only checks own-policy rows", () => {
    const page = read("components/compliance-page.tsx");

    expect(page).toContain("EvaluationTargetBadge");
    expect(page).toContain("requirementEvaluationTargetLabel");
    expect(page).toContain('semantics.evaluationTarget === "own_policy"');
    expect(page).toContain("Check compliance");
  });

  it("keeps my requirements first and gates Connect-only surfaces", () => {
    const page = read("components/compliance-page.tsx");
    const sidebar = read("components/app-sidebar.tsx");
    const settingsPage = read("app/settings/page.tsx");
    const betaFeatures = read("components/settings/beta-features-section.tsx");
    const featureFlags = read("convex/lib/featureFlags.ts");
    const schema = read("convex/schema.ts");

    expect(page).toContain('useState<RequirementScope>("own_org")');
    expect(page.indexOf('TabsTrigger value="own_org"')).toBeLessThan(
      page.indexOf('TabsTrigger value="vendors"'),
    );
    expect(page).toContain("showConnectFeatures && !isPureVendorAccount");
    expect(sidebar).toContain("showConnectFeatures");
    expect(sidebar).toContain("isBroker || !showConnectFeatures");
    expect(settingsPage).toContain("BetaFeaturesSection");
    expect(betaFeatures).toContain("FeatureFlagToggleRow");
    expect(betaFeatures).toContain("betaFeatureFlagsForOrgType");
    expect(featureFlags).toContain("connect_features");
    expect(featureFlags).toContain('label: "Connect features"');
    expect(schema).toContain("featureFlags: v.optional(v.record(v.string(), v.boolean()))");
  });

  it("exposes evaluation target in agent requirement context and lookup tools", () => {
    const complianceAgent = read("convex/lib/complianceAgent.ts");
    const chatTools = read("convex/lib/chatTools.ts");
    const executors = read("convex/lib/agentToolExecutors.ts");
    const processThreadChat = read("convex/actions/processThreadChat.ts");

    expect(complianceAgent).toContain("obligationOwner");
    expect(complianceAgent).toContain("evaluationTarget");
    expect(complianceAgent).toContain("subcontractor_policy rows");
    expect(chatTools).toContain("REQUIREMENT_EVALUATION_TARGET_FILTER_VALUES");
    expect(chatTools).toContain("Filter by evidence target");
    expect(executors).toContain("evaluationTarget?: RequirementEvaluationTarget");
    expect(processThreadChat).toContain("evaluationTarget:${semantics.evaluationTarget}");
  });

  it("keeps REST and MCP creation backward-compatible with optional evaluation target", () => {
    const http = read("convex/http.ts");
    const mcpClient = read("mcp-server/src/tools/client.ts");

    expect(http).toContain("evaluation_target");
    expect(http).toContain('appliesTo: "vendors"');
    expect(mcpClient).toContain("evaluationTarget");
    expect(mcpClient).toContain("evaluation_target: evaluationTarget");
  });
});
