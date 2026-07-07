/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  cleanupDeliveryRulesBatchInternal,
  cleanupPoliciesBatchInternal,
} from "./cleanupLegacyLineOfBusinessFieldsBatches";

const modules = import.meta.glob("./**/*.ts");
const cleanupPoliciesBatchInternalFn = cleanupPoliciesBatchInternal as any;
const cleanupDeliveryRulesBatchInternalFn = cleanupDeliveryRulesBatchInternal as any;

describe("cleanupLegacyLineOfBusinessFieldsBatches", () => {
  test("leaves canonical policy rows untouched", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      });
    });

    const dryRun = await t.mutation(cleanupPoliciesBatchInternalFn, {
      dryRun: true,
      limit: 200,
    });
    expect(dryRun.policies.changedCount).toBe(0);
    await expect(t.run(async (ctx) => ctx.db.get(policyId))).resolves.toMatchObject({
      linesOfBusiness: ["CGL"],
    });

    const live = await t.mutation(cleanupPoliciesBatchInternalFn, {
      dryRun: false,
      limit: 200,
    });
    expect(live.policies.changedCount).toBe(0);
    await expect(t.run(async (ctx) => ctx.db.get(policyId))).resolves.toMatchObject({
      linesOfBusiness: ["CGL"],
    });
  });

  test("leaves canonical delivery-rule filters untouched", async () => {
    const t = convexTest(schema, modules);
    const ruleId = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Broker",
        type: "broker",
      });
      return await ctx.db.insert("policyDeliveryRules", {
        brokerOrgId,
        name: "Legacy",
        enabled: true,
        priority: 1,
        filters: {
          linesOfBusiness: ["CGL"],
        },
        action: "broker_review",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const live = await t.mutation(cleanupDeliveryRulesBatchInternalFn, {
      dryRun: false,
      limit: 200,
    });
    expect(live.deliveryRules.changedCount).toBe(0);
    await expect(t.run(async (ctx) => ctx.db.get(ruleId))).resolves.toMatchObject({
      filters: {
        linesOfBusiness: ["CGL"],
      },
    });
  });
});
