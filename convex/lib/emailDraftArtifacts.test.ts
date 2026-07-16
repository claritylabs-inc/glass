import { describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { queueEmailDraftArtifact } from "./emailDraftArtifacts";

describe("queueEmailDraftArtifact", () => {
  test("updates and schedules the existing recipient draft instead of creating a second row", async () => {
    const draftId = "draft" as Id<"pendingEmails">;
    const threadId = "thread" as Id<"threads">;
    const agentMessageId = "agent-message" as Id<"threadMessages">;
    const emailMessageId = "email-message" as Id<"threadMessages">;
    const runQuery = vi.fn().mockResolvedValue({
      _id: draftId,
      threadMessageId: emailMessageId,
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const result = await queueEmailDraftArtifact(
      ctx,
      {
        orgId: "org" as Id<"organizations">,
        threadId,
        chatMessageId: agentMessageId,
        channel: "web",
        fromHeader: "Glass <agent@glass.insure>",
        agentAddress: "agent@glass.insure",
      },
      {
        to: "terry@releaserent.com",
        cc: [],
        bcc: [],
        subject: "Corrected certificate",
        body: "Attached is the corrected certificate.",
        attachments: [
          {
            filename: "corrected-coi.pdf",
            contentType: "application/pdf",
            size: 1024,
            fileId: "file" as Id<"_storage">,
          },
        ],
        scheduledSendTime: 1234,
      },
    );

    expect(result).toBe(draftId);
    expect(runMutation).toHaveBeenCalledWith(
      internal.pendingEmails.updateDraftInternal,
      expect.objectContaining({
        id: draftId,
        subject: "Corrected certificate",
        attachments: [
          expect.objectContaining({ filename: "corrected-coi.pdf" }),
        ],
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      internal.threads.updateEmailMessage,
      expect.objectContaining({
        id: emailMessageId,
        pendingEmailId: draftId,
        status: "draft_email",
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      internal.pendingEmails.scheduleDraftInternal,
      { id: draftId, scheduledSendTime: 1234 },
    );
    expect(
      runMutation.mock.calls.some(
        ([mutation]) => mutation === internal.pendingEmails.create,
      ),
    ).toBe(false);
  });
});
