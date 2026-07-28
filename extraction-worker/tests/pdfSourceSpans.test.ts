import assert from "node:assert/strict";
import test from "node:test";

import {
  selectPdfTextSupplements,
  type WorkerSourceSpan,
} from "../src/pdfSourceSpans.js";

function candidate(text: string): WorkerSourceSpan {
  return {
    id: "policy:span:1:supplement",
    documentId: "policy",
    sourceKind: "policy_pdf",
    kind: "pdf_text",
    pageStart: 1,
    pageEnd: 1,
    text,
    textHash: "text-hash",
    hash: "text-hash",
  };
}

test("selects Poppler page text when it contains visible labeled values omitted by the primary parser", () => {
  const supplements = selectPdfTextSupplements(
    [
      {
        pageStart: 1,
        text: "Customer Signature Print Name INSURANCE CERTIFICATION",
      },
    ],
    [
      candidate(
        "Customer Signature Print Name Tools for Enlightenment Inc INSURANCE CERTIFICATION",
      ),
    ],
  );

  assert.equal(supplements.length, 1);
});

test("does not duplicate a page when Poppler only reformats primary-parser text", () => {
  const supplements = selectPdfTextSupplements(
    [
      {
        pageStart: 1,
        text: "Coverage Limit 5,000 Monthly Premium 20.00",
      },
    ],
    [candidate("Coverage Limit $5,000 / Monthly Premium $20.00")],
  );

  assert.equal(supplements.length, 0);
});
