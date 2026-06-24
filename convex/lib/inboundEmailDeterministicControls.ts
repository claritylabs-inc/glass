"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildEmailDraftTextSummary,
  isSendAllEmailDraftsIntent,
  isShowMoreEmailDraftIntent,
} from "./emailDraftSummary";

export type InboundEmailDeterministicControlResult = {
  responseBody: string;
};

export type InboundEmailDraftControl = Pick<
  Doc<"pendingEmails">,
  | "_id"
  | "recipientEmail"
  | "subject"
  | "emailBody"
  | "attachments"
  | "ccAddresses"
  | "bccAddresses"
>;

type InboundEmailControlCtx = {
  runAction(
    action: typeof internal.actions.sendPendingEmail.sendDraftInternal,
    args: { id: Id<"pendingEmails"> },
  ): Promise<unknown>;
};

export async function runInboundEmailDeterministicControls(
  ctx: InboundEmailControlCtx,
  args: {
    messageText: string;
    draftEmails: InboundEmailDraftControl[];
    maxControlTextLength?: number;
  },
): Promise<InboundEmailDeterministicControlResult | null> {
  if (args.draftEmails.length === 0) return null;

  const text = args.messageText.trim();
  if (text.length >= (args.maxControlTextLength ?? 120)) return null;

  if (isShowMoreEmailDraftIntent(text)) {
    return {
      responseBody: buildEmailDraftTextSummary(args.draftEmails, {
        sampleSize: args.draftEmails.length,
        includeBodyPreview: true,
        commands: "chat",
      }),
    };
  }

  if (!isSendAllEmailDraftsIntent(text)) return null;

  let sentCount = 0;
  const failed: string[] = [];
  for (const draftEmail of args.draftEmails) {
    try {
      await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
        id: draftEmail._id,
      });
      sentCount += 1;
    } catch (err) {
      failed.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    responseBody:
      failed.length === 0
        ? sentCount === 1
          ? "Sent the draft email."
          : `Sent ${sentCount} draft emails.`
        : `Sent ${sentCount} draft email${sentCount === 1 ? "" : "s"}; ${failed.length} failed. ${failed[0]}`,
  };
}
