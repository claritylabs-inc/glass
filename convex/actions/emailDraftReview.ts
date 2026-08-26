"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export const send = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ status: "sent" }> => {
    let linkId: Id<"emailDraftReviewLinks"> | undefined;
    try {
      const claim = await ctx.runMutation(
        internal.emailDraftReviewLinks.claimSendInternal,
        { token: args.token },
      );
      linkId = claim.linkId;
      if (claim.confirmationStatus === "pending") {
        const confirmationResult = await ctx.runMutation(
          internal.threadActionConfirmations.consumeInternal,
          {
            id: claim.confirmationId,
            actor: claim.actor,
            requireAdjacentPrompt: false,
          },
        );
        if (confirmationResult !== "completed") {
          throw new Error(
            confirmationResult === "expired"
              ? "This draft confirmation expired. Ask Glass to show the draft again."
              : "This draft changed. Ask Glass to show the current draft again.",
          );
        }
      }

      await ctx.runAction(
        internal.actions.sendPendingEmail.sendDraftInternal,
        {
          id: claim.pendingEmailId,
          authorization: {
            kind: "confirmation",
            confirmationId: claim.confirmationId,
          },
        },
      );
      await ctx.runMutation(
        internal.emailDraftReviewLinks.completeSendInternal,
        { id: claim.linkId },
      );
      return { status: "sent" };
    } catch (error) {
      if (linkId) {
        await ctx.runMutation(
          internal.emailDraftReviewLinks.releaseSendInternal,
          {
            id: linkId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      throw error;
    }
  },
});
