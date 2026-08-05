import test from "node:test";
import assert from "node:assert/strict";
import { SendIdempotency } from "../src/idempotency.js";

test("deduplicates completed sends and releases failed claims", () => {
  const ledger = new SendIdempotency();
  assert.deepEqual(ledger.claim("message-1"), { claimed: true });
  assert.deepEqual(ledger.claim("message-1"), { claimed: false });
  ledger.release("message-1");
  assert.deepEqual(ledger.claim("message-1"), { claimed: true });

  const result = { messageId: "123.456", attachmentFailures: [] };
  ledger.complete("message-1", result);
  assert.deepEqual(ledger.claim("message-1"), {
    claimed: false,
    result,
  });
});
