"use node";

import dayjs from "dayjs";
import type { FunctionReturnType } from "convex/server";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  resolveEmailAgentIdentity,
  upsertEmailDraftArtifact,
} from "../lib/emailSubagent";

export type ComplianceEvent = {
  type:
    | "vendor_compliance_met"
    | "vendor_compliance_gap"
    | "vendor_policy_expiring"
    | "vendor_policy_expired";
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  clientOrgId: Id<"organizations">;
  clientName: string;
  vendorOrgId: Id<"organizations">;
  vendorName: string;
  relationshipId: Id<"connectedOrgRelationships">;
  issueLines: string[];
};

type OrgMemberWithUser = {
  role?: string;
  user?: {
    _id?: Id<"users">;
    email?: string;
  } | null;
};

type VendorComplianceRows = FunctionReturnType<
  typeof internal.compliance.listVendorComplianceInternal
>;

function serializeMonitorRows(rows: VendorComplianceRows) {
  return rows.flatMap((row) => {
    const vendorId = row.vendorOrg?._id;
    if (!vendorId) return [];
    return [{
      relationshipId: row.relationshipId,
      vendorOrgId: vendorId,
      vendorName: row.vendorName,
      status: row.status,
      requirementCount: row.requirementCount,
      policyCount: row.policyCount,
      notMetCount: row.notMetCount,
      missingCount: row.missingCount,
      expiringSoonCount: row.expiringSoonCount,
      unverifiedCount: row.unverifiedCount,
      checks: row.checks.map((check) => ({
        requirementId: check.requirement._id,
        requirementTitle: check.requirement.title,
        status: check.status,
        reasons: check.reasons,
        matchedPolicyIds: check.matchedPolicyIds,
        matchedSummary: check.matchedSummary,
        expiresAt: check.expiresAt,
        daysUntilExpiration: check.daysUntilExpiration,
        notes: check.notes,
      })),
    }];
  });
}

function buildFollowUpBody(event: ComplianceEvent) {
  const issueText = event.issueLines.map((line) => `- ${line}`).join("\n");
  return [
    "Hello,",
    "",
    `${event.clientName} is reviewing vendor insurance records in Glass, and these items currently need attention for ${event.vendorName}:`,
    "",
    issueText,
    "",
    "Please upload the current policies or certificates in Glass, or reply with the documents and any endorsements that address the items above.",
    "",
    "Thank you.",
  ].join("\n");
}

export function buildFollowUpThreadContext(
  event: ComplianceEvent,
  vendorEmail: string,
  status: "draft" | "sent" | "send_failed",
) {
  const issueCount = event.issueLines.length;
  const issueLabel = issueCount === 1 ? "compliance item" : "compliance items";
  const issuePreview = event.issueLines.slice(0, 6).map((line) => `- ${line}`);
  const remainingCount = event.issueLines.length - issuePreview.length;
  if (remainingCount > 0) {
    issuePreview.push(`- ${remainingCount} more ${remainingCount === 1 ? "item" : "items"} in the email below.`);
  }

  const action =
    status === "sent"
      ? `I sent the follow-up email to ${vendorEmail}. You can review the sent email below and use this thread if the vendor replies with policies or endorsements.`
      : status === "send_failed"
        ? `I drafted the follow-up email to ${vendorEmail}, but the automatic send failed. Review the draft below, edit if needed, then retry sending it.`
        : `Review the draft below, edit anything that should change, then send it to ${vendorEmail}. If ${event.vendorName} already sent documents, upload them or ask the vendor to reply with the policies, certificates, or endorsements that satisfy these requirements.`;

  return [
    `Glass found ${issueCount} vendor insurance ${issueLabel} needing attention for ${event.vendorName}.`,
    "",
    `Reason: ${event.clientName}'s active vendor requirements do not currently have matching policy evidence in Glass for ${event.vendorName}.`,
    "",
    "What needs attention:",
    ...issuePreview,
    "",
    action,
  ].join("\n");
}

async function createFollowUpDraft(
  ctx: ActionCtx,
  event: ComplianceEvent,
  vendorEmail: string,
) {
  const [org, members] = await Promise.all([
    ctx.runQuery(internal.orgs.getInternal, { id: event.clientOrgId }),
    ctx.runQuery(internal.orgs.getMembersInternal, { orgId: event.clientOrgId }),
  ]);
  if (!org) return null;
  const orgMembers = members as OrgMemberWithUser[];
  const owner =
    orgMembers.find((member) => member.role === "admin" && member.user) ??
    orgMembers.find((member) => member.user);
  if (!owner?.user?._id) return null;

  const identity = await resolveEmailAgentIdentity(ctx, org);
  if (!identity.canSend || !identity.agentAddress || !identity.fromHeader) {
    return null;
  }

  const subject = `${event.clientName} vendor insurance requirements`;
  const initialContext = buildFollowUpThreadContext(event, vendorEmail, "draft");
  const proactiveThread = await ctx.runMutation(internal.threads.createProactiveInternal, {
    orgId: event.clientOrgId,
    userId: owner.user._id,
    title: `Vendor compliance follow-up - ${event.vendorName}`,
    content: initialContext,
  });
  const threadId = proactiveThread.threadId as Id<"threads">;
  const contextMessageId = proactiveThread.messageId as Id<"threadMessages">;
  const ownerEmail = owner.user.email;
  const draftId = await upsertEmailDraftArtifact(ctx, {
    orgId: event.clientOrgId,
    threadId,
    chatMessageId: contextMessageId,
    channel: "mcp",
    fromHeader: identity.fromHeader,
    agentAddress: identity.agentAddress,
    brokerBranding: identity.brokerBranding,
    senderEmail: ownerEmail,
    defaultBcc:
      org.bccRequesterOnAgentEmails !== false && ownerEmail
        ? [ownerEmail]
        : undefined,
  }, {
    to: vendorEmail,
    cc: [],
    bcc: org.bccRequesterOnAgentEmails !== false && ownerEmail ? [ownerEmail] : [],
    subject,
    body: buildFollowUpBody(event),
    attachments: [],
  });

  if (!draftId) {
    await ctx.runMutation(internal.threads.deleteMessageInternal, {
      id: contextMessageId,
    });
    return null;
  }
  if (org.autoSendEmails === true) {
    try {
      await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
        id: draftId,
        userConfirmedDraft: false,
      });
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: contextMessageId,
        content: buildFollowUpThreadContext(event, vendorEmail, "sent"),
        pendingEmailId: draftId,
      });
      return { threadId, draftId, status: "sent" as const };
    } catch (error) {
      console.warn("[vendorComplianceMonitor] Vendor follow-up send failed:", error);
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: contextMessageId,
        content: buildFollowUpThreadContext(event, vendorEmail, "send_failed"),
        pendingEmailId: draftId,
      });
      return { threadId, draftId, status: "send_failed" as const };
    }
  }

  await ctx.runMutation(internal.threads.updateAgentMessage, {
    id: contextMessageId,
    content: buildFollowUpThreadContext(event, vendorEmail, "draft"),
    pendingEmailId: draftId,
  });
  return { threadId, draftId, status: "draft" as const };
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const nowMs = dayjs().valueOf();
    const clientOrgIds = await ctx.runQuery(
      internal.compliance.listClientOrgIdsWithActiveVendorsInternal,
      {},
    ) as Id<"organizations">[];

    let checkedVendors = 0;
    let notificationCount = 0;
    let draftCount = 0;
    let sentEmailCount = 0;

    for (const clientOrgId of clientOrgIds) {
      const complianceRows = await ctx.runQuery(
        internal.compliance.listVendorComplianceInternal,
        { clientOrgId, includePreviewPolicies: false },
      );
      const rows = serializeMonitorRows(complianceRows);
      checkedVendors += rows.length;
      if (rows.length === 0) continue;

      const events = await ctx.runMutation(
        internal.compliance.recordVendorComplianceRunInternal,
        { clientOrgId, rows, nowMs },
      ) as ComplianceEvent[];

      for (const event of events) {
        let draft:
          | {
              threadId: Id<"threads">;
              draftId: Id<"pendingEmails">;
              status: "draft" | "sent" | "send_failed";
            }
          | null = null;
        if (event.type !== "vendor_compliance_met") {
          const contact = await ctx.runQuery(
            internal.compliance.getConnectedVendorContactInternal,
            {
              clientOrgId: event.clientOrgId,
              vendorOrgId: event.vendorOrgId,
              relationshipId: event.relationshipId,
            },
          ) as { vendorEmail?: string } | null;
          if (contact?.vendorEmail) {
            draft = await createFollowUpDraft(ctx, event, contact.vendorEmail);
            if (draft) {
              draftCount += 1;
              if (draft.status === "sent") sentEmailCount += 1;
            }
          }
        }

        await ctx.runMutation(
          internal.compliance.notifyVendorComplianceEventInternal,
          {
            orgId: event.clientOrgId,
            vendorOrgId: event.vendorOrgId,
            relationshipId: event.relationshipId,
            type: event.type,
            title: event.title,
            body:
              draft?.status === "sent"
                ? `${event.body} A follow-up email was sent to the vendor.`
                : draft
                  ? `${event.body} A follow-up email draft is ready for review.`
                  : event.body,
            severity: event.severity,
            actionType: draft ? "view_thread" : "view_vendor_compliance",
            actionPayload: draft
              ? {
                  threadId: draft.threadId,
                  draftId: draft.draftId,
                  vendorOrgId: event.vendorOrgId,
                }
              : {
                  vendorOrgId: event.vendorOrgId,
                  relationshipId: event.relationshipId,
                },
            sourceRef: {
              relationshipId: event.relationshipId,
              vendorOrgId: event.vendorOrgId,
            },
            nowMs,
          },
        );
        notificationCount += 1;
      }
    }

    return {
      checkedClientOrgs: clientOrgIds.length,
      checkedVendors,
      notifications: notificationCount,
      drafts: draftCount,
      sentEmails: sentEmailCount,
    };
  },
});
