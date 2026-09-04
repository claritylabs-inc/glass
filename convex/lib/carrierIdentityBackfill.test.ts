import { describe, expect, it } from "vitest";
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
