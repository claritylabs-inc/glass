/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { resolvePolicyPartyContext } from "./lib/policyPartyContext";
import { updatePolicyDetails } from "./policies";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const updatePolicyDetailsFn = updatePolicyDetails as any;

describe("broker policy detail editing", () => {
  test("persists typed card overrides separately from extracted policy parties", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Montgomery Risk",
        type: "broker",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
        brokerOrgId,
      });
      const brokerUserId = await ctx.db.insert("users", {
        email: "broker@example.com",
      });
      const clientUserId = await ctx.db.insert("users", {
        email: "client@example.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: brokerUserId,
        role: "admin",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: clientUserId,
        role: "admin",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId: clientOrgId,
        carrier: "Extracted Carrier",
        policyNumber: "OLD-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Extracted Insured",
        operationalProfile: {
          operationsDescription: { value: "Extracted operations" },
          parties: [
            {
              role: "named_insured",
              name: "Extracted Insured",
              address: { street1: "Old insured address" },
              sourceNodeIds: ["insured-source"],
              sourceSpanIds: [],
            },
            {
              role: "producer",
              name: "Extracted Broker",
              address: { street1: "Old broker address" },
              sourceNodeIds: ["producer-source"],
              sourceSpanIds: [],
            },
          ],
        },
      });
      return { brokerUserId, clientUserId, policyId };
    });

    const broker = t.withIdentity({
      subject: `${ids.brokerUserId}|session`,
    });
    await broker.mutation(updatePolicyDetailsFn, {
      id: ids.policyId,
      update: {
        section: "overview",
        policyNumber: "POL-2027",
        effectiveDate: "2027-03-08",
        expirationDate: "2028-03-08",
        premium: "5166.32",
        operationsDescription: "Edited delivery operations",
      },
    });
    await broker.mutation(updatePolicyDetailsFn, {
      id: ids.policyId,
      update: {
        section: "insured",
        name: "Edited Insured",
        address: {
          street1: "100 Main Street",
          city: "Los Angeles",
          state: "CA",
          zip: "90001",
          country: "US",
        },
        additionalNamedInsureds: ["Subsidiary One", "  Subsidiary Two  "],
      },
    });
    await broker.mutation(updatePolicyDetailsFn, {
      id: ids.policyId,
      update: {
        section: "producer",
        name: "Edited Producer",
        contactName: "Pat Producer",
        licenseNumber: "PR-123",
        phone: "+12025550100",
        email: "pat@example.com",
        address: { street1: "200 Broker Street" },
      },
    });
    await broker.mutation(updatePolicyDetailsFn, {
      id: ids.policyId,
      update: {
        section: "insurer",
        name: "Edited Insurer",
        naicNumber: "16823",
        address: { street1: "300 Carrier Avenue" },
      },
    });
    await broker.mutation(updatePolicyDetailsFn, {
      id: ids.policyId,
      update: {
        section: "generalAgent",
        name: "Edited General Agent",
        licenseNumber: "21058436",
        address: { street1: "400 General Agent Road" },
      },
    });

    const stored = await t.run(async (ctx) => {
      const policy = await ctx.db.get(ids.policyId);
      const audits = await ctx.db
        .query("policyAuditLog")
        .withIndex("by_policyId", (query) => query.eq("policyId", ids.policyId))
        .collect();
      return { policy, audits };
    });
    expect(stored.policy).toMatchObject({
      policyNumber: "POL-2027",
      effectiveDate: "03/08/2027",
      expirationDate: "03/08/2028",
      premium: "$5,166.32",
      premiumAmount: 5166.32,
      policyDetailOverrides: {
        operationsDescription: "Edited delivery operations",
        insured: {
          name: "Edited Insured",
          additionalNamedInsureds: ["Subsidiary One", "Subsidiary Two"],
        },
        producer: {
          name: "Edited Producer",
          contactName: "Pat Producer",
          licenseNumber: "PR-123",
          phone: "+12025550100",
          email: "pat@example.com",
        },
        insurer: { name: "Edited Insurer", naicNumber: "16823" },
        generalAgent: {
          name: "Edited General Agent",
          licenseNumber: "21058436",
        },
      },
      policyDetailOverridesUpdatedByUserId: ids.brokerUserId,
    });
    expect(stored.audits).toHaveLength(5);
    expect(stored.audits.every((audit) => audit.action === "manual_policy_update"))
      .toBe(true);

    const context = resolvePolicyPartyContext(stored.policy ?? {});
    expect(context).toMatchObject({
      insuredName: "Edited Insured",
      producerName: "Edited Producer",
      producerLicenseNumber: "PR-123",
      insurerName: "Edited Insurer",
      insurerNaicNumber: "16823",
      generalAgentName: "Edited General Agent",
      generalAgentLicenseNumber: "21058436",
      operationsDescription: "Edited delivery operations",
    });
    expect(JSON.stringify(context.parties)).not.toContain("insured-source");

    await broker.mutation(updatePolicyDetailsFn, {
      id: ids.policyId,
      update: {
        section: "overview",
        policyNumber: "POL-2027",
        effectiveDate: "03/08/2027",
        expirationDate: "03/08/2028",
        premium: "",
        operationsDescription: "Edited delivery operations",
      },
    });
    const clearedPremium = await t.run((ctx) => ctx.db.get(ids.policyId));
    expect(clearedPremium?.premium).toBe("");
    expect(clearedPremium?.premiumAmount).toBeUndefined();

    await expect(
      t.withIdentity({ subject: `${ids.clientUserId}|session` }).mutation(
        updatePolicyDetailsFn,
        {
          id: ids.policyId,
          update: {
            section: "insured",
            name: "Unauthorized edit",
            address: {},
            additionalNamedInsureds: [],
          },
        },
      ),
    ).rejects.toThrow(
      "Only the managing broker can edit extracted policy fields.",
    );
  });
});
