import { describe, expect, test } from "vitest";
import {
  formatEmailDraftBlockers,
  getEmailDraftBlockers,
  getEmailDraftSendability,
} from "./emailWorkflow";

describe("email draft sendability", () => {
  test("allows complete draft rows", () => {
    expect(
      getEmailDraftSendability({
        status: "draft",
        recipientEmail: "terry@claritylabs.inc",
        subject: "Policy documents",
        emailBody: "Attached.",
      }),
    ).toEqual({ status: "sendable", blockers: [] });
  });

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

  test("blocks drafts requiring explicit recipient confirmation", () => {
    const sendability = getEmailDraftSendability({
      status: "draft",
      recipientEmail: "erry@claritylabs.inc",
      subject: "Policy documents",
      emailBody: "Attached.",
      sendBlockedReason:
        "Confirm that erry@claritylabs.inc is the intended recipient.",
    });

    expect(sendability.status).toBe("blocked");
    expect(
      sendability.status === "blocked"
        ? formatEmailDraftBlockers(sendability.blockers)
        : "",
    ).toContain("Confirm that erry@claritylabs.inc");
  });

  test("honors send-time status allowlists", () => {
    expect(
      getEmailDraftBlockers(
        {
          status: "pending",
          recipientEmail: "terry@claritylabs.inc",
          subject: "Policy documents",
          emailBody: "Attached.",
        },
        { allowedStatuses: ["draft"] },
      ),
    ).toEqual([
      {
        code: "invalid_status",
        message: "Draft status is pending.",
      },
    ]);
  });
});
