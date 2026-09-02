import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateProposalDocuments,
  type ProposalExtractedDocument,
} from "../src/proposalExtraction.js";

const documents: ProposalExtractedDocument[] = [
  {
    proposalDocumentId: "proposal-doc-package",
    fileName: "package.pdf",
    document: {
      type: "quote",
      carrier: "Farmers",
      quoteNumber: "Q-100",
      insuredName: "Sigillo LLC",
      proposedEffectiveDate: "2026-10-01",
      premium: "$12,400",
      coverages: [{
        name: "Building",
        limit: "$1,325,000",
        sourceSpanIds: ["package-limit"],
        documentNodeId: "package-node",
        pageNumber: 4,
      }],
      premiumBreakdown: [{
        line: "Package",
        amount: "$12,400",
        sourceSpanIds: ["package-premium"],
        pageNumber: 2,
      }],
      declarations: { fields: [{
        field: "policyNumber",
        value: "Q-100",
        sourceSpanIds: ["package-quote-number"],
      }] },
    },
    sourceSpans: [],
    sourceNodes: [],
    warnings: [],
    supplemental: {
      quoteExpirationDate: "2026-09-20",
      quoteExpirationEvidence: {
        description: "Quote valid until September 20, 2026",
        sourceNodeIds: ["package-validity-node"],
        sourceSpanIds: ["package-validity-span"],
        pageStart: 1,
        pageEnd: 1,
      },
    },
  },
  {
    proposalDocumentId: "proposal-doc-umbrella",
    fileName: "umbrella.pdf",
    document: {
      type: "quote",
      carrier: "Farmers",
      quoteNumber: "Q-100-U",
      insuredName: "Sigillo LLC",
      coverages: [{
        name: "Umbrella",
        limit: "$2,000,000",
        sourceSpanIds: ["umbrella-limit"],
        pageNumber: 1,
      }],
      premiumBreakdown: [{
        line: "Umbrella",
        amount: "$1,700",
        sourceSpanIds: ["umbrella-premium"],
        pageNumber: 1,
      }],
    },
    sourceSpans: [],
    sourceNodes: [],
    warnings: [],
  },
];

test("aggregates multiple quote documents without losing document-qualified evidence", () => {
  const aggregate = aggregateProposalDocuments(documents);
  assert.equal(aggregate.carrier, "Farmers");
  assert.equal(aggregate.quoteExpirationDate, "2026-09-20");
  assert.equal(
    aggregate.evidence.quoteExpirationDate?.[0]?.proposalDocumentId,
    "proposal-doc-package",
  );
  assert.deepEqual(
    aggregate.premiums.map((premium) => premium.line),
    ["Package", "Umbrella"],
  );
  assert.deepEqual(aggregate.coverages[0]?.evidence, [{
    proposalDocumentId: "proposal-doc-package",
    sourceNodeIds: ["package-node"],
    sourceSpanIds: ["package-limit"],
    pageStart: 4,
    pageEnd: 4,
  }]);
  assert.equal(
    aggregate.coverages[1]?.evidence[0]?.proposalDocumentId,
    "proposal-doc-umbrella",
  );
});
