import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";

import {
  FEATURE_FLAGS,
  betaFeatureFlagsForOrgType,
  featureFlagAllowedForOrgType,
  isFeatureEnabled,
} from "../convex/lib/featureFlags";

const source = (path: string) => readFileSync(join(__dirname, "..", path), "utf-8");

describe("coverage recovery integration", () => {
  test("is a default-off client-owned beta flag", () => {
    expect(FEATURE_FLAGS.coverage_recovery_v2).toMatchObject({
      defaultEnabled: false,
      allowedOrgTypes: ["client"],
      beta: true,
    });
    expect(featureFlagAllowedForOrgType("coverage_recovery_v2", "client")).toBe(true);
    expect(featureFlagAllowedForOrgType("coverage_recovery_v2", "broker")).toBe(false);
    expect(betaFeatureFlagsForOrgType("client").map((flag) => flag.id)).toContain(
      "coverage_recovery_v2",
    );
    expect(betaFeatureFlagsForOrgType("broker").map((flag) => flag.id)).not.toContain(
      "coverage_recovery_v2",
    );
    expect(isFeatureEnabled({ type: "client" }, "coverage_recovery_v2")).toBe(false);
    expect(isFeatureEnabled({ type: "broker", featureFlags: { coverage_recovery_v2: true } }, "coverage_recovery_v2")).toBe(false);
  });

  test("uses the client settings and operator client-management owners", () => {
    const betaSettings = source("components/settings/beta-features-section.tsx");
    const operatorClients = source("app/operator/clients/page.tsx");
    const orgs = source("convex/orgs.ts");

    expect(betaSettings).toContain("betaFeatureFlagsForOrgType(getFeatureFlagOrgType(org))");
    expect(betaSettings).toContain("api.orgs.setFeatureFlag");
    expect(operatorClients).toContain('betaFeatureFlagsForOrgType("client")');
    expect(operatorClients).toContain("api.operator.setClientFeatureFlag");
    expect(orgs).toContain('v.literal("coverage_recovery_v2")');
    expect(orgs).toContain("assertFeatureFlagAllowedForOrg(args.flagId, org)");
  });

  test("snapshots the owning policy org and preserves it across a resume", () => {
    const extraction = source("convex/actions/policyExtraction.ts");
    const worker = source("extraction-worker/src/index.ts");

    expect(extraction).toContain("coverageRecoverySnapshot(ctx, orgId)");
    expect(extraction).toContain("coverageRecoverySnapshot(ctx, policy.orgId as Id<\"organizations\">)");
    expect(extraction).toContain('mode === "resume" && existingState?.coverageRecovery');
    expect(extraction).toContain("coverageRecovery: state.coverageRecovery ?? { enabled: false }");
    expect(worker).toContain("coverageRecovery: job.state.coverageRecovery ?? { enabled: false }");
  });

  test("uses deterministic recovery unless the versioned SDK pass succeeds", () => {
    const extraction = source("convex/actions/policyExtraction.ts");
    const postProcess = source("convex/lib/extractionPostProcess.ts");

    expect(extraction).toContain('value.version === "coverage-recovery-v2"');
    expect(extraction).toContain('value.status === "succeeded"');
    expect(extraction).toContain("skipDeterministicCoverageRecovery: coverageRecoverySucceeded");
    expect(postProcess).toContain("options.skipDeterministicCoverageRecovery");
    expect(postProcess).toContain(": applyCoverageDeclarationScoping({");
  });

  test("runs forced operator backfill against stored evidence without a PDF parser", () => {
    const extraction = source("convex/actions/policyExtraction.ts");
    const operator = source("convex/operator.ts");
    const start = extraction.indexOf("export const backfillStoredCoverageRecovery");
    const end = extraction.indexOf("// ─── Entry point: start from upload", start);
    const backfill = extraction.slice(start, end);

    expect(backfill).toContain("sourceSpans.listSpansByPolicyInternal");
    expect(backfill).toContain("sourceNodes.listByPolicyInternal");
    expect(backfill).toContain("runCoverageRecovery({");
    expect(backfill).toContain("args.force === true");
    expect(backfill).not.toContain("preparePdfTextWithParserFallback");
    expect(backfill).not.toContain("extract(");
    expect(operator).toContain("export const backfillCoverageRecovery = action");
    expect(operator).toContain("backfillStoredCoverageRecovery");
  });
});
