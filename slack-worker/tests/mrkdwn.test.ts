import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toSlackMrkdwn } from "../src/mrkdwn.js";

describe("Slack mrkdwn formatting", () => {
  test("converts common Markdown without changing Slack mentions", () => {
    assert.equal(
      toSlackMrkdwn(
        "## Policy\n**Carrier:** Acme\n[Open policy](https://example.test/policy) <@U123>",
      ),
      "*Policy*\n*Carrier:* Acme\n<https://example.test/policy|Open policy> <@U123>",
    );
  });

  test("removes Glass confidence markers", () => {
    assert.equal(
      toSlackMrkdwn("[[g:Confirmed]] and [[i]:likely]]"),
      "Confirmed and likely",
    );
  });
});
