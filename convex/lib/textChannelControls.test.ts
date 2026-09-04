import { describe, expect, test } from "vitest";
import { resolveTextChannelEmailControl } from "./textChannelControls";

describe("resolveTextChannelEmailControl", () => {

  test("does not approve a draft that was not attached to the preceding response", () => {
    expect(
      resolveTextChannelEmailControl({
        messageText: "send",
        isCancelConfirmationContext: false,
        draftEmailIds: ["stale-draft"],
        draftApprovalEmailIds: [],
        pendingEmailIds: [],
        allowDraftApproval: true,
      }),
    ).toBeNull();

    expect(
      resolveTextChannelEmailControl({
        messageText: "ReLease Coverage Company, Inc. is correct. Send please",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        draftApprovalEmailIds: ["draft"],
        pendingEmailIds: [],
        allowDraftApproval: true,
      }),
    ).toBeNull();
  });
});
