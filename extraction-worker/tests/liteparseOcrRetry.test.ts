import assert from "node:assert/strict";
import test from "node:test";

import { parsePdfWithOcrRetry } from "../src/liteparse.js";

function parsedPage(text: string) {
  return {
    pageNum: 1,
    width: 612,
    height: 792,
    text,
    textItems: text
      ? [
          {
            text,
            x: 20,
            y: 20,
            width: 100,
            height: 12,
            fontName: "Test",
            fontSize: 12,
            confidence: 1,
          },
        ]
      : [],
  };
}

test("retries an image-only LiteParse result once with OCR", async () => {
  const parserModes: boolean[] = [];
  const result = await parsePdfWithOcrRetry({
    pdfBytes: new Uint8Array([1]),
    documentId: "proposal-document",
    sourceKind: "attachment",
    ocrEnabled: false,
    createParser: (ocrEnabled) => {
      parserModes.push(ocrEnabled);
      return {
        parse: async () => ({
          pages: [parsedPage(ocrEnabled ? "OCR recovered proposal text" : "")],
          text: ocrEnabled ? "OCR recovered proposal text" : "",
        }),
        screenshot: async () => [],
      };
    },
  });

  assert.deepEqual(parserModes, [false, true]);
  assert.equal(result.ocrRetried, true);
  assert.ok(result.sourceSpans.length > 0);
  assert.match(result.sourceSpans[0]?.text ?? "", /OCR recovered/);
});

test("does not retry OCR when the first pass has usable spans", async () => {
  const parserModes: boolean[] = [];
  const result = await parsePdfWithOcrRetry({
    pdfBytes: new Uint8Array([1]),
    documentId: "policy-document",
    sourceKind: "policy_pdf",
    ocrEnabled: false,
    createParser: (ocrEnabled) => {
      parserModes.push(ocrEnabled);
      return {
        parse: async () => ({
          pages: [parsedPage("Existing selectable PDF text")],
          text: "Existing selectable PDF text",
        }),
        screenshot: async () => [],
      };
    },
  });

  assert.deepEqual(parserModes, [false]);
  assert.equal(result.ocrRetried, false);
  assert.ok(result.sourceSpans.length > 0);
});

test("does not loop when an explicitly enabled OCR pass remains empty", async () => {
  const parserModes: boolean[] = [];
  const result = await parsePdfWithOcrRetry({
    pdfBytes: new Uint8Array([1]),
    documentId: "blank-document",
    sourceKind: "attachment",
    ocrEnabled: true,
    createParser: (ocrEnabled) => {
      parserModes.push(ocrEnabled);
      return {
        parse: async () => ({ pages: [parsedPage("")], text: "" }),
        screenshot: async () => [],
      };
    },
  });

  assert.deepEqual(parserModes, [true]);
  assert.equal(result.ocrRetried, false);
  assert.equal(result.sourceSpans.length, 0);
});
