// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  consumeLocalEmailCaptures,
  formatLocalEmailCapture,
} from "../scripts/watch-conductor-email-captures.mjs";

describe("Conductor email capture watcher", () => {
  it("extracts OTPs and delivery context from Convex multiline logs", () => {
    const result = consumeLocalEmailCaptures(`
8/7/2026 [CONVEX A(auth)] [LOG] '[spot:local-email-capture]
kind: email
from: Spot <noreply@auth.spot.insure>
to: person@example.com
cc: (none)
bcc: (none)
subject: Your Spot sign-in code
codeCandidates: 123456
attachmentCount: 0
`);

    expect(result.captures).toEqual([
      {
        kind: "email",
        to: "person@example.com",
        subject: "Your Spot sign-in code",
        codes: ["123456"],
      },
    ]);
    expect(formatLocalEmailCapture(result.captures[0])).toContain(
      "OTP: 123456",
    );
  });

  it("handles escaped Convex log lines and captures non-OTP deliveries", () => {
    const result = consumeLocalEmailCaptures(
      "[LOG] '[spot:local-email-capture]\\nkind: email\\nto: client@example.com\\nsubject: Policy ready\\ncodeCandidates: (none)\\nattachmentCount: 1'",
    );

    expect(result.captures).toEqual([
      {
        kind: "email",
        to: "client@example.com",
        subject: "Policy ready",
        codes: [],
      },
    ]);
    expect(formatLocalEmailCapture(result.captures[0])).not.toContain("OTP:");
  });

  it("retains an incomplete capture until the candidate line arrives", () => {
    const first = consumeLocalEmailCaptures(
      "noise [spot:local-email-capture]\\nkind: suppressed-invite-otp\\nto: invitee@example.com\\n",
    );
    expect(first.captures).toEqual([]);

    const second = consumeLocalEmailCaptures(
      `${first.remainder}subject: Suppressed invite OTP\\ncodeCandidates: 654321\\nattachmentCount: 0`,
    );
    expect(second.captures).toEqual([
      {
        kind: "suppressed-invite-otp",
        to: "invitee@example.com",
        subject: "Suppressed invite OTP",
        codes: ["654321"],
      },
    ]);
  });
});
