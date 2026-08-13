import { describe, expect, it } from "vitest";
import { classifyExtractionIntegrity } from "./extractionIntegrityAudit";
import {
  buildExtractionCompletionManifest,
  buildPromotionEvidenceLedger,
} from "./extractionPromotion";

const spans = [{
  id: "span-1",
  documentId: "policy-1",
  sourceKind: "policy_pdf",
  text: "Policy Number: GL-100",
  pageStart: 1,
  pageEnd: 1,
}];
const nodes = [{
  id: "node-1",
  documentId: "policy-1",
  kind: "text" as const,
  title: "Policy number",
  description: "Policy number",
  sourceSpanIds: ["span-1"],
  order: 0,
  path: "1",
}];

describe("classifyExtractionIntegrity", () => {
  it("keeps legacy-unverified rows separate from post-cutover violations", () => {
    expect(classifyExtractionIntegrity({
      postCutover: false,
      operationalProfile: {},
      hasValidCarrierIdentity: false,
    }).classification).toBe("legacy_unverified");
    expect(classifyExtractionIntegrity({
      postCutover: true,
      operationalProfile: {},
      hasValidCarrierIdentity: false,
    }).classification).toBe("post_cutover_violation");
  });

  it("reports a post-cutover omission instead of treating model output as authoritative", () => {
    const ledger = buildPromotionEvidenceLedger({ sourceSpans: spans, sourceTree: nodes });
    const manifest = buildExtractionCompletionManifest({
      protocolVersion: "source-tree-v1",
      extractorVersion: "test",
      ledger,
    });
    const result = classifyExtractionIntegrity({
      postCutover: true,
      ledger,
      manifest,
      operationalProfile: {},
      hasValidCarrierIdentity: false,
    });

    expect(result.classification).toBe("post_cutover_violation");
    expect(result.reasons).toContain(
      "policy_number evidence is present but the extracted profile omitted a cited value",
    );
  });

  it("keeps the post-cutover invariant count at zero for a valid promoted row", () => {
    const ledger = buildPromotionEvidenceLedger({ sourceSpans: spans, sourceTree: nodes });
    const manifest = buildExtractionCompletionManifest({
      protocolVersion: "source-tree-v1",
      extractorVersion: "test",
      ledger,
    });
    const audited = [classifyExtractionIntegrity({
      postCutover: true,
      ledger,
      manifest,
      operationalProfile: {
        policyNumber: {
          value: "GL-100",
          sourceSpanIds: ["span-1"],
          sourceNodeIds: ["node-1"],
        },
        coverages: [],
      },
      hasValidCarrierIdentity: true,
    })];

    expect(audited.filter((result) =>
      result.classification === "post_cutover_violation")).toHaveLength(0);
  });
});
