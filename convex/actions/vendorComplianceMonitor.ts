"use node";

import dayjs from "dayjs";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  resolveEmailAgentIdentity,
  upsertEmailDraftArtifact,
} from "../lib/emailSubagent";
import { getImessageWorkerUrl } from "../lib/imessageConfig";
import { getClientPortalUrl } from "../lib/domains";

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
    phone?: string;
  } | null;
};

function vendorDisplayName(row: Record<string, unknown>) {
  const vendorOrg = row.vendorOrg as Record<string, unknown> | null | undefined;
  return String(vendorOrg?.name ?? "Unknown vendor");
}

function vendorOrgId(row: Record<string, unknown>) {
  const vendorOrg = row.vendorOrg as Record<string, unknown> | null | undefined;
  return vendorOrg?._id as Id<"organizations"> | undefined;
}

function serializeMonitorRows(rows: Record<string, unknown>[]) {
  return rows.flatMap((row) => {
    const vendorId = vendorOrgId(row);
    if (!vendorId) return [];
    const checks = Array.isArray(row.checks) ? row.checks : [];
    return [{
      relationshipId: row.relationshipId as Id<"connectedOrgRelationships">,
      vendorOrgId: vendorId,
      vendorName: vendorDisplayName(row),
      status: String(row.status ?? ""),
      requirementCount: Number(row.requirementCount ?? 0),
      policyCount: Number(row.policyCount ?? 0),
      missingCount: Number(row.missingCount ?? 0),
      expiringSoonCount: Number(row.expiringSoonCount ?? 0),
      checks: checks.flatMap((check) => {
        const c = check as Record<string, unknown>;
        const requirement = c.requirement as Record<string, unknown> | undefined;
        if (!requirement?._id) return [];
        return [{
          requirementId: requirement._id as Id<"insuranceRequirements">,
          requirementTitle: String(requirement.title ?? "Requirement"),
          status: c.status as
            | "met"
            | "missing"
            | "expiring_soon"
            | "expired"
            | "needs_review",
          matchedPolicyIds: Array.isArray(c.matchedPolicyIds)
            ? c.matchedPolicyIds as Id<"policies">[]
            : [],
          expiresAt: typeof c.expiresAt === "string" ? c.expiresAt : undefined,
          daysUntilExpiration:
            typeof c.daysUntilExpiration === "number"
              ? c.daysUntilExpiration
              : undefined,
          notes: typeof c.notes === "string" ? c.notes : undefined,
        }];
      }),
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
    `Glass created this thread because the daily vendor compliance monitor found ${issueCount} ${issueLabel} needing attention for ${event.vendorName}.`,
    "",
    `Reason: ${event.clientName}'s active vendor requirements do not currently have matching policy evidence in Glass for ${event.vendorName}.`,
    "",
    "Current gaps:",
    ...issuePreview,
    "",
    action,
  ].join("\n");
}

function buildTextBody(event: ComplianceEvent) {
  const reviewUrl = `${getClientPortalUrl()}/connect/vendors`;
  return `Glass: ${event.vendorName} has ${event.issueLines.length} vendor compliance item${event.issueLines.length === 1 ? "" : "s"} needing attention for ${event.clientName}. Review: ${reviewUrl}`;
}

async function createFollowUpDraft(
  ctx: ActionCtx,
  event: ComplianceEvent,
  vendorEmail: string,
) {
  const [org, members] = await Promise.all([
    ctx.runQuery((internal as any).orgs.getInternal, { id: event.clientOrgId }),
    ctx.runQuery((internal as any).orgs.getMembersInternal, { orgId: event.clientOrgId }),
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
  const proactiveThread = await ctx.runMutation((internal as any).threads.createProactiveInternal, {
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
    await ctx.runMutation((internal as any).threads.deleteMessageInternal, {
      id: contextMessageId,
    });
    return null;
  }
  if (org.autoSendEmails === true) {
    try {
      await ctx.runAction((internal as any).actions.sendPendingEmail.sendDraftInternal, {
        id: draftId,
      });
      await ctx.runMutation((internal as any).threads.updateAgentMessage, {
        id: contextMessageId,
        content: buildFollowUpThreadContext(event, vendorEmail, "sent"),
        pendingEmailId: draftId,
      });
      return { threadId, draftId, status: "sent" as const };
    } catch (error) {
      console.warn("[vendorComplianceMonitor] Vendor follow-up send failed:", error);
      await ctx.runMutation((internal as any).threads.updateAgentMessage, {
        id: contextMessageId,
        content: buildFollowUpThreadContext(event, vendorEmail, "send_failed"),
        pendingEmailId: draftId,
      });
      return { threadId, draftId, status: "send_failed" as const };
    }
  }

  await ctx.runMutation((internal as any).threads.updateAgentMessage, {
    id: contextMessageId,
    content: buildFollowUpThreadContext(event, vendorEmail, "draft"),
    pendingEmailId: draftId,
  });
  return { threadId, draftId, status: "draft" as const };
}

async function sendTextAlerts(ctx: ActionCtx, event: ComplianceEvent) {
  const workerUrl = getImessageWorkerUrl();
  if (!workerUrl) return;

  const members = await ctx.runQuery((internal as any).orgs.getMembersInternal, {
    orgId: event.clientOrgId,
  });
  const phones = [
    ...new Set(
      (members as OrgMemberWithUser[])
        .filter((member) => member.role === "admin")
        .map((member) => member.user?.phone)
        .filter((phone): phone is string => typeof phone === "string" && phone.length > 0),
    ),
  ].slice(0, 5);
  if (phones.length === 0) return;

  const message = buildTextBody(event);
  await Promise.all(
    phones.map(async (toPhone) => {
      try {
        const res = await fetch(`${workerUrl}/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.IMESSAGE_WORKER_SECRET ?? ""}`,
          },
          body: JSON.stringify({ toPhone, message }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.warn(`[vendorComplianceMonitor] Text alert failed ${res.status}: ${body}`);
        }
      } catch (error) {
        console.warn("[vendorComplianceMonitor] Text alert failed:", error);
      }
    }),
  );
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const nowMs = dayjs().valueOf();
    const clientOrgIds = await ctx.runQuery(
      (internal as any).compliance.listClientOrgIdsWithActiveVendorsInternal,
      {},
    ) as Id<"organizations">[];

    let checkedVendors = 0;
    let notificationCount = 0;
    let draftCount = 0;
    let sentEmailCount = 0;
    let textEventCount = 0;

    for (const clientOrgId of clientOrgIds) {
      const complianceRows = await ctx.runQuery(
        (internal as any).compliance.listVendorComplianceInternal,
        { clientOrgId },
      ) as Record<string, unknown>[];
      const rows = serializeMonitorRows(complianceRows);
      checkedVendors += rows.length;
      if (rows.length === 0) continue;

      const events = await ctx.runMutation(
        (internal as any).compliance.recordVendorComplianceRunInternal,
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
            (internal as any).compliance.getConnectedVendorContactInternal,
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
          await sendTextAlerts(ctx, event);
          textEventCount += 1;
        }

        await ctx.runMutation(
          (internal as any).compliance.notifyVendorComplianceEventInternal,
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
      textEvents: textEventCount,
    };
  },
});
