"use node";

import type { Doc } from "../_generated/dataModel";
import {
  executeEmailCommand,
  type EmailCommandDraft,
  type EmailCommandExecutionCtx,
} from "./emailCommandExecutor";
import { resolveTextChannelEmailControl } from "./textChannelControls";

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
  | "sendBlockedReason"
>;

type InboundEmailControlCtx = EmailCommandExecutionCtx;

export async function runInboundEmailDeterministicControls(
  ctx: InboundEmailControlCtx,
  args: {
    messageText: string;
    draftEmails: InboundEmailDraftControl[];
    maxControlTextLength?: number;
  },
): Promise<InboundEmailDeterministicControlResult | null> {
  if (args.draftEmails.length === 0) return null;
  const command = resolveTextChannelEmailControl({
    messageText: args.messageText,
    isCancelConfirmationContext: false,
    draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
    pendingEmailIds: [],
    allowDraftList: true,
    allowDraftSendAll: true,
    maxControlTextLength: args.maxControlTextLength ?? 120,
  });
  if (
    !command ||
    ![
      "show_draft_emails",
      "update_single_draft_recipient",
      "send_draft_emails",
    ].includes(command.kind)
  ) {
    return null;
  }

  const result = await executeEmailCommand(ctx, command, {
    draftEmails: args.draftEmails as EmailCommandDraft[],
    includeBodyPreview: true,
    continueOnSendFailure: true,
  });
  return { responseBody: result.responseBody };
}
