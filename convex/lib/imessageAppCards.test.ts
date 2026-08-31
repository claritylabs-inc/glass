import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  mintImessageAppCards,
  mintImessageEmailDraftReviewCard,
} from "./imessageAppCards";

function appCardContext(createUrl: string) {
  const runMutation = vi.fn().mockResolvedValue({ url: createUrl });
  return {
    ctx: { runMutation } as unknown as ActionCtx,
    runMutation,
  };
}

const appCardArgs = {
  threadId: "thread-1" as Id<"threads">,
  createdByUserId: "user-1" as Id<"users">,
  presentedPolicyIds: ["policy-1" as Id<"policies">],
  artifacts: [],
};

describe("iMessage app card delivery", () => {
  test("does not mint public links when the beta flag is absent", async () => {
    const { ctx, runMutation } = appCardContext("https://spot.test/card");

    await expect(
      mintImessageAppCards(ctx, {
        ...appCardArgs,
        org: { type: "client" },
      }),
    ).resolves.toEqual([]);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("mints links when the organization enables the beta flag", async () => {
    const { ctx, runMutation } = appCardContext("https://spot.test/card");

    await expect(
      mintImessageAppCards(ctx, {
        ...appCardArgs,
        org: {
          type: "broker",
          featureFlags: { imessage_app_cards: true },
        },
      }),
    ).resolves.toEqual([
      {
        title: "Policy link",
        subtitle: "Open this policy in Spot",
        summary: "Here's the policy link in Spot:",
        url: "https://spot.test/card",
      },
    ]);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("mints email draft cards without the policy-card beta flag", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      _id: "draft-1",
      status: "draft",
      threadId: appCardArgs.threadId,
      recipientEmail: "recipient@example.com",
      subject: "Certificate of insurance",
    });
    const runMutation = vi.fn().mockResolvedValue({
      url: "https://spot.test/share/email/token",
    });
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    await expect(
      mintImessageEmailDraftReviewCard(ctx, {
        pendingEmailId: "draft-1" as Id<"pendingEmails">,
        threadId: appCardArgs.threadId,
      }),
    ).resolves.toEqual({
      title: "Email draft",
      subtitle: "To recipient@example.com",
      summary: "Certificate of insurance",
      url: "https://spot.test/share/email/token",
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
});
