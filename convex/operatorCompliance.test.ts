/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  archiveRequirement,
  createRequirementSourceDocumentInternal,
  listRequirements,
  upsertRequirement,
} from "./compliance";

const modules = import.meta.glob("./**/*.ts");
const archiveRequirementFn = archiveRequirement as any;
const createRequirementSourceDocumentFn =
  createRequirementSourceDocumentInternal as any;
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
    const sourceDocumentId = await ctx.db.insert("requirementSourceDocuments", {
      orgId: clientOrgId,
      sourceType: "client_contract",
      title: "Client agreement",
      status: "complete",
      createdByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    return { operatorUserId, clientOrgId, sourceDocumentId };
  });
  return { t, ...ids };
}

describe("operator client compliance management", () => {
  test("keeps ordered certificate-holder contacts on an imported source", async () => {
    const fixture = await seedOperatorComplianceFixture();
    const sourceDocumentId = (await fixture.t
      .withIdentity({ subject: `${fixture.operatorUserId}|session` })
      .mutation(
        createRequirementSourceDocumentFn,
        {
          orgId: fixture.clientOrgId,
          userId: fixture.operatorUserId,
          sourceType: "client_contract",
          title: "Insurance requirements",
          holders: [
            {
              displayName: "Primary Holder",
              contactName: "Primary Contact",
              email: "primary@example.test",
            },
            {
              displayName: "Secondary Holder",
              email: "secondary@example.test",
            },
          ],
        },
      )) as Id<"requirementSourceDocuments">;

    const result = await fixture.t.run(async (ctx) => {
      const source = await ctx.db.get(sourceDocumentId);
      const holders = await Promise.all(
        (source?.certificateHolderIds ?? []).map((id) => ctx.db.get(id)),
      );
      return { source, holders };
    });

    expect(result.source?.certificateHolderIds).toHaveLength(2);
    expect(result.source?.certificateHolderId).toBe(
      result.source?.certificateHolderIds?.[0],
    );
    expect(result.holders).toMatchObject([
      {
        displayName: "Primary Holder",
        contactName: "Primary Contact",
        email: "primary@example.test",
      },
      {
        displayName: "Secondary Holder",
        email: "secondary@example.test",
      },
    ]);
  });

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
      sourceDocumentId: fixture.sourceDocumentId,
      sourceDocumentName: "Untrusted source name",
      sourceType: "manual",
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
      sourceDocumentId: fixture.sourceDocumentId,
    });

    await expect(
      operator.query(listRequirementsFn, {
        orgId: fixture.clientOrgId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: requirementId,
        title: "General liability minimum",
        sourceDocumentId: fixture.sourceDocumentId,
        sourceDocumentName: "Client agreement",
        sourceType: "client_contract",
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
        .withIndex("target_created", (q) =>
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

  test("keeps requirements without a source internal and rejects foreign sources", async () => {
    const fixture = await seedOperatorComplianceFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const foreignSourceId = await fixture.t.run(async (ctx) => {
      const foreignOrgId = await ctx.db.insert("organizations", {
        name: "Other client",
        type: "client",
        operatorStatus: "live",
      });
      return await ctx.db.insert("requirementSourceDocuments", {
        orgId: foreignOrgId,
        sourceType: "client_contract",
        title: "Other client agreement",
        status: "complete",
        createdByUserId: fixture.operatorUserId,
        createdAt: dayjs().valueOf(),
        updatedAt: dayjs().valueOf(),
      });
    });

    const internalRequirementId = (await operator.mutation(upsertRequirementFn, {
      orgId: fixture.clientOrgId,
      kind: "coverage",
      scope: "own_org",
      title: "Internal umbrella minimum",
      requirementText: "$2M umbrella limit",
      lineOfBusiness: "UMBRC",
      limits: [{ kind: "per_occurrence", amount: 2_000_000 }],
    })) as Id<"insuranceRequirements">;

    await expect(
      operator.mutation(upsertRequirementFn, {
        orgId: fixture.clientOrgId,
        kind: "coverage",
        scope: "own_org",
        title: "Foreign source requirement",
        requirementText: "$1M general liability limit",
        lineOfBusiness: "CGL",
        limits: [{ kind: "per_occurrence", amount: 1_000_000 }],
        sourceDocumentId: foreignSourceId,
      }),
    ).rejects.toThrow("Requirement source not found");

    const internalRequirement = await fixture.t.run((ctx) =>
      ctx.db.get(internalRequirementId),
    );
    expect(internalRequirement).toEqual(
      expect.objectContaining({
        sourceType: "manual",
      }),
    );
    expect(internalRequirement?.sourceDocumentId).toBeUndefined();
    expect(internalRequirement?.sourceDocumentName).toBeUndefined();
  });
});
