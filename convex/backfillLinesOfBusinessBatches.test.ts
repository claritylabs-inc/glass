/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  backfillDeliveryRulesBatchInternal,
  backfillPoliciesBatchInternal,
  policyLineBackfillDecision,
} from "./backfillLinesOfBusinessBatches";

const modules = import.meta.glob("./**/*.ts");
const backfillPoliciesBatchInternalFn = backfillPoliciesBatchInternal as any;
const backfillDeliveryRulesBatchInternalFn = backfillDeliveryRulesBatchInternal as any;

describe("backfillLinesOfBusinessBatches", () => {
  test("plans legacy policy migrations without mutating rows", () => {
    expect(policyLineBackfillDecision({
      policyTypes: ["professional_liability", "cyber"],
    })).toEqual({
      before: ["professional_liability", "cyber"],
      after: ["EO", "OLIB"],
      unmappedValues: [],
      changed: true,
    });
    expect(policyLineBackfillDecision({
      linesOfBusiness: ["CGL"],
      policyTypes: ["general_liability"],
    })).toEqual({
      before: ["general_liability"],
      after: ["CGL"],
      unmappedValues: [],
      changed: false,
    });
    expect(policyLineBackfillDecision({
      policyTypes: ["bespoke_line"],
    })).toEqual({
      before: ["bespoke_line"],
      after: ["UN"],
      unmappedValues: ["bespoke_line"],
      changed: true,
    });
  });

  test("does not patch policy rows that already carry matching ACORD lines", async () => {
    const t = convexTest(schema, modules);
    const { migratedPolicyId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const basePolicy = {
        orgId,
        carrier: "Carrier",
        documentType: "policy" as const,
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      };
      const migratedPolicyId = await ctx.db.insert("policies", {
        ...basePolicy,
        policyNumber: "POL-MIGRATED",
        linesOfBusiness: ["CGL"],
        policyTypes: ["general_liability"],
      });
      return { migratedPolicyId };
    });

    const dryRun = await t.mutation(backfillPoliciesBatchInternalFn, {
      dryRun: true,
      limit: 200,
    });

    expect(dryRun).toMatchObject({
      dryRun: true,
      policies: {
        scannedCount: 1,
        changedCount: 0,
        unmappedValues: {},
      },
    });

    const live = await t.mutation(backfillPoliciesBatchInternalFn, {
      dryRun: false,
      limit: 200,
    });

    expect(live.policies.changedCount).toBe(0);
    await expect(t.run(async (ctx) => ctx.db.get(migratedPolicyId))).resolves.toMatchObject({
      linesOfBusiness: ["CGL"],
    });
  });

  test("backfills delivery-rule filters while preserving free-text product lines", async () => {
    const t = convexTest(schema, modules);
    const { legacyRuleId, migratedRuleId } = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
      });
      const now = 1;
      const legacyRuleId = await ctx.db.insert("policyDeliveryRules", {
        brokerOrgId,
        name: "Legacy",
        enabled: true,
        priority: 1,
        filters: {
          productLines: ["Technology E&O"],
          policyTypes: ["general_liability"],
        },
        action: "broker_review",
        createdAt: now,
        updatedAt: now,
      });
      const migratedRuleId = await ctx.db.insert("policyDeliveryRules", {
        brokerOrgId,
        name: "Migrated",
        enabled: true,
        priority: 2,
        filters: {
          linesOfBusiness: ["CGL"],
          productLines: ["General liability"],
        },
        action: "auto_send",
        channels: ["email"],
        createdAt: now,
        updatedAt: now,
      });
      return { legacyRuleId, migratedRuleId };
    });

    const live = await t.mutation(backfillDeliveryRulesBatchInternalFn, {
      dryRun: false,
      limit: 200,
    });

    expect(live.deliveryRules.changedCount).toBe(1);
    await expect(t.run(async (ctx) => ctx.db.get(legacyRuleId))).resolves.toMatchObject({
      filters: {
        linesOfBusiness: ["Technology E&O", "general_liability"],
        productLines: ["Technology E&O"],
        policyTypes: ["general_liability"],
      },
    });
    await expect(t.run(async (ctx) => ctx.db.get(migratedRuleId))).resolves.toMatchObject({
      filters: {
        linesOfBusiness: ["CGL"],
        productLines: ["General liability"],
      },
    });
  });
});
