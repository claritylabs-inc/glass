import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  runInboundEmailDeterministicControls,
  type InboundEmailDraftControl,
} from "./inboundEmailDeterministicControls";

function draft(
  id: string,
  subject = "Coverage update",
): InboundEmailDraftControl {
  return {
    _id: id as Id<"pendingEmails">,
    recipientEmail: "client@example.com",
    subject,
    emailBody: "Here is the update.",
    attachments: [],
  };
}

describe("runInboundEmailDeterministicControls", () => {

  test("does not send thread-global drafts from a prose command", async () => {
    const ctx = {
      runAction: vi.fn(async () => null),
      runMutation: vi.fn(async () => null),
    };

    await expect(
      runInboundEmailDeterministicControls(ctx, {
        messageText: "send all",
        draftEmails: [draft("draft-1"), draft("draft-2")],
      }),
    ).resolves.toBeNull();
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
