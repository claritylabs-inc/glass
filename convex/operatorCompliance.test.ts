/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  archiveRequirement,
  listRequirements,
  upsertRequirement,
} from "./compliance";

const modules = import.meta.glob("./**/*.ts");
const archiveRequirementFn = archiveRequirement as any;
const listRequirementsFn = listRequirements as any;
const upsertRequirementFn = upsertRequirement as any;

async function seedOperatorComplianceFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Compliance Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Managed Client",
      type: "client",
      operatorStatus: "live",
    });
    return { operatorUserId, clientOrgId };
  });
  return { t, ...ids };
}

describe("operator client compliance management", () => {
  test("lists, adds, edits, archives, and audits client requirements", async () => {
    const fixture = await seedOperatorComplianceFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });

    await expect(
      operator.query(listRequirementsFn, {
        orgId: fixture.clientOrgId,
      }),
    ).resolves.toEqual([]);

    const requirementId = (await operator.mutation(upsertRequirementFn, {
      orgId: fixture.clientOrgId,
      kind: "coverage",
      scope: "own_org",
      title: "General liability",
      requirementText: "$1M per occurrence",
      lineOfBusiness: "CGL",
      limits: [{ kind: "per_occurrence", amount: 1_000_000 }],
    })) as Id<"insuranceRequirements">;

    await operator.mutation(upsertRequirementFn, {
      orgId: fixture.clientOrgId,
      requirementId,
      kind: "coverage",
      scope: "own_org",
      title: "General liability minimum",
      requirementText: "$2M per occurrence",
      lineOfBusiness: "CGL",
      limits: [{ kind: "per_occurrence", amount: 2_000_000 }],
    });

    await expect(
      operator.query(listRequirementsFn, {
        orgId: fixture.clientOrgId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: requirementId,
        title: "General liability minimum",
      }),
    ]);

    await operator.mutation(archiveRequirementFn, {
      orgId: fixture.clientOrgId,
      requirementId,
    });

    const result = await fixture.t.run(async (ctx) => ({
      requirement: await ctx.db.get(requirementId),
      audits: await ctx.db
        .query("operatorAuditEvents")
        .withIndex("by_targetOrgId_createdAt", (q) =>
          q.eq("targetOrgId", fixture.clientOrgId),
        )
        .collect(),
    }));

    expect(result.requirement?.status).toBe("archived");
    expect(result.audits).toHaveLength(3);
    expect(result.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "setup_write",
          metadata: expect.objectContaining({
            domain: "compliance",
            requirementId,
          }),
        }),
      ]),
    );
  });
});
