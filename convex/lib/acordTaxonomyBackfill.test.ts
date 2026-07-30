import { describe, expect, it } from "vitest";
import { rebuildAcordTaxonomyFromStoredSources } from "./acordTaxonomyBackfill";

function policy(overrides: Record<string, unknown> = {}) {
  return {
    carrier: "Test Carrier",
    policyNumber: "POL-1",
    insuredName: "Test Insured",
    linesOfBusiness: ["UN"],
    coverages: [],
    operationalProfile: {
      documentType: "policy",
      linesOfBusiness: ["UN"],
      declarationFacts: [],
      coverages: [],
      parties: [],
      endorsementSupport: [],
      sourceNodeIds: [],
      sourceSpanIds: [],
      warnings: [],
    },
    ...overrides,
  };
}

describe("rebuildAcordTaxonomyFromStoredSources", () => {
  it("repairs travel LOB, CoverageCd, and source-backed plan identity", () => {
    const decision = rebuildAcordTaxonomyFromStoredSources({
      policy: policy({
        coverages: [{ name: "Travel Delay", limits: [] }],
        operationalProfile: {
          documentType: "policy",
          linesOfBusiness: ["UN"],
          declarationFacts: [],
          coverages: [{ name: "Travel Delay", limits: [] }],
          parties: [],
          endorsementSupport: [],
          sourceNodeIds: ["node-1"],
          sourceSpanIds: ["span-1"],
          warnings: [],
        },
      }),
      sourceNodes: [{
        nodeId: "node-1",
        title: "Trip Cancellation & Interruption Plan",
        textExcerpt:
          "Trip Cancellation & Interruption Plan - Welcome to your travel insurance policy",
        sourceSpanIds: ["span-1", "span-2"],
        pageStart: 1,
      }],
      sourceSpans: [{
        spanId: "span-1",
        text:
          "Trip Cancellation & Interruption Plan - Travel Delay coverage",
        pageStart: 1,
      }, {
        spanId: "span-2",
        text: "General notices and contact information.",
        pageStart: 1,
      }],
    });

    expect(decision).toMatchObject({
      lineChanged: true,
      coverageCodesAdded: 2,
      productIdentityAdded: true,
      beforeLines: ["UN"],
      afterLines: ["TRVL"],
    });
    expect(decision.patch).toMatchObject({
      linesOfBusiness: ["TRVL"],
      programName: "Trip Cancellation & Interruption Plan",
      productIdentity: {
        name: {
          value: "Trip Cancellation & Interruption Plan",
          confidence: "high",
          sourceNodeIds: ["node-1"],
          sourceSpanIds: ["span-1"],
        },
      },
      coverages: [{
        name: "Travel Delay",
        coverageCode: "TVLDL",
        lineOfBusiness: "TRVL",
      }],
      operationalProfile: {
        linesOfBusiness: ["TRVL"],
        coverages: [{
          name: "Travel Delay",
          coverageCode: "TVLDL",
          lineOfBusiness: "TRVL",
        }],
      },
    });
  });

  it("replaces generic cyber classification only with unambiguous evidence", () => {
    const decision = rebuildAcordTaxonomyFromStoredSources({
      policy: policy({
        linesOfBusiness: ["OLIB"],
        operationalProfile: {
          linesOfBusiness: ["OLIB"],
          coverages: [{ name: "Cyber Liability", limits: [] }],
        },
      }),
      sourceNodes: [{
        nodeId: "node-1",
        title: "Commercial Cyber and Privacy Liability",
        textExcerpt: "Commercial Cyber and Privacy Liability policy",
        sourceSpanIds: ["span-1"],
        pageStart: 1,
      }],
      sourceSpans: [],
    });

    expect(decision.afterLines).toEqual(["CYBER"]);
    expect(decision.patch).toMatchObject({
      linesOfBusiness: ["CYBER"],
    });
  });

  it("normalizes retired LOB aliases without inventing a product identity", () => {
    const decision = rebuildAcordTaxonomyFromStoredSources({
      policy: policy({
        linesOfBusiness: ["PROPC"],
        operationalProfile: {
          linesOfBusiness: ["PROPC"],
          coverages: [],
        },
      }),
      sourceNodes: [],
      sourceSpans: [],
    });

    expect(decision.afterLines).toEqual(["PROP"]);
    expect(decision.productIdentityAdded).toBe(false);
    expect(decision.patch).not.toHaveProperty("productIdentity");
  });

  it("keeps ambiguous policies unclassified", () => {
    const decision = rebuildAcordTaxonomyFromStoredSources({
      policy: policy(),
      sourceNodes: [{
        nodeId: "node-1",
        title: "Declarations",
        textExcerpt: "Insurance policy declarations",
        sourceSpanIds: ["span-1"],
        pageStart: 1,
      }],
      sourceSpans: [{
        spanId: "span-1",
        text: "This policy contains the terms and conditions.",
        pageStart: 1,
      }],
    });

    expect(decision.afterLines).toEqual(["UN"]);
    expect(decision.productIdentityAdded).toBe(false);
    expect(decision.patch).toBeUndefined();
    expect(decision.reason).toBe("ambiguous_or_unclassified");
  });

  it("does not rewrite already-current taxonomy for object key order", () => {
    const storedCoverage = {
      limits: [],
      lineOfBusiness: "TRVL",
      coverageCode: "TVLDL",
      name: "Travel Delay",
    };
    const decision = rebuildAcordTaxonomyFromStoredSources({
      policy: policy({
        linesOfBusiness: ["TRVL"],
        coverages: [storedCoverage],
        operationalProfile: {
          documentType: "policy",
          linesOfBusiness: ["TRVL"],
          declarationFacts: [],
          coverages: [storedCoverage],
          parties: [],
          endorsementSupport: [],
          sourceNodeIds: [],
          sourceSpanIds: [],
          warnings: [],
        },
      }),
      sourceNodes: [],
      sourceSpans: [],
    });

    expect(decision).toMatchObject({
      lineChanged: false,
      coverageCodesAdded: 0,
      productIdentityAdded: false,
      reason: "already_current",
      beforeLines: ["TRVL"],
      afterLines: ["TRVL"],
    });
    expect(decision.patch).toBeUndefined();
  });
});
