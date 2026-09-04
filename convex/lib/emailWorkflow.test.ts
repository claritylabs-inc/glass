import { describe, expect, test } from "vitest";
import {
  getEmailDraftBlockers,
  getEmailDraftSendability,
} from "./emailWorkflow";

describe("email draft sendability", () => {
  test("blocks missing required fields", () => {
    const blockers = getEmailDraftBlockers({
      status: "draft",
      recipientEmail: "",
      subject: "",
      emailBody: "",
    });

    expect(blockers.map((blocker) => blocker.code)).toEqual([
      "missing_recipient",
      "missing_subject",
      "missing_body",
    ]);
  });

  test("treats an explicit send as confirmation without bypassing required fields", () => {
    expect(
      getEmailDraftSendability(
        {
          status: "draft",
          recipientEmail: "terry@releaserent.com",
          subject: "Policy documents",
          emailBody: "Attached.",
          sendBlockedReason:
            "Confirm that terry@releaserent.com is the intended recipient.",
        },
        { confirmationGranted: true },
      ),
    ).toEqual({ status: "sendable", blockers: [] });

    expect(
      getEmailDraftBlockers(
        {
          status: "draft",
          recipientEmail: "",
          subject: "Policy documents",
          emailBody: "Attached.",
          sendBlockedReason: "Confirm the recipient.",
        },
        { confirmationGranted: true },
      ).map((blocker) => blocker.code),
    ).toEqual(["missing_recipient"]);
  });
});
