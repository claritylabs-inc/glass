import { describe, expect, test } from "vitest";
import { normalizeProposalReview } from "./proposalReview";

describe("proposal review normalization", () => {
  const extractedOffer = {
    coverages: [
      {
        name: "Building",
        limit: "$1,325,000",
        evidence: [
          {
            proposalDocumentId: "document-1",
            sourceNodeIds: ["node-1"],
            sourceSpanIds: ["span-1"],
            pageStart: 4,
            pageEnd: 4,
          },
        ],
      },
    ],
  };

  test("drops invented references and fills omitted review targets", () => {
    const normalized = normalizeProposalReview(
      {
        conclusion: "has_gaps",
        findings: [
          {
            targetKind: "requirement",
            targetId: "requirement-1",
            conclusion: "has_gap",
            summary: "Building limit is below the requested amount.",
            evidence: [
              {
                proposalDocumentId: "document-1",
                sourceNodeIds: ["node-1"],
                sourceSpanIds: ["span-1"],
                pageStart: 4,
                pageEnd: 4,
              },
              {
                proposalDocumentId: "invented-document",
                sourceNodeIds: ["invented-node"],
                sourceSpanIds: ["invented-span"],
                pageStart: 99,
                pageEnd: 99,
              },
            ],
          },
        ],
      },
      {
        requirementIds: ["requirement-1", "requirement-2"],
        specificationIds: ["specification-1"],
        extractedOffer,
      },
    );
    expect(normalized.findings[0]?.evidence).toHaveLength(1);
    expect(normalized.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: "requirement",
          targetId: "requirement-2",
          conclusion: "insufficient_evidence",
        }),
        expect.objectContaining({
          targetKind: "specification",
          targetId: "specification-1",
          conclusion: "insufficient_evidence",
        }),
      ]),
    );
    expect(normalized.conclusion).toBe("has_gaps");
  });
});
