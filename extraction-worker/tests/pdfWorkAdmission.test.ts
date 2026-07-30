import assert from "node:assert/strict";
import { test } from "node:test";

import { createPdfWorkAdmission } from "../src/pdfWorkAdmission.js";

test("reserves active capacity for preview and HTTP PDF work", async () => {
  const admission = createPdfWorkAdmission({
    maxActive: 3,
    maxFullActive: 1,
  });
  const releaseFirstFull = await admission.acquire("full");
  const secondFull = admission.acquire("full");
  const releaseHttp = await admission.acquire("http");
  const releasePreview = await admission.acquire("preview");

  assert.deepEqual(admission.snapshot(), {
    active: 3,
    activeFull: 1,
    waiting: {
      http: 0,
      preview: 0,
      full: 1,
    },
  });

  releaseFirstFull();
  const releaseSecondFull = await secondFull;
  assert.deepEqual(admission.snapshot(), {
    active: 3,
    activeFull: 1,
    waiting: {
      http: 0,
      preview: 0,
      full: 0,
    },
  });

  releaseSecondFull();
  releaseHttp();
  releasePreview();
});

test("drops an aborted waiter without consuming admission", async () => {
  const admission = createPdfWorkAdmission({
    maxActive: 1,
    maxFullActive: 1,
  });
  const release = await admission.acquire("full");
  const controller = new AbortController();
  const waiting = admission.acquire("http", controller.signal);

  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.deepEqual(admission.snapshot(), {
    active: 1,
    activeFull: 1,
    waiting: {
      http: 0,
      preview: 0,
      full: 0,
    },
  });

  release();
});
