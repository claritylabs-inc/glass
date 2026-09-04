"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { sendTrackedResendEmail } from "../lib/emailDelivery";
import { buildEmailShell, escapeHtml } from "../lib/emailTemplate";
import { getAuthFromAddress } from "../lib/resend";

type PacketSendResult = {
  requestId: Id<"procurementRequests">;
  outreachId: Id<"procurementBrokerOutreaches">;
  linkId: Id<"procurementPacketLinks">;
  recipientEmail: string;
  url: string;
  expiresAt: number;
  audience: "broker";
  sectionCount: number;
  fileCount: number;
  includedArtifacts: Array<{
    fileItemId: Id<"procurementFileItems">;
    clientFileId: Id<"clientFiles">;
    name: string;
    release: "listed" | "attached";
  }>;
  deliveryStatus: "sent" | "failed";
  deliveryError: string | null;
  auditEventId: Id<"operatorAuditEvents"> | null;
};

async function sendPacket(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    outreachId: Id<"procurementBrokerOutreaches">;
    expiresAt?: number;
    expiresInDays?: number;
  },
): Promise<PacketSendResult> {
  const [request, outreach] = (await Promise.all([
    ctx.runQuery(internal.procurementRequests.getInternal, {
      requestId: args.requestId,
    }),
    ctx.runQuery(internal.procurementRequests.getOutreachInternal, {
      outreachId: args.outreachId,
    }),
  ])) as [
    Doc<"procurementRequests"> | null,
    Doc<"procurementBrokerOutreaches"> | null,
  ];
  if (!request) throw new Error("Procurement request not found");
  if (!outreach || outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this request");
  const recipientEmail = outreach.contactEmail?.trim().toLowerCase();
  if (!recipientEmail)
    throw new Error("Add a broker contact email before sending the packet");

  const link = (await ctx.runMutation(
    internal.procurementPacket.mintLinkInternal,
    {
      operatorUserId: args.operatorUserId,
      requestId: request._id,
      outreachId: outreach._id,
      recipientLabel: outreach.contactName || outreach.brokerName,
      recipientEmail,
      expiresAt: args.expiresAt,
      expiresInDays: args.expiresInDays,
    },
  )) as {
    id: Id<"procurementPacketLinks">;
    url: string;
    expiresAt: number;
    audience: "broker";
    sectionCount: number;
    fileCount: number;
    includedArtifacts: PacketSendResult["includedArtifacts"];
  };
  await ctx.runMutation(internal.procurementPacket.recordDeliveryInternal, {
    operatorUserId: args.operatorUserId,
    linkId: link.id,
    status: "pending",
  });

  const subject = `Insurance submission packet for ${request.title}`;
  const safeUrl = escapeHtml(link.url);
  const expiry = dayjs(link.expiresAt).format("YYYY-MM-DD");
  const text = `Please review the insurance submission packet for ${request.title}.\n\n${link.url}\n\nThis link expires on ${expiry}.`;
  const html = buildEmailShell({
    title: subject,
    bodyHtml: `<tr><td style="padding:28px 40px 32px"><p>Please review the insurance submission packet for <strong>${escapeHtml(request.title)}</strong>.</p><p><a href="${safeUrl}">Open submission packet</a></p><p style="font-size:12px;color:#6b7280">Or copy this link: ${safeUrl}<br>This link expires on ${expiry}.</p></td></tr>`,
  });
  const result = await sendTrackedResendEmail(ctx, {
    source: "procurement_packet",
    orgId: request.clientOrgId,
    recipientEmail,
    subject,
    payload: {
      from: getAuthFromAddress("Spot"),
      to: recipientEmail,
      subject,
      text,
      html,
    },
  });
  const deliveryAudit = (await ctx.runMutation(
    internal.procurementPacket.recordDeliveryInternal,
    {
      operatorUserId: args.operatorUserId,
      linkId: link.id,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? undefined : result.error,
    },
  )) as { auditEventId: Id<"operatorAuditEvents"> | null };
  return {
    requestId: request._id,
    outreachId: outreach._id,
    linkId: link.id,
    recipientEmail,
    url: link.url,
    expiresAt: link.expiresAt,
    audience: link.audience,
    sectionCount: link.sectionCount,
    fileCount: link.fileCount,
    includedArtifacts: link.includedArtifacts,
    deliveryStatus: result.ok ? "sent" : "failed",
    deliveryError: result.ok ? null : result.error,
    auditEventId: deliveryAudit.auditEventId,
  };
}

export const send = action({
  args: {
    requestId: v.id("procurementRequests"),
    outreachId: v.id("procurementBrokerOutreaches"),
    expiresAt: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operatorUserId = await getAuthUserId(ctx);
    if (!operatorUserId) throw new Error("Authentication required");
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId: operatorUserId,
    });
    return await sendPacket(ctx, {
      operatorUserId: operatorUserId as Id<"users">,
      ...args,
    });
  },
});

export const sendInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    requestId: v.id("procurementRequests"),
    outreachId: v.id("procurementBrokerOutreaches"),
    expiresAt: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
  },
  handler: sendPacket,
});
