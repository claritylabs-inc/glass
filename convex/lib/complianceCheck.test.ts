import dayjs from "dayjs";
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
        now: dayjs("2026-07-01").valueOf(),
        expectedInsuredName: "Acme",
      },
    );

    expect(result.status).toBe("met");
    expect(result.matchedPolicyIds).toEqual(["policy1"]);
  });

  it("matches normalized CRIM requirements to legacy CRIME policies", () => {
    const result = assessRequirementCompliance(
      requirement({
        title: "Crime coverage",
        requirementText: "Crime coverage with a $1M limit is required.",
        lineOfBusiness: "CRIM",
        limits: [{ kind: "other", amount: 1_000_000 }],
      }),
      [
        policy({
          linesOfBusiness: ["CGL"],
          coverages: [
            {
              name: "Commercial General Liability",
              lineOfBusiness: "CGL",
              limitAmount: 2_000_000,
            },
            {
              name: "Crime",
              lineOfBusiness: "CRIME",
              limitAmount: 1_000_000,
            },
          ],
        }),
      ],
      {
        now: dayjs("2026-07-01").valueOf(),
        expectedInsuredName: "Acme",
      },
    );

    expect(result.status).toBe("met");
    expect(result.matchedPolicyIds).toEqual(["policy1"]);
    expect(result.matchedPolicy?.coverageName).toBe("Crime");
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
      { now: dayjs("2026-07-01").valueOf() },
    );

    expect(result.status).toBe("not_met");
    expect(result.reasons).toContain("limit_below_required:general_aggregate");
  });

  it("does not treat a generic limit as proof of typed per-claim and aggregate limits", () => {
    const result = assessRequirementCompliance(
      requirement({
        lineOfBusiness: "EO",
        limits: [
          { kind: "per_claim", amount: 2_000_000 },
          { kind: "aggregate", amount: 5_000_000 },
        ],
      }),
      [
        policy({
          linesOfBusiness: ["EO"],
          coverages: [
            {
              name: "Errors and Omissions",
              lineOfBusiness: "EO",
              limit: "$5,000,000",
              limitAmount: 5_000_000,
            },
          ],
        }),
      ],
      { now: dayjs("2026-07-01").valueOf() },
    );

    expect(result.status).toBe("unverified");
    expect(result.reasons).toEqual([
      "limit_unverifiable:per_claim",
      "limit_unverifiable:aggregate",
    ]);
  });

  it("selects a cyber-named OLIB coverage instead of falling back to E&O", () => {
    const result = assessRequirementCompliance(
      requirement({
        title: "Cyber coverage",
        requirementText: "Cyber coverage is required.",
        lineOfBusiness: "CYBER",
        limits: [{ kind: "other", amount: 3_000_000 }],
      }),
      [
        policy({
          linesOfBusiness: ["EO", "CYBER"],
          coverages: [
            {
              name: "Errors and Omissions",
              lineOfBusiness: "EO",
              limitAmount: 5_000_000,
            },
            {
              name: "Network Security & Privacy Liability",
              lineOfBusiness: "OLIB",
              limitAmount: 3_000_000,
            },
          ],
        }),
      ],
      { now: dayjs("2026-07-01").valueOf() },
    );

    expect(result.matchedPolicy?.coverageName).toBe(
      "Network Security & Privacy Liability",
    );
  });

  it("reports missing deductible, coverage form, and retro date as unverified", () => {
    const result = assessRequirementCompliance(
      requirement({
        maxDeductible: { amount: 100_000 },
        coverageForm: "claims_made",
        retroactiveDateOnOrBefore: "2026-03-15",
      }),
      [policy({})],
      { now: dayjs("2026-07-01").valueOf() },
    );

    expect(result.status).toBe("unverified");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "deductible_unverifiable",
      "coverage_form_unverifiable",
      "retroactive_date_unverifiable",
    ]));
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
      now: dayjs("2026-07-01").valueOf(),
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

  it("surfaces the latest persisted agent review", () => {
    const result = assessRequirementCompliance(requirement({ updatedAt: 10 }), [policy({})], {
      now: dayjs("2026-07-01").valueOf(),
      existingChecks: [{
        status: "unverified",
        reasons: ["agent_review"],
        matchedPolicyIds: ["policy1" as Id<"policies">],
        matchedSummary: "The policy does not split per-claim and aggregate limits.",
        checkedAt: 20,
        checkedBy: "agent",
        checkedByUserId: "user1" as Id<"users">,
      }],
    });

    expect(result.status).toBe("unverified");
    expect(result.checkedBy).toBe("agent");
    expect(result.matchedSummary).toContain("does not split");
  });

  it("invalidates a saved review after its matched policy changes", () => {
    const result = assessRequirementCompliance(
      requirement({ updatedAt: 10 }),
      [policy({ extractionDataStageUpdatedAt: 30 })],
      {
        now: dayjs("2026-07-01").valueOf(),
        existingChecks: [{
          status: "not_met",
          reasons: ["agent_review"],
          matchedPolicyIds: ["policy1" as Id<"policies">],
          checkedAt: 20,
          checkedBy: "agent",
          checkedByUserId: "user1" as Id<"users">,
        }],
      },
    );

    expect(result.status).toBe("met");
    expect(result.checkedBy).toBe("system");
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
        now: dayjs("2026-07-01").valueOf(),
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
