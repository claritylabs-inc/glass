import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { assessRequirementCompliance } from "./complianceCheck";

function requirement(
  patch: Partial<Doc<"insuranceRequirements">>,
): Doc<"insuranceRequirements"> {
  return {
    _id: "req1" as Id<"insuranceRequirements">,
    _creationTime: 1,
    orgId: "org1" as Id<"organizations">,
    kind: "coverage",
    scope: "own_org",
    title: "CGL minimum",
    requirementText: "CGL must carry $1M per occurrence.",
    lineOfBusiness: "CGL",
    limits: [{ kind: "per_occurrence", amount: 1_000_000 }],
    status: "active",
    createdByUserId: "user1" as Id<"users">,
    updatedByUserId: "user1" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  } as Doc<"insuranceRequirements">;
}

function policy(patch: Partial<Doc<"policies">>): Doc<"policies"> {
  return {
    _id: "policy1" as Id<"policies">,
    _creationTime: 1,
    userId: "user1" as Id<"users">,
    orgId: "org1" as Id<"organizations">,
    pipelineStatus: "complete",
    extractionDataStage: "final",
    carrier: "Sentinel",
    policyNumber: "GL-1",
    insuredName: "Acme Inc",
    effectiveDate: "2026-01-01",
    expirationDate: "2026-12-31",
    linesOfBusiness: ["CGL"],
    coverages: [
      {
        name: "Commercial General Liability",
        lineOfBusiness: "CGL",
        limits: [
          {
            label: "Each occurrence",
            value: "$1,000,000",
            amount: 1_000_000,
            kind: "per_occurrence",
          },
        ],
      },
    ],
    ...patch,
  } as Doc<"policies">;
}

describe("assessRequirementCompliance", () => {
  it("matches ACORD LOB and structured limit kinds", () => {
    const result = assessRequirementCompliance(
      requirement({}),
      [policy({})],
      {
        now: new Date("2026-07-01").valueOf(),
        expectedInsuredName: "Acme",
      },
    );

    expect(result.status).toBe("met");
    expect(result.matchedPolicyIds).toEqual(["policy1"]);
  });

  it("returns not_met with a reason when the matching limit is too low", () => {
    const result = assessRequirementCompliance(
      requirement({
        limits: [{ kind: "general_aggregate", amount: 2_000_000 }],
      }),
      [
        policy({
          coverages: [
            {
              name: "Commercial General Liability",
              lineOfBusiness: "CGL",
              limits: [
                {
                  label: "General aggregate",
                  value: "$1,000,000",
                  amount: 1_000_000,
                  kind: "general_aggregate",
                },
              ],
            },
          ],
        }),
      ],
      { now: new Date("2026-07-01").valueOf() },
    );

    expect(result.status).toBe("not_met");
    expect(result.reasons).toContain("limit_below_required:general_aggregate");
  });

  it("treats current manual verification as authoritative for non-coverage rules", () => {
    const req = requirement({
      kind: "condition",
      conditionType: "cancellation_notice",
      limits: undefined,
      lineOfBusiness: undefined,
      updatedAt: 10,
    });

    const result = assessRequirementCompliance(req, [], {
      now: new Date("2026-07-01").valueOf(),
      existingChecks: [
        {
          status: "met",
          reasons: [],
          matchedPolicyIds: [],
          matchedSummary: "Verified manually.",
          checkedAt: 20,
          checkedBy: "user",
          checkedByUserId: "user1" as Id<"users">,
          evidence: { note: "Lease file reviewed", validUntil: "2026-12-31" },
        },
      ],
    });

    expect(result.status).toBe("met");
    expect(result.checkedBy).toBe("user");
  });

  it("expires manual verification after validUntil", () => {
    const result = assessRequirementCompliance(
      requirement({
        kind: "insurer",
        limits: undefined,
        lineOfBusiness: undefined,
        minAmBestRating: "A-",
      }),
      [],
      {
        now: new Date("2026-07-01").valueOf(),
        existingChecks: [
          {
            status: "met",
            reasons: [],
            matchedPolicyIds: [],
            checkedAt: 20,
            checkedBy: "user",
            evidence: { validUntil: "2026-01-01" },
          },
        ],
      },
    );

    expect(result.status).toBe("unverified");
  });
});
