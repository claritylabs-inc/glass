/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { recordOwnComplianceRunInternal } from "./compliance";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const recordOwnComplianceRun = recordOwnComplianceRunInternal as any;
const DAY_MS = 24 * 60 * 60 * 1000;

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", { email: "owner@acme.test" });
    const requirementId = await ctx.db.insert("insuranceRequirements", {
      orgId,
      kind: "coverage",
      scope: "own_org",
      title: "General liability",
      requirementText: "$1M per occurrence",
      lineOfBusiness: "CGL",
      limits: [{ kind: "per_occurrence", amount: 1_000_000 }],
      status: "active",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { orgId, requirementId };
  });
  return { t, ...ids };
}

function gapCheck(requirementId: Id<"insuranceRequirements">) {
  return {
    requirementId,
    requirementTitle: "General liability",
    status: "not_met" as const,
    reasons: ["no_matching_policy"],
    matchedPolicyIds: [],
    notes: "No active policy appears to match this coverage requirement.",
  };
}

describe("own insurance compliance monitor", () => {
  test("alerts on a new gap and waits seven days before reminding", async () => {
    const { t, orgId, requirementId } = await seed();
    const now = 1_000_000_000_000;

    const first = await t.mutation(recordOwnComplianceRun, {
      orgId,
      checks: [gapCheck(requirementId)],
      nowMs: now,
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe("own_compliance_gap");

    const nextDay = await t.mutation(recordOwnComplianceRun, {
      orgId,
      checks: [gapCheck(requirementId)],
      nowMs: now + DAY_MS,
    });
    expect(nextDay).toEqual([]);

    const reminder = await t.mutation(recordOwnComplianceRun, {
      orgId,
      checks: [gapCheck(requirementId)],
      nowMs: now + 7 * DAY_MS,
    });
    expect(reminder).toHaveLength(1);

    const snapshots = await t.run((ctx) =>
      ctx.db
        .query("complianceChecks")
        .withIndex("by_requirementId_subjectOrgId", (query) =>
          query
            .eq("requirementId", requirementId)
            .eq("subjectOrgId", orgId),
        )
        .collect(),
    );
    expect(snapshots.map((snapshot) => snapshot.alertedAt)).toEqual([
      now,
      now + 7 * DAY_MS,
    ]);
  });

  test("emits a resolution only after all current gaps are met", async () => {
    const { t, orgId, requirementId } = await seed();
    const now = 1_000_000_000_000;
    await t.mutation(recordOwnComplianceRun, {
      orgId,
      checks: [gapCheck(requirementId)],
      nowMs: now,
    });

    const resolved = await t.mutation(recordOwnComplianceRun, {
      orgId,
      checks: [{
        requirementId,
        requirementTitle: "General liability",
        status: "met",
        reasons: [],
        matchedPolicyIds: [],
      }],
      nowMs: now + DAY_MS,
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      type: "own_compliance_resolved",
      severity: "info",
      issueLines: ["General liability"],
    });
  });
});
