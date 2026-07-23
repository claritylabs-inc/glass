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
    expect(buildEmailReviewNotificationCopy(3, 3)).toEqual({
      title: "3 emails need your review",
      body: "While reviewing your emails, Glass couldn't categorize 3 of them. Review them in Glass and choose how each email should be handled.",
    });
    expect(buildEmailReviewNotificationCopy(1, 1)).toEqual({
      title: "1 email needs your review",
      body: "While reviewing your emails, Glass couldn't categorize one of them. Review it in Glass and choose how it should be handled.",
    });
  });

  test("uses generic copy when review includes processing failures", () => {
    expect(buildEmailReviewNotificationCopy(3, 2)).toEqual({
      title: "3 emails need your review",
      body: "Glass found 3 emails that need review. Open them in Glass to see what happened and choose how they should be handled.",
    });
    expect(buildEmailReviewNotificationCopy(1, 0)).toEqual({
      title: "1 email needs your review",
      body: "Glass found an email that needs review. Open it in Glass to see what happened and choose how it should be handled.",
    });
  });
});
