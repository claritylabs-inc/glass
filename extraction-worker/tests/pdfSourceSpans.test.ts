import assert from "node:assert/strict";
import test from "node:test";

import {
  orderSourceSpansForPreview,
  selectPdfTextSupplements,
  type WorkerSourceSpan,
} from "../src/pdfSourceSpans.js";

function candidate(
  text: string,
  options: { page?: number; sourceUnit?: string } = {},
): WorkerSourceSpan {
  const page = options.page ?? 1;
  return {
    id: `policy:span:${page}:${options.sourceUnit ?? "supplement"}`,
    documentId: "policy",
    sourceKind: "policy_pdf",
    kind: "pdf_text",
    pageStart: page,
    pageEnd: page,
    text,
    textHash: "text-hash",
    hash: "text-hash",
    metadata: options.sourceUnit
      ? { sourceUnit: options.sourceUnit }
      : undefined,
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

test("does not treat split or joined words as omitted page content", () => {
  const supplements = selectPdfTextSupplements(
    [{ pageStart: 1, text: "The policyholder accepts these conditions" }],
    [candidate("The policy holder accepts these conditions")],
  );

  assert.equal(supplements.length, 0);
});

test("requires a material difference for an unlabeled page", () => {
  const supplements = selectPdfTextSupplements(
    [{ pageStart: 1, text: "Commercial Property Coverage Terms Conditions" }],
    [
      candidate(
        "Commercial Property Coverage Terms Conditions standard wording",
      ),
    ],
  );

  assert.equal(supplements.length, 0);
});

test("keeps a novel numeric value on a labeled page", () => {
  const supplements = selectPdfTextSupplements(
    [{ pageStart: 1, text: "Coverage Limit Monthly Premium" }],
    [candidate("Coverage Limit $5,000 Monthly Premium")],
  );

  assert.equal(supplements.length, 1);
});

test("orders same-page supplements before primary spans for bounded previews", () => {
  const primaryPageOne = candidate("primary page one", {
    page: 1,
    sourceUnit: "page",
  });
  const supplementPageOne = candidate("supplement page one", {
    page: 1,
    sourceUnit: "page_text_supplement",
  });
  const primaryPageTwo = candidate("primary page two", {
    page: 2,
    sourceUnit: "page",
  });

  assert.deepEqual(
    orderSourceSpansForPreview([
      primaryPageOne,
      primaryPageTwo,
      supplementPageOne,
    ]).map((span) => span.text),
    ["supplement page one", "primary page one", "primary page two"],
  );
});
