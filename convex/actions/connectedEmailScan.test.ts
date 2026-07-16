// @vitest-environment node

import { describe, expect, test } from "vitest";
import {
  buildEmailReviewNotificationCopy,
  buildMailboxActivityBody,
} from "./connectedEmailScan";

describe("connected mailbox activity", () => {
  test("preserves actionable compliance subjects and reasons", () => {
    const body = buildMailboxActivityBody([], [
      {
        kind: "compliance",
        subject: "Commercial general liability",
        reason: "Per-occurrence limit is below the required amount.",
      },
      {
        kind: "compliance",
        subject: "Workers compensation",
        reason: "Coverage could not be verified.",
      },
    ]);

    expect(body).toContain("2 compliance items need attention:");
    expect(body).toContain(
      "- Commercial general liability: Per-occurrence limit is below the required amount.",
    );
    expect(body).toContain(
      "- Workers compensation: Coverage could not be verified.",
    );
  });

  test("explains why uncategorized emails need review", () => {
    expect(buildEmailReviewNotificationCopy(3)).toEqual({
      title: "3 emails need your review",
      body: "While reviewing your emails, Glass couldn't categorize 3 of them. Review them in Glass and choose how each email should be handled.",
    });
    expect(buildEmailReviewNotificationCopy(1)).toEqual({
      title: "1 email needs your review",
      body: "While reviewing your emails, Glass couldn't categorize one of them. Review it in Glass and choose how it should be handled.",
    });
  });
});
