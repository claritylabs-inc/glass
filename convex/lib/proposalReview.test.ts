import { describe, expect, test } from "vitest";
import { buildProposalMarkdown } from "./proposalMarkdown";
import { normalizeProposalReview } from "./proposalReview";

describe("proposal review grounding", () => {
  test("drops invented citations and fills omitted packet sections", () => {
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
    const { markdown, legend } = buildProposalMarkdown(extractedOffer);

    const normalized = normalizeProposalReview(
      {
        conclusion: "has_gaps",
        findings: [
          {
            sectionKey: "coverage_requested",
            conclusion: "has_gap",
            summary: "Building limit is below the requested amount.",
            evidenceRefs: ["E1", "E99"],
          },
        ],
      },
      {
        sectionKeys: ["coverage_requested", "valuation"],
        legend,
        proposalMarkdown: markdown,
      },
    );

    expect(normalized.findings[0]?.evidence).toEqual([
      {
        proposalDocumentId: "document-1",
        sourceNodeIds: ["node-1"],
        sourceSpanIds: ["span-1"],
        pageStart: 4,
        pageEnd: 4,
      },
    ]);
    expect(normalized.findings[1]).toMatchObject({
      sectionKey: "valuation",
      conclusion: "insufficient_evidence",
    });
    expect(normalized.conclusion).toBe("has_gaps");
  });
});
