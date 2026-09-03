/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { stageExtractedDraftsInternal } from "./procurementRequirements";

const modules = import.meta.glob("./**/*.ts");
const stageFn = stageExtractedDraftsInternal as any;

describe("procurement intake draft staging", () => {
  test("reuses an exact active obligation and stores placement facts separately", async () => {
    const t = convexTest(schema, modules);
    const now = dayjs().valueOf();
    const fixture = await t.run(async (ctx) => {
      const operatorUserId = await ctx.db.insert("users", {
        name: "Operator",
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
        name: "Client",
        type: "client",
      });
      const requestId = await ctx.db.insert("procurementRequests", {
        clientOrgId,
        title: "Warehouse",
        narrative: "Place warehouse coverage",
        status: "submitted",
        inboxToken: "intake-stage",
        createdByUserId: operatorUserId,
        updatedByUserId: operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      const requirementId = await ctx.db.insert("insuranceRequirements", {
        orgId: clientOrgId,
        kind: "coverage",
        scope: "own_org",
        title: "General liability",
        requirementText: "Maintain CGL",
        lineOfBusiness: "CGL",
        limits: [{ kind: "each_occurrence", amount: 1_000_000 }],
        provisions: [],
        requiredForms: [],
        status: "active",
        createdByUserId: operatorUserId,
        updatedByUserId: operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
      return { operatorUserId, clientOrgId, requestId, requirementId };
    });

    const proposedRequirement = {
      kind: "coverage",
      scope: "own_org",
      title: "General liability",
      requirementText: "Maintain CGL",
      lineOfBusiness: "CGL",
      limits: [{ kind: "each_occurrence", amount: 1_000_000 }],
      provisions: [],
      requiredForms: [],
    };
    await t.mutation(stageFn, {
      requestId: fixture.requestId,
      operatorUserId: fixture.operatorUserId,
      requirements: [{ proposedRequirement, sourceExcerpt: "CGL $1m" }],
      specifications: [
        {
          key: "square_feet",
          label: "Square feet",
          value: "18,000",
          sourceExcerpt: "18,000 square foot warehouse",
        },
      ],
    });

    const stored = await t.run(async (ctx) => ({
      drafts: await ctx.db.query("procurementRequirementDrafts").collect(),
      specifications: await ctx.db.query("procurementSpecifications").collect(),
      request: await ctx.db.get(fixture.requestId),
    }));
    expect(stored.drafts).toHaveLength(1);
    expect(stored.drafts[0].matchingRequirementId).toBe(fixture.requirementId);
    expect(stored.specifications).toEqual([
      expect.objectContaining({ key: "square_feet", value: "18,000" }),
    ]);
    expect(stored.request?.specificationRevision).toBe(1);

    await t.mutation(stageFn, {
      requestId: fixture.requestId,
      operatorUserId: fixture.operatorUserId,
      requirements: [
        { proposedRequirement, sourceExcerpt: "Same CGL requirement" },
      ],
      specifications: [],
    });
    const drafts = await t.run((ctx) =>
      ctx.db.query("procurementRequirementDrafts").collect(),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sourceExcerpt).toBe("Same CGL requirement");
  });
});
