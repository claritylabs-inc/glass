/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { listForClient } from "./policies";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./lib/carrierIdentityEnrichment";
import {
  applyToPolicyInternal,
  markPolicyFailedInternal,
  upsertInternal,
} from "./carrierIdentityCache";

const modules = import.meta.glob("./**/*.ts");
const listForClientFn = listForClient as any;
const applyToPolicyInternalFn = applyToPolicyInternal as any;
const markPolicyFailedInternalFn = markPolicyFailedInternal as any;
const upsertInternalFn = upsertInternal as any;

describe("carrier identity branding", () => {
  it("merges cached official-site evidence into the canonical identity", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const cacheEntryId = await ctx.db.insert("carrierBrands", {
        normalizedName:
          "lloyd s underwriters led by liberty managing agency limited syndicate 4472",
        carrierName:
          "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
        publicName: "Liberty Specialty Markets",
        nameRelationship: "trading_name",
        website: "https://www.libertyspecialtymarkets.com/",
        accentColor: "#120C43",
        confidence: "high",
        sourceUrls: ["https://www.libertyspecialtymarkets.com/"],
        enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
        updatedAt: 1,
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier:
          "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
        carrierIdentity: {
          displayName:
            "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
          sourceName:
            "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
          legalEntities: [{
            name: "Liberty Managing Agency Limited, Syndicate 4472",
            sourceNodeIds: ["carrier"],
            sourceSpanIds: ["span-carrier"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["carrier"],
          sourceSpanIds: ["span-carrier"],
        },
        carrierIdentityEnrichmentStatus: "pending",
        carrierIdentityEnrichmentAttempts: 3,
        carrierIdentityEnrichmentAttemptedAt: 100,
        carrierBrandId: cacheEntryId,
        carrierBrandStatus: "ready",
        policyNumber: "L-100",
        linesOfBusiness: ["OLIB"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      });
      return { cacheEntryId, policyId };
    });

    await t.mutation(applyToPolicyInternalFn, {
      policyId: ids.policyId,
      cacheEntryId: ids.cacheEntryId,
      normalizedName:
        "lloyd s underwriters led by liberty managing agency limited syndicate 4472",
    });
    const policy = await t.run((ctx) => ctx.db.get(ids.policyId));

    expect(policy).toMatchObject({
      carrier: "Liberty Specialty Markets",
      carrierIdentityEnrichmentStatus: "ready",
      carrierIdentity: {
        displayName: "Liberty Specialty Markets",
        sourceName:
          "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
        operatingName: "Liberty Specialty Markets",
        publicNameRelationship: "trading_name",
        branding: {
          website: "https://www.libertyspecialtymarkets.com/",
          accentColor: "#120C43",
        },
      },
    });
    expect(policy?.carrierBrandId).toBeUndefined();
    expect(policy?.carrierIdentityEnrichmentAttempts).toBeUndefined();
    expect(policy?.carrierIdentityEnrichmentAttemptedAt).toBeUndefined();
  });

  it("does not replace the source display name without a verified relationship", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const cacheEntryId = await ctx.db.insert("carrierBrands", {
        normalizedName:
          "lloyd s underwriters led by tokio marine kiln syndicate 0510",
        carrierName:
          "Lloyd's Underwriters led by Tokio Marine Kiln Syndicate 0510",
        publicName: "Insurindex",
        website: "https://theinsurindex.com/",
        accentColor: "#F8DA56",
        confidence: "high",
        sourceUrls: ["https://theinsurindex.com/"],
        enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
        updatedAt: 1,
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Tokio Marine Kiln",
        carrierIdentity: {
          displayName: "Tokio Marine Kiln",
          sourceName:
            "Lloyd's Underwriters led by Tokio Marine Kiln Syndicate 0510",
          legalEntities: [{
            name: "Tokio Marine Kiln, Syndicate 0510",
            sourceNodeIds: ["carrier"],
            sourceSpanIds: ["span-carrier"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["carrier"],
          sourceSpanIds: ["span-carrier"],
        },
        policyNumber: "TMK-100",
        linesOfBusiness: ["OLIB"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      });
      return { cacheEntryId, policyId };
    });

    await t.mutation(applyToPolicyInternalFn, {
      policyId: ids.policyId,
      cacheEntryId: ids.cacheEntryId,
      normalizedName:
        "lloyd s underwriters led by tokio marine kiln syndicate 0510",
    });
    const policy = await t.run((ctx) => ctx.db.get(ids.policyId));

    expect(policy).toMatchObject({
      carrier: "Tokio Marine Kiln",
      carrierIdentity: {
        displayName: "Tokio Marine Kiln",
        branding: {
          website: "https://theinsurindex.com/",
          enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
        },
      },
    });
  });

  it("releases a stale enrichment lease when the source identity changes", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const cacheEntryId = await ctx.db.insert("carrierBrands", {
        normalizedName: "original carrier",
        carrierName: "Original Carrier",
        website: "https://original.example/",
        accentColor: "#123456",
        confidence: "high",
        sourceUrls: ["https://original.example/"],
        enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
        updatedAt: 1,
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Original Carrier",
        carrierIdentity: {
          displayName: "Replacement Carrier",
          sourceName: "Replacement Carrier Company",
          legalEntities: [{
            name: "Replacement Carrier Company",
            sourceNodeIds: ["replacement-carrier"],
            sourceSpanIds: ["span-replacement-carrier"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["replacement-carrier"],
          sourceSpanIds: ["span-replacement-carrier"],
        },
        carrierIdentityEnrichmentStatus: "pending",
        carrierIdentityEnrichmentAttempts: 2,
        carrierIdentityEnrichmentAttemptedAt: 100,
        policyNumber: "R-100",
        linesOfBusiness: ["AUTOB"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      });
      return { cacheEntryId, policyId };
    });

    const result = await t.mutation(applyToPolicyInternalFn, {
      policyId: ids.policyId,
      cacheEntryId: ids.cacheEntryId,
      normalizedName: "original carrier",
    });
    const policy = await t.run((ctx) => ctx.db.get(ids.policyId));

    expect(result).toEqual({ applied: false, identityChanged: true });
    expect(policy).toMatchObject({
      carrier: "Original Carrier",
      carrierIdentity: {
        displayName: "Replacement Carrier",
      },
    });
    expect(policy?.carrierIdentityEnrichmentStatus).toBeUndefined();
    expect(policy?.carrierIdentityEnrichmentAttempts).toBeUndefined();
    expect(policy?.carrierIdentityEnrichmentAttemptedAt).toBeUndefined();
  });

  it("does not mark a changed carrier failed after a stale lookup throws", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Replacement Carrier",
        carrierIdentity: {
          displayName: "Replacement Carrier",
          sourceName: "Replacement Carrier Company",
          legalEntities: [{
            name: "Replacement Carrier Company",
            sourceNodeIds: ["replacement-carrier"],
            sourceSpanIds: ["span-replacement-carrier"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["replacement-carrier"],
          sourceSpanIds: ["span-replacement-carrier"],
        },
        carrierIdentityEnrichmentStatus: "pending",
        carrierIdentityEnrichmentAttempts: 3,
        carrierIdentityEnrichmentAttemptedAt: 100,
        policyNumber: "R-200",
        linesOfBusiness: ["AUTOB"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      });
    });

    const result = await t.mutation(markPolicyFailedInternalFn, {
      policyId,
      normalizedName: "original carrier",
      attemptedAt: 100,
    });
    const policy = await t.run((ctx) => ctx.db.get(policyId));

    expect(result).toEqual({ status: "identity_changed" });
    expect(policy?.carrierIdentityEnrichmentStatus).toBeUndefined();
    expect(policy?.carrierIdentityEnrichmentAttempts).toBeUndefined();
    expect(policy?.carrierIdentityEnrichmentAttemptedAt).toBeUndefined();
    expect(policy?.carrierIdentity).toMatchObject({
      displayName: "Replacement Carrier",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(policyId, {
        carrierIdentityEnrichmentStatus: "pending",
        carrierIdentityEnrichmentAttempts: 1,
        carrierIdentityEnrichmentAttemptedAt: 200,
      });
    });
    const supersededResult = await t.mutation(markPolicyFailedInternalFn, {
      policyId,
      normalizedName: "original carrier",
      attemptedAt: 100,
    });
    const policyWithCurrentLease = await t.run((ctx) =>
      ctx.db.get(policyId)
    );
    expect(supersededResult).toEqual({ status: "identity_changed" });
    expect(policyWithCurrentLease).toMatchObject({
      carrierIdentityEnrichmentStatus: "pending",
      carrierIdentityEnrichmentAttempts: 1,
      carrierIdentityEnrichmentAttemptedAt: 200,
    });

    const sameIdentitySuperseded = await t.mutation(
      markPolicyFailedInternalFn,
      {
        policyId,
        normalizedName: "replacement carrier company",
        attemptedAt: 100,
      },
    );
    expect(sameIdentitySuperseded).toEqual({ status: "superseded" });

    const currentResult = await t.mutation(markPolicyFailedInternalFn, {
      policyId,
      normalizedName: "replacement carrier company",
      attemptedAt: 200,
    });
    expect(currentResult).toEqual({ status: "failed" });
    expect(
      (await t.run((ctx) => ctx.db.get(policyId)))
        ?.carrierIdentityEnrichmentStatus,
    ).toBe("failed");
  });

  it("clears stale optional identity evidence when refreshing a cache row", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("carrierBrands", {
        normalizedName: "allianz global assistance",
        carrierName: "Allianz Global Assistance",
        publicName: "SATW",
        nameRelationship: "trading_name",
        website: "https://www.satw.org/",
        websiteTitle: "SATW",
        iconStorageId: await ctx.storage.store(
          new Blob(["stale"], { type: "image/png" }),
        ),
        accentColor: "#111111",
        confidence: "medium",
        sourceUrls: ["https://www.satw.org/"],
        enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION - 1,
        updatedAt: 1,
      });
    });

    await t.mutation(upsertInternalFn, {
      normalizedName: "allianz global assistance",
      carrierName: "Allianz Global Assistance",
      website: "https://www.allianz-assistance.ca/",
      accentColor: "#003781",
      confidence: "medium",
      sourceUrls: ["https://www.allianz-assistance.ca/"],
      enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
      updatedAt: 2,
    });
    const cached = await t.run((ctx) =>
      ctx.db
        .query("carrierBrands")
        .withIndex("by_normalizedName", (query) =>
          query.eq("normalizedName", "allianz global assistance")
        )
        .unique()
    );

    expect(cached).toMatchObject({
      carrierName: "Allianz Global Assistance",
      website: "https://www.allianz-assistance.ca/",
      accentColor: "#003781",
      enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
    });
    expect(cached?.publicName).toBeUndefined();
    expect(cached?.nameRelationship).toBeUndefined();
    expect(cached?.websiteTitle).toBeUndefined();
    expect(cached?.iconStorageId).toBeUndefined();
  });

  it("returns persisted branding as part of the policy identity", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Client Admin",
        email: "client@example.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Allstate",
        carrierIdentity: {
          displayName: "Allstate",
          sourceName: "Allstate Insurance Company",
          publicNameRelationship: "same_legal_entity",
          legalEntities: [{
            name: "Allstate Insurance Company",
            sourceNodeIds: ["carrier"],
            sourceSpanIds: ["span-carrier"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["carrier"],
          sourceSpanIds: ["span-carrier"],
          branding: {
            website: "https://www.allstate.com/",
            accentColor: "#0B1739",
            confidence: "high",
            sourceUrls: ["https://www.allstate.com/"],
            enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
            updatedAt: 1,
          },
        },
        carrierIdentityEnrichmentStatus: "ready",
        policyNumber: "A-100",
        linesOfBusiness: ["AUTOB"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Client",
      });
      return { userId, policyId };
    });

    const rows = await t
      .withIdentity({ subject: `${ids.userId}|session` })
      .query(listForClientFn, { documentType: "policy" });

    expect(rows).toEqual([
      expect.objectContaining({
        _id: ids.policyId,
        carrierIdentity: {
          displayName: "Allstate",
          sourceName: "Allstate Insurance Company",
          publicNameRelationship: "same_legal_entity",
          legalEntities: [{
            name: "Allstate Insurance Company",
            sourceNodeIds: ["carrier"],
            sourceSpanIds: ["span-carrier"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["carrier"],
          sourceSpanIds: ["span-carrier"],
          branding: {
            website: "https://www.allstate.com/",
            accentColor: "#0B1739",
            confidence: "high",
            sourceUrls: ["https://www.allstate.com/"],
            iconUrl: null,
            enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
            updatedAt: 1,
          },
        },
      }),
    ]);
  });
});
