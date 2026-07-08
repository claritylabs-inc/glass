/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { syncPolicyInternal } from "./declarationFacts";
import { softDeleteInternal } from "./policies";
import { extractDeclarationFactsFromPolicy } from "./lib/declarationFacts";

const modules = import.meta.glob("./**/*.ts");
const syncPolicyInternalFn = syncPolicyInternal as any;
const softDeleteInternalFn = softDeleteInternal as any;

describe("declarationFacts org profile sync", () => {
  test("extracts insured mailing address and key insured declaration facts", () => {
    const facts = extractDeclarationFactsFromPolicy({
      _id: "policy-1",
      orgId: "org-1",
      policyYear: 2026,
      effectiveDate: "05/01/2026",
      expirationDate: "05/01/2027",
      insuredName: "Clarity Labs Inc.",
      insuredDba: "Risk Management & AI Contact",
      insuredEntityType: "Corporation",
      insuredFein: "12-3456789",
      insuredAddress: {
        street1: "1070 Bridgeview Way",
        city: "San Francisco",
        state: "CA",
        zip: "94121",
      },
      additionalNamedInsureds: [{ name: "Clarity Labs Holdings Inc." }],
    });

    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "insuredAddress",
        fieldGroup: "mailing_address",
        displayValue: "1070 Bridgeview Way, San Francisco, CA 94121",
        structuredValue: expect.objectContaining({
          street1: "1070 Bridgeview Way",
          zip: "94121",
        }),
        policyYear: 2026,
      }),
      expect.objectContaining({
        fieldPath: "insuredDba",
        fieldGroup: "dba",
        displayValue: "Risk Management & AI Contact",
      }),
      expect.objectContaining({
        fieldPath: "insuredEntityType",
        fieldGroup: "entity_type",
        displayValue: "Corporation",
      }),
      expect.objectContaining({
        fieldPath: "insuredFein",
        fieldGroup: "fein",
        displayValue: "12-3456789",
      }),
      expect.objectContaining({
        fieldPath: "additionalNamedInsureds.0",
        fieldGroup: "additional_named_insured",
        displayValue: "Clarity Labs Holdings Inc.",
      }),
    ]));
  });

  test("extracts source-backed declaration facts from the SDK operational profile", () => {
    const facts = extractDeclarationFactsFromPolicy({
      _id: "policy-1",
      orgId: "org-1",
      policyYear: 2026,
      effectiveDate: "2026-05-01",
      expirationDate: "2027-05-01",
      insuredName: "Compatibility Name",
      insuredAddress: {
        street1: "Compatibility St",
        city: "Oakland",
        state: "CA",
        zip: "94612",
      },
      operationalProfile: {
        declarationFacts: [
          {
            field: "namedInsured",
            value: "Clarity Labs Inc.",
            normalizedValue: "clarity labs inc",
            valueKind: "string",
            sourceSpanIds: ["span-named-insured"],
          },
          {
            field: "mailingAddress",
            value: "1070 Bridgeview Way, San Francisco, CA 94121",
            normalizedValue: "1070 bridgeview way san francisco ca 94121",
            valueKind: "address",
            address: {
              street1: "1070 Bridgeview Way",
              city: "San Francisco",
              state: "CA",
              zip: "94121",
            },
            sourceSpanIds: ["span-mailing-address"],
          },
          {
            field: "entityType",
            value: "Delaware C-Corporation",
            normalizedValue: "delaware c corporation",
            valueKind: "string",
            sourceSpanIds: ["span-entity-type"],
          },
          {
            field: "taxId",
            value: "12-3456789",
            normalizedValue: "123456789",
            valueKind: "string",
            sourceSpanIds: ["span-tax-id"],
          },
        ],
      },
    });

    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "operationalProfile.declarationFacts.0",
        fieldGroup: "insured_identity",
        displayValue: "Clarity Labs Inc.",
        sourceSpanIds: ["span-named-insured"],
      }),
      expect.objectContaining({
        fieldPath: "operationalProfile.declarationFacts.1",
        fieldGroup: "mailing_address",
        displayValue: "1070 Bridgeview Way, San Francisco, CA 94121",
        structuredValue: expect.objectContaining({
          street1: "1070 Bridgeview Way",
          zip: "94121",
        }),
        sourceSpanIds: ["span-mailing-address"],
      }),
      expect.objectContaining({
        fieldPath: "operationalProfile.declarationFacts.2",
        fieldGroup: "entity_type",
        displayValue: "Delaware C-Corporation",
      }),
      expect.objectContaining({
        fieldPath: "operationalProfile.declarationFacts.3",
        fieldGroup: "fein",
        displayValue: "12-3456789",
      }),
    ]));
  });

  test("saves newest policy declaration facts to the organization profile", async () => {
    const t = convexTest(schema, modules);
    const { orgId, olderPolicyId, newerPolicyId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Clarity Labs",
        type: "client",
      });
      const basePolicy = {
        orgId,
        carrier: "Carrier",
        documentType: "policy" as const,
        linesOfBusiness: ["CGL"],
        isRenewal: false,
        coverages: [],
        extractionDataStage: "final" as const,
        pipelineStatus: "complete" as const,
      };
      const olderPolicyId = await ctx.db.insert("policies", {
        ...basePolicy,
        policyNumber: "OLD-1",
        policyYear: 2025,
        effectiveDate: "05/01/2025",
        expirationDate: "05/01/2026",
        insuredName: "Clarity Labs LLC",
        insuredEntityType: "LLC",
        insuredFein: "11-1111111",
        insuredAddress: {
          street1: "1 Old St",
          city: "Oakland",
          state: "CA",
          zip: "94612",
        },
      });
      const newerPolicyId = await ctx.db.insert("policies", {
        ...basePolicy,
        policyNumber: "NEW-1",
        policyYear: 2026,
        effectiveDate: "05/01/2026",
        expirationDate: "05/01/2027",
        insuredName: "Clarity Labs Inc.",
        insuredDba: "Risk Management & AI Contact",
        insuredEntityType: "Corporation",
        insuredFein: "22-2222222",
        insuredAddress: {
          street1: "1070 Bridgeview Way",
          city: "San Francisco",
          state: "CA",
          zip: "94121",
        },
        additionalNamedInsureds: [{ name: "Clarity Labs Holdings Inc." }],
      });
      return { orgId, olderPolicyId, newerPolicyId };
    });

    await t.mutation(syncPolicyInternalFn, { policyId: olderPolicyId });
    await t.mutation(syncPolicyInternalFn, { policyId: newerPolicyId });

    await expect(t.run(async (ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
      mailingAddress: {
        street1: "1070 Bridgeview Way",
        city: "San Francisco",
        state: "CA",
        zip: "94121",
        formatted: "1070 Bridgeview Way, San Francisco, CA 94121",
      },
      profileFacts: {
        namedInsured: { value: "Clarity Labs Inc." },
        dba: { value: "Risk Management & AI Contact" },
        entityType: { value: "Corporation" },
        taxId: { value: "22-2222222" },
        mailingAddress: {
          value: {
            street1: "1070 Bridgeview Way",
            zip: "94121",
          },
        },
        additionalNamedInsureds: [{ value: "Clarity Labs Holdings Inc." }],
      },
      relatedLegalEntities: expect.arrayContaining([
        expect.objectContaining({ legalName: "Clarity Labs Inc.", relationship: "current" }),
        expect.objectContaining({ legalName: "Risk Management & AI Contact", relationship: "dba" }),
        expect.objectContaining({ legalName: "Clarity Labs Holdings Inc.", relationship: "other" }),
      ]),
    });

    await t.mutation(softDeleteInternalFn, { id: newerPolicyId });

    await expect(t.run(async (ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
      mailingAddress: {
        street1: "1 Old St",
        city: "Oakland",
        state: "CA",
        zip: "94612",
      },
      profileFacts: {
        namedInsured: { value: "Clarity Labs LLC" },
        entityType: { value: "LLC" },
        taxId: { value: "11-1111111" },
      },
    });
  });

  test("prefers SDK operational profile declaration facts over same-policy compatibility fields", async () => {
    const t = convexTest(schema, modules);
    const { orgId, policyId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Clarity Labs",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        documentType: "policy" as const,
        linesOfBusiness: ["CGL"],
        isRenewal: false,
        coverages: [],
        extractionDataStage: "final" as const,
        pipelineStatus: "complete" as const,
        policyNumber: "SPS-TPC-2026",
        policyYear: 2026,
        effectiveDate: "2026-05-01",
        expirationDate: "2027-05-01",
        insuredName: "Compatibility Name LLC",
        insuredAddress: {
          street1: "1 Compatibility St",
          city: "Oakland",
          state: "CA",
          zip: "94612",
        },
        operationalProfile: {
          declarationFacts: [
            {
              field: "namedInsured",
              value: "Clarity Labs Inc.",
              normalizedValue: "clarity labs inc",
              valueKind: "string",
              sourceSpanIds: ["span-named-insured"],
            },
            {
              field: "mailingAddress",
              value: "1070 Bridgeview Way, San Francisco, CA 94121",
              normalizedValue: "1070 bridgeview way san francisco ca 94121",
              valueKind: "address",
              address: {
                street1: "1070 Bridgeview Way",
                city: "San Francisco",
                state: "CA",
                zip: "94121",
              },
              sourceSpanIds: ["span-mailing-address"],
            },
          ],
        },
      });
      return { orgId, policyId };
    });

    await t.mutation(syncPolicyInternalFn, { policyId });

    await expect(t.run(async (ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
      profileFacts: {
        namedInsured: {
          value: "Clarity Labs Inc.",
          source: {
            fieldPath: "operationalProfile.declarationFacts.0",
            sourceSpanIds: ["span-named-insured"],
          },
        },
        mailingAddress: {
          value: {
            street1: "1070 Bridgeview Way",
            city: "San Francisco",
            state: "CA",
            zip: "94121",
          },
          source: {
            fieldPath: "operationalProfile.declarationFacts.1",
            sourceSpanIds: ["span-mailing-address"],
          },
        },
      },
    });
  });
});
