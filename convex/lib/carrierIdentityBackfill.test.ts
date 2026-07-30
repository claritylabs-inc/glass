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

  it("rejects carrier identity backed only by dangling provenance ids", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "Hallucinated Carrier Insurance Company",
        operationalProfile: {
          ...operationalProfile,
          insurer: {
            value: "Hallucinated Carrier Insurance Company",
            sourceNodeIds: ["missing-carrier-node"],
            sourceSpanIds: ["missing-carrier-span"],
          },
          parties: [{
            role: "carrier",
            name: "Hallucinated Carrier Insurance Company",
            naicNumber: "99999",
            address: { street1: "1 Imaginary Plaza" },
            sourceNodeIds: ["missing-carrier-node"],
            sourceSpanIds: ["missing-carrier-span"],
          }],
        },
      },
      sourceSpans: [{
        spanId: "unrelated-span",
        documentId: policyId,
        sourceKind: "policy_pdf",
        pageStart: 1,
        text: "General policy conditions",
        textHash: "unrelated-hash",
      }],
      sourceNodes: [{
        nodeId: "unrelated-node",
        documentId: policyId,
        kind: "section",
        title: "Conditions",
        description: "General policy conditions",
        textExcerpt: "General policy conditions",
        sourceSpanIds: ["unrelated-span"],
        order: 1,
        path: "Policy / Conditions",
      }],
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "insufficient_source_identity",
      shouldEnrich: false,
    });
  });

  it("removes dangling ids while retaining valid carrier provenance", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "HDI Global Specialty SE",
        operationalProfile: {
          ...operationalProfile,
          parties: [{
            ...operationalProfile.parties[0],
            sourceNodeIds: ["missing-node", "node-hdi"],
            sourceSpanIds: ["missing-span", "span-hdi"],
          }],
        },
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result.patch?.carrierIdentity).toMatchObject({
      displayName: "HDI Global Specialty SE",
      sourceNodeIds: ["node-hdi"],
      sourceSpanIds: ["span-hdi"],
      legalEntities: [{
        name: "HDI Global Specialty SE",
        sourceNodeIds: ["node-hdi"],
        sourceSpanIds: ["span-hdi"],
      }],
    });
  });

  it("preserves every source-backed carrier legal entity", () => {
    const secondCarrierSpan = {
      spanId: "span-second-carrier",
      documentId: policyId,
      sourceKind: "policy_pdf",
      pageStart: 1,
      text: "Carrier: Acme Insurance Company",
      textHash: "hash-second-carrier",
    };
    const secondCarrierNode = {
      nodeId: "node-second-carrier",
      documentId: policyId,
      kind: "section",
      title: "Carrier",
      description: "Carrier: Acme Insurance Company",
      textExcerpt: "Carrier: Acme Insurance Company",
      sourceSpanIds: ["span-second-carrier"],
      order: 2,
      path: "Policy / Carrier 2",
    };
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "HDI Global Specialty SE",
        operationalProfile: {
          ...operationalProfile,
          parties: [
            ...operationalProfile.parties,
            {
              role: "carrier",
              name: "Acme Insurance Company",
              sourceNodeIds: ["node-second-carrier"],
              sourceSpanIds: ["span-second-carrier"],
            },
          ],
        },
      },
      sourceSpans: [...sourceSpans, secondCarrierSpan],
      sourceNodes: [...sourceNodes, secondCarrierNode],
    });

    expect(result).toMatchObject({
      outcome: "rebuilt",
      patch: {
        security: undefined,
        carrierIdentity: {
          displayName: "HDI Global Specialty SE",
          legalEntityRelationship: "unspecified",
          legalEntities: [
            {
              name: "HDI Global Specialty SE",
              sourceNodeIds: ["node-hdi"],
              sourceSpanIds: ["span-hdi"],
            },
            {
              name: "Acme Insurance Company",
              sourceNodeIds: ["node-second-carrier"],
              sourceSpanIds: ["span-second-carrier"],
            },
          ],
        },
      },
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

  it("drops stale insurer details and rebuilds only matching source fields", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "Stale Mutual",
        carrierNaicNumber: "99999",
        carrierAmBestRating: "A++",
        carrierAdmittedStatus: "admitted",
        insurer: {
          legalName: "Stale Mutual Insurance Company",
          naicNumber: "99999",
          amBestRating: "A++",
          admittedStatus: "admitted",
          address: {
            street1: "1 Stale Plaza",
            city: "Oldtown",
            state: "NY",
            zip: "10001",
          },
        },
        operationalProfile: {
          ...operationalProfile,
          parties: [{
            ...operationalProfile.parties[0],
            naicNumber: "41343",
            address: {
              street1: "161 N. Clark Street",
              city: "Chicago",
              state: "IL",
              zip: "60601",
            },
          }],
        },
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result).toMatchObject({
      outcome: "rebuilt",
      patch: {
        carrierNaicNumber: "41343",
        carrierAmBestRating: undefined,
        carrierAdmittedStatus: undefined,
        insurer: {
          legalName: "HDI Global Specialty SE",
          naicNumber: "41343",
          address: {
            street1: "161 N. Clark Street",
            city: "Chicago",
            state: "IL",
            zip: "60601",
          },
          documentNodeId: "node-hdi",
          sourceSpanIds: ["span-hdi"],
        },
      },
    });
    expect(result.patch?.insurer).not.toMatchObject({
      amBestRating: "A++",
      admittedStatus: "admitted",
      address: { street1: "1 Stale Plaza" },
    });
  });

  it("preserves a source-backed insurer address without a street line", () => {
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: {
        carrier: "Stale Mutual",
        operationalProfile: {
          ...operationalProfile,
          parties: [{
            ...operationalProfile.parties[0],
            address: {
              city: "Chicago",
              state: "IL",
              zip: "60601",
            },
          }],
        },
      },
      sourceSpans,
      sourceNodes,
    });

    expect(result.patch?.insurer).toMatchObject({
      legalName: "HDI Global Specialty SE",
      address: {
        city: "Chicago",
        state: "IL",
        zip: "60601",
      },
    });
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
