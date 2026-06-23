import { describe, expect, test } from "vitest";
import { resolveTextChannelEmailControl } from "./textChannelControls";

describe("resolveTextChannelEmailControl", () => {
  test("restores the latest cancelled email before considering active drafts", () => {
    expect(
      resolveTextChannelEmailControl({
        messageText: "restore it",
        isCancelConfirmationContext: true,
        latestCancelledEmailId: "cancelled",
        draftEmailIds: ["draft"],
        pendingEmailIds: ["pending"],
      }),
    ).toEqual({ kind: "restore_cancelled_email", emailId: "cancelled" });
  });

  test("routes cancel confirmation to draft emails before pending emails", () => {
    expect(
      resolveTextChannelEmailControl({
        messageText: "yes cancel",
        isCancelConfirmationContext: true,
        draftEmailIds: ["draft-a", "draft-b"],
        pendingEmailIds: ["pending"],
      }),
    ).toEqual({
      kind: "cancel_draft_emails",
      emailIds: ["draft-a", "draft-b"],
    });
  });

  test("uses channel flags for draft list and send-all controls", () => {
    expect(
      resolveTextChannelEmailControl({
        messageText: "show more",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        pendingEmailIds: [],
        allowDraftList: true,
      }),
    ).toEqual({ kind: "show_draft_emails" });

    expect(
      resolveTextChannelEmailControl({
        messageText: "send it",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        pendingEmailIds: [],
        allowDraftApproval: true,
      }),
    ).toEqual({ kind: "send_draft_emails", emailIds: ["draft"] });

    expect(
      resolveTextChannelEmailControl({
        messageText: "send it",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        pendingEmailIds: [],
      }),
    ).toBeNull();
  });

  test("ignores long messages", () => {
    expect(
      resolveTextChannelEmailControl({
        messageText: "cancel ".repeat(30),
        isCancelConfirmationContext: true,
        draftEmailIds: ["draft"],
        pendingEmailIds: [],
      }),
    ).toBeNull();
  });
});
