import { describe, expect, test } from "vitest";
import { buildDocumentSourceTree, buildSourceSpan } from "@claritylabs/cl-sdk";
import {
  buildExtractionCompletionManifest,
  buildPromotionEvidenceLedger,
  buildPromotionSourceCoverageMap,
  evaluateExtractionPromotion,
} from "./extractionPromotion";

function evidence(texts: string[]) {
  const sourceSpans = texts.map((text, index) => buildSourceSpan({
    documentId: "policy-1",
    sourceKind: "policy_pdf",
    text,
    pageStart: index + 1,
    pageEnd: index + 1,
    sourceUnit: "text",
  }, index));
  return {
    sourceSpans,
    sourceTree: buildDocumentSourceTree(sourceSpans, "policy-1"),
  };
}

describe("extraction promotion evidence", () => {
  test("model-reported absence cannot override detected evidence", () => {
    const source = evidence([
      "Policy Number: GL-100",
      "Named Insured: Example Corp.",
      "Insurer: Example Insurance Company",
      "Effective Date: 01/01/2026",
      "Expiration Date: 01/01/2027",
      "General Liability Coverage Limit $1,000,000",
    ]);
    const ledger = buildPromotionEvidenceLedger(source);
    const manifest = buildExtractionCompletionManifest({
      protocolVersion: "source-tree-v1",
      extractorVersion: "test",
      ledger,
    });

    const decision = evaluateExtractionPromotion({
      manifest,
      ledger,
      operationalProfile: { coverages: [] },
      hasValidCarrierIdentity: false,
      postCutover: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "policy_number evidence is present but the extracted profile omitted a cited value",
    );
    expect(decision.reasons).toContain(
      "carrier evidence is present without a valid carrier identity",
    );
    expect(decision.reasons).toContain(
      "coverage evidence is present but the extracted profile has no coverage rows",
    );
  });

  test("a citation must point to the detected candidate evidence", () => {
    const source = evidence([
      "Policy Number: GL-100",
      "Unrelated administrative wording.",
    ]);
    const ledger = buildPromotionEvidenceLedger(source);
    const manifest = buildExtractionCompletionManifest({
      protocolVersion: "source-tree-v1",
      extractorVersion: "test",
      ledger,
    });

    const decision = evaluateExtractionPromotion({
      manifest,
      ledger,
      operationalProfile: {
        policyNumber: {
          value: "MODEL-INVENTED",
          sourceSpanIds: [source.sourceSpans[1]!.id],
        },
        coverages: [],
      },
      hasValidCarrierIdentity: true,
      postCutover: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "policy_number evidence is present but the extracted profile omitted a cited value",
    );
  });

  test("coverage not_applicable requires no candidates and complete source coverage", () => {
    const source = evidence(["Property Coverage Schedule"]);
    const ledger = buildPromotionEvidenceLedger(source);
    const sourceCoverageMap = buildPromotionSourceCoverageMap(source);
    const manifest = buildExtractionCompletionManifest({
      protocolVersion: "source-tree-v2",
      extractorVersion: "test",
      ledger,
      sourceCoverageMap,
      sections: [
        {
          id: "extraction_policy_core",
          status: "complete",
          sourceSpanIds: ledger.eligibleSourceSpanIds,
        },
        {
          id: "extraction_policy_coverage",
          status: "not_applicable",
          sourceSpanIds: [],
        },
      ],
    });
    const decision = evaluateExtractionPromotion({
      manifest,
      ledger,
      operationalProfile: {},
      hasValidCarrierIdentity: true,
      postCutover: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "coverage cannot be not_applicable when candidates exist or source coverage is incomplete",
    );
  });

  test("v2 source coverage assigns every span and binds section IDs to deterministic shards", () => {
    const source = evidence([
      "Policy Number: GL-100",
      "Property Coverage Limit $1,000,000",
      "Unclassified policy wording.",
    ]);
    const ledger = buildPromotionEvidenceLedger(source);
    const sourceCoverageMap = buildPromotionSourceCoverageMap(source);
    const coreSpanIds = sourceCoverageMap.entries
      .filter((entry) => entry.assignment !== "coverage")
      .map((entry) => entry.sourceSpanId);
    const coverageSpanIds = sourceCoverageMap.entries
      .filter((entry) => entry.assignment === "coverage" || entry.assignment === "both")
      .map((entry) => entry.sourceSpanId);
    const manifest = buildExtractionCompletionManifest({
      protocolVersion: "source-tree-v2",
      extractorVersion: "test",
      ledger,
      sourceCoverageMap,
      sections: [
        { id: "extraction_policy_core", status: "complete", sourceSpanIds: coreSpanIds },
        { id: "extraction_policy_coverage", status: "complete", sourceSpanIds: coverageSpanIds },
      ],
    });

    expect(sourceCoverageMap.complete).toBe(true);
    expect(sourceCoverageMap.entries).toHaveLength(source.sourceSpans.length);
    expect(manifest.sourceCoverageMap?.shards.catchAll).toHaveLength(1);
    const decision = evaluateExtractionPromotion({
      manifest,
      ledger,
      operationalProfile: {
        policyNumber: {
          value: "GL-100",
          sourceSpanIds: [source.sourceSpans[0]!.id],
        },
        coverages: [{
          name: "Property",
          sourceSpanIds: [source.sourceSpans[1]!.id],
        }],
      },
      hasValidCarrierIdentity: true,
      postCutover: true,
    });
    expect(decision.reasons).not.toContain("source coverage is incomplete");
    expect(decision.reasons).not.toContain(
      "core section span IDs do not match the deterministic source-coverage map",
    );
    expect(decision.reasons).not.toContain(
      "coverage section span IDs do not match the deterministic source-coverage map",
    );
    expect(decision.allowed).toBe(true);
  });
});
