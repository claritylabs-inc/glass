"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { getAgentDomain } from "../lib/resend";
import {
  buildPendingEmailResendPayload,
  sendTrackedResendEmail,
  toResendAttachments,
} from "../lib/emailDelivery";
import {
  countCoiAttachments,
  shouldBlockUnapprovedCoiAttachmentBatch,
} from "../lib/coiAttachmentGuards";
import { pendingEmailDraftFingerprint } from "../lib/actionConfirmationFingerprint";
import { sendOutboundImessage } from "../lib/imessageOutbound";
import {
  formatEmailDraftBlockers,
  getEmailDraftSendability,
} from "../lib/emailWorkflow";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

type SendEmailResult = { recipientEmail: string } | null;
type BulkDraftSendResult = {
  sent: Array<{ id: Id<"pendingEmails">; recipientEmail: string }>;
  failed: Array<{ id: Id<"pendingEmails">; error: string }>;
};

const draftSendAuthorizationValidator = v.union(
  v.object({
    kind: v.literal("confirmation"),
    confirmationId: v.id("threadActionConfirmations"),
  }),
  v.object({ kind: v.literal("scheduled") }),
  v.object({ kind: v.literal("organization_auto_send") }),
  v.object({ kind: v.literal("mcp_explicit_action") }),
);

type DraftSendAuthorization =
  | {
      kind: "confirmation";
      confirmationId: Id<"threadActionConfirmations">;
    }
  | { kind: "scheduled" }
  | { kind: "organization_auto_send" }
  | { kind: "mcp_explicit_action" };

async function authorizeExplicitDraftSelection(
  ctx: ActionCtx,
  drafts: Array<Doc<"pendingEmails">>,
  actorUserId: Id<"users">,
) {
  const threadId = drafts[0]?.threadId;
  if (!threadId || drafts.some((draft) => draft.threadId !== threadId)) {
    throw new Error("Explicit send confirmation requires one thread.");
  }
  const fingerprints = await Promise.all(
    drafts.map((draft) => pendingEmailDraftFingerprint(draft)),
  );
  const promptMessageId = await ctx.runMutation(
    internal.threads.insertWorkflowStatusMessage,
    {
      orgId: drafts[0].orgId,
      threadId,
      sourceThreadMessageId: drafts[0].chatMessageId,
      dedupeKey: `explicit-email-send:${drafts.map((draft) => String(draft._id)).join(",")}:${fingerprints.join(",")}`,
      content: `Explicit send selected for ${drafts.map((draft) => `${draft.recipientEmail} — ${draft.subject}`).join("; ")}.`,
    },
  );
  const confirmationId = await ctx.runMutation(
    internal.threadActionConfirmations.createInternal,
    {
      orgId: drafts[0].orgId,
      threadId,
      actor: { kind: "user", userId: actorUserId },
      promptMessageId,
      payload: {
        kind: "email_send",
        pendingEmailIds: drafts.map((draft) => draft._id),
        draftFingerprints: fingerprints,
      },
    },
  );
  const sendConfirmation = await ctx.runMutation(
    internal.threadActionConfirmations.consumeInternal,
    {
      id: confirmationId,
      actor: { kind: "user", userId: actorUserId },
      requireAdjacentPrompt: false,
    },
  );
  if (sendConfirmation !== "completed") {
    throw new Error(`Email confirmation ${sendConfirmation}.`);
  }

  for (const [index, draft] of drafts.entries()) {
    if (countCoiAttachments(draft.attachments) <= 1) continue;
    const batchPromptMessageId = await ctx.runMutation(
      internal.threads.insertWorkflowStatusMessage,
      {
        orgId: draft.orgId,
        threadId,
        sourceThreadMessageId: draft.chatMessageId,
        pendingEmailId: draft._id,
        dedupeKey: `explicit-coi-batch:${String(draft._id)}:${fingerprints[index]}`,
        content: `Explicitly confirmed ${draft.attachments?.length ?? 0} attachments for ${draft.recipientEmail}.`,
      },
    );
    const batchConfirmationId = await ctx.runMutation(
      internal.threadActionConfirmations.createInternal,
      {
        orgId: draft.orgId,
        threadId,
        actor: { kind: "user", userId: actorUserId },
        promptMessageId: batchPromptMessageId,
        payload: {
          kind: "coi_batch_delivery",
          pendingEmailId: draft._id,
          recipientEmail: draft.recipientEmail.trim().toLowerCase(),
          fileIds: (draft.attachments ?? []).map(({ fileId }) => fileId),
          draftFingerprint: fingerprints[index],
        },
      },
    );
    const batchConfirmation = await ctx.runMutation(
      internal.threadActionConfirmations.consumeInternal,
      {
        id: batchConfirmationId,
        actor: { kind: "user", userId: actorUserId },
        requireAdjacentPrompt: false,
      },
    );
    if (batchConfirmation !== "completed") {
      throw new Error(`COI batch confirmation ${batchConfirmation}.`);
    }
  }
  return confirmationId;
}

async function assertDraftSendAuthorization(
  ctx: ActionCtx,
  pending: Doc<"pendingEmails">,
  authorization: DraftSendAuthorization,
) {
  if (authorization.kind === "scheduled") {
    if (pending.status !== "pending" || !pending.scheduledSendTime) {
      throw new Error(
        "Scheduled email authorization is not valid for this draft.",
      );
    }
    return;
  }
  if (authorization.kind === "organization_auto_send") {
    const org = await ctx.runQuery(internal.orgs.getInternal, {
      id: pending.orgId,
    });
    if (org?.autoSendEmails !== true) {
      throw new Error("Organization auto-send is not enabled.");
    }
    return;
  }
  if (authorization.kind === "mcp_explicit_action") {
    if (pending.status !== "draft") {
      throw new Error("MCP explicit send requires a current draft.");
    }
    return;
  }

  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.getInternal,
    { id: authorization.confirmationId },
  );
  if (
    !confirmation ||
    confirmation.status !== "completed" ||
    confirmation.orgId !== pending.orgId ||
    confirmation.threadId !== pending.threadId ||
    (confirmation.payload.kind !== "email_send" &&
      confirmation.payload.kind !== "draft_snapshot" &&
      confirmation.payload.kind !== "coi_batch_delivery")
  ) {
    throw new Error(
      "A completed confirmation for this exact draft is required.",
    );
  }
  if (confirmation.payload.kind === "coi_batch_delivery") {
    if (
      confirmation.payload.pendingEmailId !== pending._id ||
      confirmation.payload.draftFingerprint !==
        (await pendingEmailDraftFingerprint(pending))
    ) {
      throw new Error(
        "The confirmed COI batch changed and must be reviewed again.",
      );
    }
    return;
  }
  const index = confirmation.payload.pendingEmailIds.findIndex(
    (id) => id === pending._id,
  );
  if (
    index < 0 ||
    confirmation.payload.draftFingerprints[index] !==
      (await pendingEmailDraftFingerprint(pending))
  ) {
    throw new Error("The confirmed draft changed and must be reviewed again.");
  }
}

async function hasExactCoiBatchAuthorization(
  ctx: ActionCtx,
  pending: Doc<"pendingEmails">,
) {
  const authorization = pending.coiBatchAuthorization;
  if (!authorization) return false;
  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.getInternal,
    { id: authorization.confirmationId },
  );
  if (
    !confirmation ||
    confirmation.status !== "completed" ||
    confirmation.payload.kind !== "coi_batch_delivery" ||
    confirmation.payload.pendingEmailId !== pending._id
  ) {
    return false;
  }
  const confirmationPayload = confirmation.payload;
  const recipientEmail = pending.recipientEmail.trim().toLowerCase();
  const fileIds = (pending.attachments ?? []).map(({ fileId }) =>
    String(fileId),
  );
  const confirmingActorMatches =
    authorization.confirmedBy.kind === confirmation.actor.kind &&
    authorization.confirmedBy.userId === confirmation.actor.userId &&
    authorization.confirmedBy.address === confirmation.actor.address &&
    authorization.confirmedBy.slackActorId === confirmation.actor.slackActorId;
  return (
    confirmingActorMatches &&
    authorization.recipientEmail === recipientEmail &&
    confirmationPayload.recipientEmail === recipientEmail &&
    authorization.draftFingerprint ===
      (await pendingEmailDraftFingerprint(pending)) &&
    authorization.draftFingerprint === confirmationPayload.draftFingerprint &&
    fileIds.length === authorization.fileIds.length &&
    fileIds.length === confirmationPayload.fileIds.length &&
    fileIds.every(
      (fileId, index) =>
        fileId === String(authorization.fileIds[index]) &&
        fileId === String(confirmationPayload.fileIds[index]),
    )
  );
}

async function assertSafeDraftAttachments(
  ctx: ActionCtx,
  pending: Doc<"pendingEmails">,
) {
  const hasExactBatchAuthorization = await hasExactCoiBatchAuthorization(
    ctx,
    pending,
  );
  if (
    shouldBlockUnapprovedCoiAttachmentBatch({
      attachments: pending.attachments,
      hasExactBatchAuthorization,
    })
  ) {
    throw new Error(
      "This multi-COI draft needs confirmation for its exact recipient and attachment list before sending.",
    );
  }
  if (
    pending.allowMultipleCoiAttachments === true &&
    !hasExactBatchAuthorization
  ) {
    throw new Error(
      "This legacy multi-COI draft must be reconfirmed or regenerated before sending.",
    );
  }
}

function outboundMessageIdForPending(id: Id<"pendingEmails">) {
  return `<glass-pending-${String(id)}@${getAgentDomain()}>`;
}

async function sendTextConfirmation(params: {
  toPhone: string;
  chatGuid?: string;
  message: string;
}): Promise<boolean> {
  return await sendOutboundImessage({
    toPhone: params.toPhone,
    chatGuid: params.chatGuid,
    message: params.message,
    logPrefix: "sendPendingEmail",
  });
}

async function sendPendingEmailById(
  ctx: ActionCtx,
  id: Id<"pendingEmails">,
  options: {
    allowedStatuses: Array<Doc<"pendingEmails">["status"]>;
    updateChatMessage: boolean;
    notifyImessage: boolean;
    authorization: DraftSendAuthorization;
  },
): Promise<SendEmailResult> {
  const pending = (await ctx.runQuery(internal.pendingEmails.getInternal, {
    id,
  })) as Doc<"pendingEmails"> | null;
  if (!pending || !options.allowedStatuses.includes(pending.status)) {
    return null; // cancelled or already sent
  }
  await assertDraftSendAuthorization(ctx, pending, options.authorization);
  const sendability = getEmailDraftSendability(pending, {
    allowedStatuses: options.allowedStatuses,
    confirmationGranted: true,
  });
  if (sendability.status === "blocked") {
    if (
      sendability.blockers.some((blocker) =>
        ["missing_recipient", "missing_subject", "missing_body"].includes(
          blocker.code,
        ),
      )
    ) {
      throw new Error("Draft is missing required email fields.");
    }
    throw new Error(
      `Draft needs confirmation before sending: ${formatEmailDraftBlockers(sendability.blockers)}`,
    );
  }
  await assertSafeDraftAttachments(ctx, pending);

  try {
    const thread = pending.threadId
      ? await ctx.runQuery(internal.threads.getInternal, {
          id: pending.threadId,
        })
      : null;
    const outboundMessageId = outboundMessageIdForPending(id);
    const payload = buildPendingEmailResendPayload(pending, {
      outboundMessageId,
      threadEmail: thread?.threadEmail,
    });
    if (pending.attachments && pending.attachments.length > 0) {
      payload.attachments = await toResendAttachments(ctx, pending.attachments);
    }
    const result = await sendTrackedResendEmail(ctx, {
      source: "pending_email",
      orgId: pending.orgId,
      pendingEmailId: id,
      threadId: pending.threadId,
      threadMessageId: pending.threadMessageId,
      recipientEmail: pending.recipientEmail,
      ccAddresses: pending.ccAddresses,
      bccAddresses: pending.bccAddresses,
      subject: pending.subject,
      messageId: outboundMessageId,
      payload,
    });
    if (!result.ok) throw new Error(`Failed to send email: ${result.error}`);
    const sentMessageId = result.id;

    // Mark as sent
    await ctx.runMutation(internal.pendingEmails.markSent, {
      id,
      sentMessageId,
    });

    if (options.updateChatMessage && pending.chatMessageId) {
      const ccNote =
        pending.ccAddresses && pending.ccAddresses.length > 0
          ? ` (CC: ${pending.ccAddresses.join(", ")})`
          : "";
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: pending.chatMessageId,
        content: `Email sent to ${pending.recipientEmail}${ccNote}.`,
      });
    }

    if (pending.threadId) {
      if (pending.threadMessageId) {
        await ctx.runMutation(internal.threads.updateEmailMessage, {
          id: pending.threadMessageId,
          content: pending.emailBody,
          toAddresses: [pending.recipientEmail],
          ccAddresses: pending.ccAddresses,
          bccAddresses: pending.bccAddresses,
          subject: pending.subject,
          messageId: outboundMessageId,
          responseMessageId: sentMessageId,
          resendEmailId: sentMessageId,
          attachments: pending.attachments,
          clearStatus: true,
        });
      } else {
        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: pending.threadId,
          orgId: pending.orgId,
          role: "agent",
          content: pending.emailBody,
          toAddresses: [pending.recipientEmail],
          ccAddresses: pending.ccAddresses,
          bccAddresses: pending.bccAddresses,
          subject: pending.subject,
          messageId: outboundMessageId,
          responseMessageId: sentMessageId,
          resendEmailId: sentMessageId,
          attachments: pending.attachments,
          pendingEmailId: id,
        });
      }

      if (options.notifyImessage && thread?.threadPhone) {
        const ccNote =
          pending.ccAddresses && pending.ccAddresses.length > 0
            ? ` CC ${pending.ccAddresses.join(", ")}`
            : "";
        const confirmation = `Email sent to ${pending.recipientEmail}.${ccNote}`;
        const sent = await sendTextConfirmation({
          toPhone: thread.threadPhone,
          chatGuid: thread.imessageChatGuid,
          message: confirmation,
        });
        if (sent) {
          await ctx.runMutation(internal.threads.insertImessageMessage, {
            threadId: pending.threadId,
            orgId: pending.orgId,
            role: "agent",
            content: confirmation,
            responseMessageId: `${id}:sent-confirmation`,
            pendingEmailId: id,
          });
        }
      }
    }

    return { recipientEmail: pending.recipientEmail };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Failed to send pending email:", errMsg);

    if (options.updateChatMessage && pending.chatMessageId) {
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: pending.chatMessageId,
        content: `_Failed to send email: ${errMsg}_`,
      });
    }
    if (pending.threadMessageId) {
      await ctx.runMutation(internal.threads.updateEmailMessage, {
        id: pending.threadMessageId,
        error: errMsg,
      });
    }
    throw err;
  }
}

export const sendPending = internalAction({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["pending"],
      updateChatMessage: true,
      notifyImessage: true,
      authorization: { kind: "scheduled" },
    });
  },
});

export const sendDraftInternal = internalAction({
  args: {
    id: v.id("pendingEmails"),
    authorization: draftSendAuthorizationValidator,
  },
  handler: async (ctx, args) => {
    await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["draft"],
      updateChatMessage: false,
      notifyImessage: false,
      authorization: args.authorization,
    });
  },
});

export const sendDraftNow = action({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args): Promise<{ recipientEmail: string }> => {
    const orgData = (await ctx.runQuery(api.orgs.viewerOrg, {})) as {
      membership?: { orgId: string; userId: Id<"users"> };
    } | null;
    if (!orgData?.membership?.orgId) {
      throwUserFacingError(userFacingErrorCodes.authRequired);
    }
    const pending = (await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.id,
    })) as Doc<"pendingEmails"> | null;
    if (!pending || pending.orgId !== orgData.membership.orgId) {
      throw new Error("Not found");
    }
    const confirmationId = await authorizeExplicitDraftSelection(
      ctx,
      [pending],
      orgData.membership.userId,
    );
    const sent = await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["draft"],
      updateChatMessage: false,
      notifyImessage: false,
      authorization: { kind: "confirmation", confirmationId },
    });
    return sent ?? { recipientEmail: pending.recipientEmail };
  },
});

export const sendDraftsNow = action({
  args: { ids: v.array(v.id("pendingEmails")) },
  handler: async (ctx, args): Promise<BulkDraftSendResult> => {
    const orgData = (await ctx.runQuery(api.orgs.viewerOrg, {})) as {
      membership?: { orgId: string; userId: Id<"users"> };
    } | null;
    if (!orgData?.membership?.orgId) {
      throwUserFacingError(userFacingErrorCodes.authRequired);
    }

    const uniqueIds = [...new Set(args.ids)];
    if (uniqueIds.length === 0) {
      throw new Error("No email drafts selected.");
    }

    const drafts: Array<Doc<"pendingEmails">> = [];
    for (const id of uniqueIds) {
      const pending = (await ctx.runQuery(internal.pendingEmails.getInternal, {
        id,
      })) as Doc<"pendingEmails"> | null;
      if (!pending || pending.orgId !== orgData.membership.orgId) {
        throw new Error("Not found");
      }
      if (pending.status !== "draft") {
        throw new Error("Only draft emails can be sent together.");
      }
      drafts.push(pending);
    }

    const confirmationId = await authorizeExplicitDraftSelection(
      ctx,
      drafts,
      orgData.membership.userId,
    );

    const result: BulkDraftSendResult = { sent: [], failed: [] };
    for (const draft of drafts) {
      try {
        const sent = await sendPendingEmailById(ctx, draft._id, {
          allowedStatuses: ["draft"],
          updateChatMessage: false,
          notifyImessage: false,
          authorization: { kind: "confirmation", confirmationId },
        });
        result.sent.push({
          id: draft._id,
          recipientEmail: sent?.recipientEmail ?? draft.recipientEmail,
        });
      } catch (err) {
        result.failed.push({
          id: draft._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  },
});
