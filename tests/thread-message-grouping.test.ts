import { describe, expect, test } from "vitest";
import { threadMessageGroupingFingerprint } from "@/components/agent-thread/thread-content";
import type { ThreadMessage } from "@/components/agent-thread/types";
import type { Id } from "@/convex/_generated/dataModel";

function message(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    _id: "message-1" as Id<"threadMessages">,
    _creationTime: 1,
    threadId: "thread-1" as Id<"threads">,
    orgId: "org-1" as Id<"organizations">,
    channel: "email",
    role: "agent",
    content: "Draft body",
    status: "draft_email",
    toAddresses: ["client@example.com"],
    subject: "Policy follow-up",
    attachments: [],
    ...overrides,
  };
}

describe("thread message grouping fingerprint", () => {
  const threadId = "thread-1" as Id<"threads">;

  test.each([
    { subject: "Updated subject" },
    { content: "Updated body" },
    { toAddresses: ["updated@example.com"] },
    {
      attachments: [
        {
          filename: "policy.pdf",
          contentType: "application/pdf",
          size: 100,
        },
      ],
    },
  ] satisfies Array<Partial<ThreadMessage>>)(
    "changes when a settled email draft changes",
    (change) => {
      expect(threadMessageGroupingFingerprint(threadId, [message(change)])).not.toBe(
        threadMessageGroupingFingerprint(threadId, [message()]),
      );
    },
  );

  test("ignores streaming content changes until the message settles", () => {
    expect(
      threadMessageGroupingFingerprint(threadId, [
        message({ channel: "chat", status: "processing", content: "One" }),
      ]),
    ).toBe(
      threadMessageGroupingFingerprint(threadId, [
        message({ channel: "chat", status: "processing", content: "Two" }),
      ]),
    );
  });
});
