import { describe, expect, it } from "vitest";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./carrierIdentityEnrichment";
import { rebuildCarrierIdentityFromStoredSources } from "./carrierIdentityBackfill";

const policyId = "policy-hdi";
const sourceSpans = [{
  spanId: "span-hdi",
  documentId: policyId,
  sourceKind: "policy_pdf",
  pageStart: 1,
  text: "Carrier: HDI Global Specialty SE",
  textHash: "hash-hdi",
}];
const sourceNodes = [
  {
    nodeId: "document-hdi",
    documentId: policyId,
    kind: "document",
    title: "Policy",
    description: "Policy",
    sourceSpanIds: ["span-hdi"],
    order: 0,
    path: "Policy",
  },
  {
    nodeId: "node-hdi",
    documentId: policyId,
    parentNodeId: "document-hdi",
    kind: "section",
    title: "Carrier",
    description: "Carrier: HDI Global Specialty SE",
    textExcerpt: "Carrier: HDI Global Specialty SE",
    sourceSpanIds: ["span-hdi"],
    order: 1,
    path: "Policy / Carrier",
  },
];
const operationalProfile = {
  documentType: "policy",
  linesOfBusiness: ["UN"],
  coverages: [],
  parties: [{
    role: "carrier",
    name: "HDI Global Specialty SE",
    sourceNodeIds: ["node-hdi"],
    sourceSpanIds: ["span-hdi"],
  }],
};

describe("stored-source carrier identity backfill", () => {
  it("rebuilds a missing identity and clears legacy brand links", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "HDI Global Specialty SE",
        operationalProfile,
        carrierBrandId: "legacy-brand",
        carrierBrandStatus: "ready",
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result).toMatchObject({
      outcome: "rebuilt",
      shouldEnrich: true,
      patch: {
        carrier: "HDI Global Specialty SE",
        carrierLegalName: "HDI Global Specialty SE",
        security: "HDI Global Specialty SE",
        carrierBrandId: undefined,
        carrierBrandStatus: undefined,
        carrierIdentityEnrichmentStatus: undefined,
        carrierIdentity: {
          displayName: "HDI Global Specialty SE",
          sourceName: "HDI Global Specialty SE",
          legalEntities: [{
            name: "HDI Global Specialty SE",
            sourceNodeIds: ["node-hdi"],
            sourceSpanIds: ["span-hdi"],
          }],
        },
      },
    });
  });

  it("repairs a corrupted identity from stored source evidence", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "Wrong Carrier",
        carrierIdentity: { displayName: 42, legalEntities: "broken" },
        operationalProfile,
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result.outcome).toBe("rebuilt");
    expect(result.patch?.carrierIdentity).toMatchObject({
      displayName: "HDI Global Specialty SE",
      sourceName: "HDI Global Specialty SE",
    });
  });

  it("does not attach insurer provenance to an unsourced carrier party", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "Hallucinated Carrier",
        operationalProfile: {
          ...operationalProfile,
          insurer: {
            value: "HDI Global Specialty SE",
            sourceNodeIds: ["node-hdi"],
            sourceSpanIds: ["span-hdi"],
          },
          parties: [
            {
              role: "carrier",
              name: "Hallucinated Carrier",
              sourceNodeIds: [],
              sourceSpanIds: [],
            },
            {
              role: "insurer",
              name: "HDI Global Specialty SE",
              sourceNodeIds: ["node-hdi"],
              sourceSpanIds: ["span-hdi"],
            },
          ],
        },
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result).toMatchObject({
      outcome: "rebuilt",
      patch: {
        carrier: "HDI Global Specialty SE",
        carrierIdentity: {
          displayName: "HDI Global Specialty SE",
          sourceName: "HDI Global Specialty SE",
          sourceNodeIds: ["node-hdi"],
          sourceSpanIds: ["span-hdi"],
          legalEntities: [{
            name: "HDI Global Specialty SE",
            sourceNodeIds: ["node-hdi"],
            sourceSpanIds: ["span-hdi"],
          }],
        },
      },
    });
    expect(result.patch?.carrierIdentity).not.toMatchObject({
      displayName: "Hallucinated Carrier",
    });
  });

  it("drops stale branding and legal names when source identity changes", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "Stale Mutual",
        carrierIdentity: {
          displayName: "Stale Mutual",
          sourceName: "Stale Mutual Insurance Company",
          legalEntities: [{
            name: "Stale Mutual Insurance Company",
            sourceNodeIds: ["stale-node"],
            sourceSpanIds: ["stale-span"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["stale-node"],
          sourceSpanIds: ["stale-span"],
          branding: {
            website: "https://stale.example/",
            accentColor: "#FF0000",
            confidence: "high",
            sourceUrls: ["https://stale.example/"],
            enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
            updatedAt: 5,
          },
        },
        operationalProfile,
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result.outcome).toBe("rebuilt");
    expect(result.shouldEnrich).toBe(true);
    expect(result.patch?.carrierIdentity).toMatchObject({
      displayName: "HDI Global Specialty SE",
      legalEntities: [{ name: "HDI Global Specialty SE" }],
    });
    expect(result.patch?.carrierIdentity).not.toHaveProperty("branding");
  });

  it("preserves unchanged current-version branding", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "HDI",
        carrierIdentityEnrichmentAttempts: 1,
        carrierIdentityEnrichmentAttemptedAt: 10,
        carrierIdentity: {
          displayName: "HDI",
          sourceName: "HDI Global Specialty SE",
          publicNameRelationship: "same_legal_entity",
          legalEntities: [{
            name: "HDI Global Specialty SE",
            sourceNodeIds: ["old-node"],
            sourceSpanIds: ["old-span"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["old-node"],
          sourceSpanIds: ["old-span"],
          branding: {
            website: "https://www.hdi.global/",
            accentColor: "#009FE3",
            confidence: "high",
            sourceUrls: ["https://www.hdi.global/"],
            enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
            updatedAt: 5,
          },
        },
        operationalProfile,
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result).toMatchObject({
      outcome: "unchanged",
      shouldEnrich: false,
      patch: {
        carrier: "HDI",
        carrierIdentityEnrichmentStatus: "ready",
        carrierIdentityEnrichmentAttempts: 1,
        carrierIdentity: {
          displayName: "HDI",
          sourceName: "HDI Global Specialty SE",
          branding: {
            website: "https://www.hdi.global/",
            enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
          },
        },
      },
    });
  });

  it("reports source-less rows for explicit full re-extraction", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: { operationalProfile },
      sourceSpans: [],
      sourceNodes: [],
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "missing_source_spans",
      shouldEnrich: false,
    });
  });
});
