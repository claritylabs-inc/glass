"use node";

import { v } from "convex/values";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sendTrackedResendEmail } from "../lib/emailDelivery";
import { buildEmailShell, escapeHtml } from "../lib/emailTemplate";
import { getAuthFromAddress } from "../lib/resend";

export const send = internalAction({
  args: { operatorUserId: v.id("users"), requestId: v.id("procurementRequests"), outreachIds: v.array(v.id("procurementBrokerOutreaches")) },
  handler: async (ctx, args): Promise<{ results: Array<{ outreachId: string; linkId: string; ok: boolean }> }> => {
    const request: Doc<"procurementRequests"> | null = await ctx.runQuery(internal.procurementRequests.getInternal, { requestId: args.requestId });
    if (!request) throw new Error("Procurement request not found");
    const results = [];
    for (const outreachId of args.outreachIds) {
      const outreach: Doc<"procurementBrokerOutreaches"> | null = await ctx.runQuery(internal.procurementRequests.getOutreachInternal, { outreachId });
      if (!outreach?.contactEmail) continue;
      const link: { id: Id<"procurementPacketLinks">; token: string; url: string; expiresAt: number } = await ctx.runMutation(internal.procurementPacket.mintLinkInternal, { operatorUserId: args.operatorUserId, requestId: args.requestId, outreachId, recipientLabel: outreach.contactName || outreach.brokerName, recipientEmail: outreach.contactEmail });
      const subject = `Insurance submission packet for ${request.title}`;
      const safeUrl = escapeHtml(link.url);
      const expiry = dayjs(link.expiresAt).format("YYYY-MM-DD");
      const text = `Please review the insurance submission packet for ${request.title}.\n\n${link.url}\n\nThis link expires on ${expiry}.`;
      const html = buildEmailShell({ title: subject, bodyHtml: `<tr><td style="padding:28px 40px 32px"><p>Please review the insurance submission packet for <strong>${escapeHtml(request.title)}</strong>.</p><p><a href="${safeUrl}">Open submission packet</a></p><p style="font-size:12px;color:#6b7280">Or copy this link: ${safeUrl}<br>This link expires on ${expiry}.</p></td></tr>` });
      const result = await sendTrackedResendEmail(ctx, { source: "procurement_packet", orgId: request.clientOrgId, recipientEmail: outreach.contactEmail, subject, payload: { from: getAuthFromAddress("Spot"), to: outreach.contactEmail, subject, text, html } });
      results.push({ outreachId, linkId: link.id, ok: result.ok });
    }
    return { results };
  },
});
