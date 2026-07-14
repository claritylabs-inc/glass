"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { buildEmailDraftTextSummary } from "../lib/emailDraftSummary";
import {
  resolveEmailAgentIdentity,
  upsertEmailDraftArtifact,
  type EmailAttachmentMeta,
} from "../lib/emailSubagent";

function serializeDraft(draft: Doc<"pendingEmails"> | null) {
  if (!draft) return null;
  return {
    id: draft._id,
    status: draft.status,
    threadId: draft.threadId,
    threadMessageId: draft.threadMessageId,
    recipientEmail: draft.recipientEmail,
    ccAddresses: draft.ccAddresses,
    bccAddresses: draft.bccAddresses,
    subject: draft.subject,
    emailBody: draft.emailBody,
    attachments: draft.attachments,
    scheduledSendTime: draft.scheduledSendTime,
    sentMessageId: draft.sentMessageId,
    createdAt: draft._creationTime,
  };
}

function effectivePolicyDataStage(policy: Doc<"policies">) {
  if (
    policy.extractionDataStage === "placeholder" ||
    policy.extractionDataStage === "preview" ||
    policy.extractionDataStage === "final"
  ) {
    return policy.extractionDataStage;
  }
  return policy.pipelineStatus === "complete" ? "final" : "placeholder";
}

function assertPolicyReadyForDelivery(policy: Doc<"policies">) {
  if (
    policy.pipelineStatus === "complete" &&
    effectivePolicyDataStage(policy) === "final"
  ) {
    return;
  }
  throw new Error(
    `Policy ${policy.policyNumber ?? policy._id} must finish enrichment before the original PDF can be delivered.`,
  );
}

export const upsertForMcp = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    draftId: v.optional(v.id("pendingEmails")),
    threadId: v.optional(v.id("threads")),
    to: v.string(),
    subject: v.string(),
    body: v.string(),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    originalPolicyIds: v.optional(v.array(v.id("policies"))),
  },
  handler: async (ctx, args) => {
    const org = await ctx.runQuery(internal.orgs.getInternal, {
      id: args.orgId,
    });
    if (!org) throw new Error("Organization not found");
    const user = await ctx.runQuery(internal.users.getInternal, {
      id: args.userId,
    });
    const identity = await resolveEmailAgentIdentity(ctx, org);
    if (!identity.canSend || !identity.agentAddress || !identity.fromHeader) {
      throw new Error(identity.reason ?? "Email sending is not configured.");
    }

    let threadId = args.threadId;
    if (args.draftId) {
      const draft = (await ctx.runQuery(internal.pendingEmails.getInternal, {
        id: args.draftId,
      })) as Doc<"pendingEmails"> | null;
      if (!draft || draft.orgId !== args.orgId || draft.status !== "draft") {
        throw new Error("Draft not found");
      }
      threadId = draft.threadId;
    }
    if (!threadId) {
      threadId = await ctx.runMutation(internal.threads.createInternal, {
        orgId: args.orgId,
        userId: args.userId,
        title: args.subject || "Email Draft",
      });
    }

    const attachments: EmailAttachmentMeta[] = [];
    const referencedPolicyIds: Id<"policies">[] = [];
    for (const policyId of args.originalPolicyIds ?? []) {
      const policy = (await ctx.runQuery(internal.policies.getInternal, {
        id: policyId,
      })) as Doc<"policies"> | null;
      if (!policy || policy.orgId !== args.orgId) {
        throw new Error(`Policy ${policyId} not found`);
      }
      assertPolicyReadyForDelivery(policy);
      if (!policy.fileId) {
        throw new Error(
          `Policy ${policy.policyNumber ?? policyId} does not have an original PDF file available.`,
        );
      }
      referencedPolicyIds.push(policyId);
      attachments.push({
        filename: policy.fileName ?? `${policy.policyNumber ?? "policy"}.pdf`,
        contentType: "application/pdf",
        size: 0,
        fileId: policy.fileId,
      });
    }

    const pendingEmailId = await upsertEmailDraftArtifact(
      ctx,
      {
        orgId: args.orgId,
        threadId,
        channel: "mcp",
        fromHeader: identity.fromHeader,
        agentAddress: identity.agentAddress,
        brokerBranding: identity.brokerBranding,
        senderEmail: user?.email,
        defaultBcc:
          org.bccRequesterOnAgentEmails !== false && user?.email
            ? [user.email]
            : undefined,
      },
      {
        to: args.to,
        cc: args.cc ?? [],
        bcc: [
          ...(args.bcc ?? []),
          ...(org.bccRequesterOnAgentEmails !== false && user?.email
            ? [user.email]
            : []),
        ],
        subject: args.subject,
        body: args.body,
        attachments,
        referencedPolicyIds:
          referencedPolicyIds.length > 0 ? referencedPolicyIds : undefined,
      },
    );
    if (!pendingEmailId) throw new Error("Failed to create email draft.");

    const draft = (await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: pendingEmailId,
    })) as Doc<"pendingEmails"> | null;
    return serializeDraft(draft);
  },
});

export const sendForMcp = internalAction({
  args: {
    orgId: v.id("organizations"),
    draftId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const draft = (await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.draftId,
    })) as Doc<"pendingEmails"> | null;
    if (!draft || draft.orgId !== args.orgId || draft.status !== "draft") {
      throw new Error("Draft not found");
    }
    await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
      id: args.draftId,
      userConfirmedDraft: true,
    });
    const updated = (await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.draftId,
    })) as Doc<"pendingEmails"> | null;
    return serializeDraft(updated);
  },
});

export const sendManyForMcp = internalAction({
  args: {
    orgId: v.id("organizations"),
    draftIds: v.array(v.id("pendingEmails")),
  },
  handler: async (ctx, args) => {
    const uniqueIds = [...new Set(args.draftIds)];
    if (uniqueIds.length === 0) {
      throw new Error("No draft IDs provided.");
    }

    const drafts: Array<Doc<"pendingEmails">> = [];
    for (const draftId of uniqueIds) {
      const draft = (await ctx.runQuery(internal.pendingEmails.getInternal, {
        id: draftId,
      })) as Doc<"pendingEmails"> | null;
      if (!draft || draft.orgId !== args.orgId || draft.status !== "draft") {
        throw new Error(`Draft ${draftId} not found`);
      }
      drafts.push(draft);
    }

    const sent: Array<{ id: Id<"pendingEmails">; recipientEmail: string }> = [];
    const failed: Array<{ id: Id<"pendingEmails">; error: string }> = [];
    for (const draft of drafts) {
      try {
        await ctx.runAction(
          internal.actions.sendPendingEmail.sendDraftInternal,
          {
            id: draft._id,
            userConfirmedDraft: true,
          },
        );
        sent.push({ id: draft._id, recipientEmail: draft.recipientEmail });
      } catch (err) {
        failed.push({
          id: draft._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      sent,
      failed,
      summary:
        failed.length === 0
          ? `Sent ${sent.length} email${sent.length === 1 ? "" : "s"}.`
          : `Sent ${sent.length} email${sent.length === 1 ? "" : "s"}; ${failed.length} failed.`,
    };
  },
});

export const summarizeForMcp = internalAction({
  args: {
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    showAll: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const drafts = (await ctx.runQuery(
      internal.pendingEmails.listDraftsInternal,
      {
        orgId: args.orgId,
        threadId: args.threadId,
      },
    )) as Array<Doc<"pendingEmails">>;
    return {
      summary:
        drafts.length > 0
          ? buildEmailDraftTextSummary(drafts, {
              sampleSize: args.showAll ? drafts.length : 3,
              includeIds: true,
              commands: "mcp",
            })
          : "No email drafts found.",
      drafts: drafts.map(serializeDraft),
    };
  },
});

export const cancelForMcp = internalAction({
  args: {
    orgId: v.id("organizations"),
    draftId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const draft = (await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.draftId,
    })) as Doc<"pendingEmails"> | null;
    if (!draft || draft.orgId !== args.orgId || draft.status !== "draft") {
      throw new Error("Draft not found");
    }
    await ctx.runMutation(internal.pendingEmails.cancelInternal, {
      id: args.draftId,
    });
    const updated = (await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.draftId,
    })) as Doc<"pendingEmails"> | null;
    return serializeDraft(updated);
  },
});
