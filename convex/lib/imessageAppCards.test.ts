import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { mintImessageAppCards } from "./imessageAppCards";

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
    const { ctx, runMutation } = appCardContext("https://glass.test/card");

    await expect(
      mintImessageAppCards(ctx, {
        ...appCardArgs,
        org: { type: "client" },
      }),
    ).resolves.toEqual([]);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("mints links when the organization enables the beta flag", async () => {
    const { ctx, runMutation } = appCardContext("https://glass.test/card");

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
        subtitle: "Open this policy in Glass",
        summary: "Here's the policy link in Glass:",
        url: "https://glass.test/card",
      },
    ]);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
});
