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
      linesOfBusiness: ["EO", "OLIB"],
    })).toEqual({
      before: [],
      after: ["EO", "OLIB"],
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

  test("leaves delivery-rule filters with canonical lines untouched", async () => {
    const t = convexTest(schema, modules);
    const { migratedRuleId } = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
      });
      const now = 1;
      const migratedRuleId = await ctx.db.insert("policyDeliveryRules", {
        brokerOrgId,
        name: "Migrated",
        enabled: true,
        priority: 2,
        filters: {
          linesOfBusiness: ["CGL"],
        },
        action: "auto_send",
        channels: ["email"],
        createdAt: now,
        updatedAt: now,
      });
      return { migratedRuleId };
    });

    const live = await t.mutation(backfillDeliveryRulesBatchInternalFn, {
      dryRun: false,
      limit: 200,
    });

    expect(live.deliveryRules.changedCount).toBe(0);
    await expect(t.run(async (ctx) => ctx.db.get(migratedRuleId))).resolves.toMatchObject({
      filters: {
        linesOfBusiness: ["CGL"],
      },
    });
  });
});
