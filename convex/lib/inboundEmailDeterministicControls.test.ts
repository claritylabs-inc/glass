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
  test("shows all draft details before invoking the model", async () => {
    const ctx = {
      runAction: vi.fn(async () => null),
      runMutation: vi.fn(async () => null),
    };

    await expect(
      runInboundEmailDeterministicControls(ctx, {
        messageText: "show more",
        draftEmails: [draft("draft-1"), draft("draft-2", "Renewal note")],
      }),
    ).resolves.toMatchObject({
      responseBody: expect.stringContaining("I have 2 email drafts ready."),
    });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

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

  test("updates a single draft recipient from a standalone email address", async () => {
    const updated = {
      ...draft("draft-1"),
      _creationTime: 1,
      orgId: "org-1" as Id<"organizations">,
      status: "draft" as const,
      emailPayload: "{}",
      scheduledSendTime: 0,
      recipientEmail: "terry@claritylabs.inc",
    };
    const ctx = {
      runAction: vi.fn(async () => null),
      runMutation: vi.fn(async () => updated),
    };

    await expect(
      runInboundEmailDeterministicControls(ctx, {
        messageText: "Terry@claritylabs.inc",
        draftEmails: [draft("draft-1")],
      }),
    ).resolves.toMatchObject({
      responseBody: expect.stringContaining("terry@claritylabs.inc"),
    });
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      id: "draft-1",
      recipientEmail: "terry@claritylabs.inc",
    });
  });

  test("ignores unrelated messages", async () => {
    const ctx = {
      runAction: vi.fn(async () => null),
      runMutation: vi.fn(async () => null),
    };

    await expect(
      runInboundEmailDeterministicControls(ctx, {
        messageText: "what are the limits on this policy?",
        draftEmails: [draft("draft-1")],
      }),
    ).resolves.toBeNull();
  });
});
