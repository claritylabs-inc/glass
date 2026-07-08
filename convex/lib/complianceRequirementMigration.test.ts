import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  migrateLegacyComplianceRequirement,
  requirementNeedsLegacyShapeBackfill,
} from "./complianceRequirementMigration";

const baseLegacy = {
  orgId: "org1" as Id<"organizations">,
  createdByUserId: "user1" as Id<"users">,
  updatedByUserId: "user1" as Id<"users">,
  createdAt: 1,
  updatedAt: 2,
  status: "active" as const,
  sourceType: "vendor_requirements" as const,
};

describe("compliance requirement shape migration", () => {
  it("maps legacy coverage rows to redesigned coverage requirements", () => {
    const migrated = migrateLegacyComplianceRequirement({
      ...baseLegacy,
      title: "Commercial General Liability",
      category: "general_liability",
      appliesTo: "own_org",
      evaluationTarget: "own_policy",
      limit: "$1M per occurrence",
      limitAmount: 1_000_000,
      limitType: "per occurrence",
      requirementText:
        "CGL must include additional insured, primary and non-contributory, and waiver of subrogation.",
    });

    expect(migrated.kind).toBe("coverage");
    expect(migrated.scope).toBe("own_org");
    expect(migrated.lineOfBusiness).toBe("CGL");
    expect(migrated.limits).toEqual([
      {
        kind: "per_occurrence",
        amount: 1_000_000,
        label: "$1M per occurrence",
      },
    ]);
    expect(migrated.provisions).toEqual([
      "additional_insured",
      "waiver_of_subrogation",
      "primary_non_contributory",
    ]);
  });

  it("maps legacy manual-control rows to condition requirements", () => {
    const migrated = migrateLegacyComplianceRequirement({
      ...baseLegacy,
      title: "Cancellation Notice",
      category: "other",
      appliesTo: "own_org",
      evaluationTarget: "manual_control",
      requirementText: "Provide 30 days written notice of cancellation.",
    });

    expect(migrated.kind).toBe("condition");
    expect(migrated.scope).toBe("own_org");
    expect(migrated.conditionType).toBe("cancellation_notice");
    expect(migrated.noticeDays).toBe(30);
  });

  it("does not backfill rows that already have redesigned discriminators", () => {
    expect(
      requirementNeedsLegacyShapeBackfill({
        kind: "coverage",
        scope: "vendors",
      }),
    ).toBe(false);
  });
});
