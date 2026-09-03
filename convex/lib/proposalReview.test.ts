import { describe, expect, test } from "vitest";
import { normalizeProposalReview } from "./proposalReview";
import { buildProposalMarkdown } from "./proposalMarkdown";

describe("proposal review normalization", () => {
  const extractedOffer = {
    carrier: "Cove Mutual",
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
  const sectionKeys = ["coverage_requested", "valuation"];

  test("resolves cited tags and drops invented ones", () => {
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
      { sectionKeys, legend, proposalMarkdown: markdown },
    );

    expect(normalized.findings[0]).toMatchObject({
      sectionKey: "coverage_requested",
      conclusion: "has_gap",
    });
    expect(normalized.findings[0]?.evidence).toEqual([
      {
        proposalDocumentId: "document-1",
        sourceNodeIds: ["node-1"],
        sourceSpanIds: ["span-1"],
        pageStart: 4,
        pageEnd: 4,
      },
    ]);
    expect(normalized.conclusion).toBe("has_gaps");
  });

  test("fills every packet section the review skipped", () => {
    const normalized = normalizeProposalReview(
      { conclusion: "meets_requirements", findings: [] },
      { sectionKeys, legend, proposalMarkdown: markdown },
    );

    expect(normalized.findings.map((finding) => finding.sectionKey)).toEqual(
      sectionKeys,
    );
    expect(
      normalized.findings.every(
        (finding) => finding.conclusion === "insufficient_evidence",
      ),
    ).toBe(true);
    expect(normalized.conclusion).toBe("insufficient_evidence");
  });

  test("downgrades a supported conclusion when every citation is invented", () => {
    const normalized = normalizeProposalReview(
      {
        conclusion: "meets_requirements",
        findings: sectionKeys.map((sectionKey) => ({
          sectionKey,
          conclusion: "meets" as const,
          summary: "The proposal meets the section.",
          evidenceRefs: ["E404"],
        })),
      },
      { sectionKeys, legend, proposalMarkdown: markdown },
    );

    expect(normalized.findings[0]).toMatchObject({
      conclusion: "insufficient_evidence",
      evidence: [],
    });
    expect(normalized.conclusion).toBe("insufficient_evidence");
  });

  test("ignores findings for sections outside the broker-visible packet", () => {
    const normalized = normalizeProposalReview(
      {
        conclusion: "meets_requirements",
        findings: [
          {
            sectionKey: "market_strategy",
            conclusion: "meets",
            summary: "Operator-only section.",
            evidenceRefs: ["E1"],
          },
        ],
      },
      { sectionKeys, legend, proposalMarkdown: markdown },
    );

    expect(normalized.findings.map((finding) => finding.sectionKey)).toEqual(
      sectionKeys,
    );
  });

  test("rejects legend entries that were not shown to the model", () => {
    const normalized = normalizeProposalReview(
      {
        conclusion: "meets_requirements",
        findings: [
          {
            sectionKey: "coverage_requested",
            conclusion: "meets",
            summary: "The proposal meets the section.",
            evidenceRefs: ["E1"],
          },
        ],
      },
      { sectionKeys, legend, proposalMarkdown: "Proposal was truncated." },
    );

    expect(normalized.findings[0]).toMatchObject({
      conclusion: "insufficient_evidence",
      evidence: [],
    });
  });
});

describe("proposal markdown", () => {
  test("renders extracted sections with stable evidence tags", () => {
    const { markdown, legend } = buildProposalMarkdown({
      carrier: "Cove Mutual",
      premium: "$14,200",
      coverages: [
        {
          name: "Building",
          limit: "$1,325,000",
          deductible: "$25,000",
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
      exclusions: [{ name: "Flood", content: "Excluded in full" }],
      evidence: {
        carrier: [
          {
            proposalDocumentId: "document-1",
            sourceNodeIds: ["node-9"],
            sourceSpanIds: [],
          },
        ],
      },
    });

    expect(markdown).toContain("## Quote summary");
    expect(markdown).toContain("- Carrier: Cove Mutual [E1]");
    expect(markdown).toContain("## Coverage offered");
    expect(markdown).toContain(
      "- name: Building · limit: $1,325,000 · deductible: $25,000 [E2]",
    );
    // An item without evidence still renders; it simply cannot be cited.
    expect(markdown).toContain("- name: Flood · content: Excluded in full");
    expect(Object.keys(legend)).toEqual(["E1", "E2"]);
  });

  test("returns nothing for an empty extraction", () => {
    expect(buildProposalMarkdown(undefined)).toEqual({
      markdown: "",
      legend: {},
    });
  });
});
