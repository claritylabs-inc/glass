// @vitest-environment node

import { describe, expect, test } from "vitest";
import { buildMailboxActivityBody } from "./connectedEmailScan";

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
});
