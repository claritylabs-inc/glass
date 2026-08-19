import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toSlackMarkdown, toSlackMrkdwn } from "../src/mrkdwn.js";

describe("Slack mrkdwn formatting", () => {
  test("converts common Markdown without changing Slack mentions", () => {
    assert.equal(
      toSlackMrkdwn(
        "## Policy\n**Carrier:** Acme with *review notes*\n[Open policy](https://example.test/policy) <@U123>",
      ),
      "*Policy*\n*Carrier:* Acme with _review notes_\n<https://example.test/policy|Open policy> <@U123>",
    );
  });

  test("removes Glass confidence markers", () => {
    assert.equal(
      toSlackMrkdwn("[[g:Confirmed]] and [[i]:likely]]"),
      "Confirmed and likely",
    );
  });

  test("removes progress narration and emoji from agent answers", () => {
    assert.equal(
      toSlackMrkdwn(
        "I'll check the policy now.\n\n✅ :white_check_mark: **Policy:** active through renewal.",
      ),
      "*Policy:* active through renewal.",
    );
  });

  test("preserves CommonMark for Slack streaming compatibility", () => {
    assert.equal(
      toSlackMarkdown("[[g:✅ :white_check_mark: **Policy:** active]]"),
      "**Policy:** active",
    );
  });
});
