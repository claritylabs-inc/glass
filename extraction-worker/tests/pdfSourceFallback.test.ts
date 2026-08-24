import assert from "node:assert/strict";
import test from "node:test";

import { preparePdfSourceWithLiteParseFallback } from "../src/pdfSourceFallback.js";

test("LiteParse conversion failure invokes PDF.js exactly once", async () => {
  let pdfJsCalls = 0;
  const prepared = await preparePdfSourceWithLiteParseFallback({
    convertWithLiteParse: async () => {
      throw new Error("native parser unavailable");
    },
    prepareLiteParseSource: async () => ["liteparse"],
    preparePdfJsSource: async () => {
      pdfJsCalls += 1;
      return ["pdfjs"];
    },
  });

  assert.deepEqual(prepared, { parser: "pdfjs", prepared: ["pdfjs"] });
  assert.equal(pdfJsCalls, 1);
});
