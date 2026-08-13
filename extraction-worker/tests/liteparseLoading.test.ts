import assert from "node:assert/strict";
import test from "node:test";

test("the worker can load before the optional LiteParse native binary", async () => {
  await assert.doesNotReject(() => import("../src/liteparse.js"));
});
