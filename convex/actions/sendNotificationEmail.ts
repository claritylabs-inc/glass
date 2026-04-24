"use node";
// convex/actions/sendNotificationEmail.ts
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { buildNotificationEmail, NotificationEmailBranding } from "../lib/notificationEmailTemplate";
import { NotificationType, getEffectiveEmailDefault } from "../lib/notificationTypes";
import { sendResendEmail, getNotificationFromAddress } from "../lib/resend";
import { isWhiteLabelingEnabled } from "../lib/branding";

export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.runQuery(
      (internal as any).notifications.getInternal,
      { id: args.notificationId },
    );

    if (!notification) return;
    if (notification.emailStatus !== "scheduled") return;

    const recipientOrg = await ctx.runQuery(
      (internal as any).organizations.getInternal,
      { id: notification.orgId },
    );
    if (!recipientOrg) return;

    // Collect recipients (user-targeted or org-wide)
    const memberships = notification.userId
      ? [{ userId: notification.userId }]
      : await ctx.runQuery(
          (internal as any).organizations.listMembershipsForOrg,
          { orgId: notification.orgId },
        );

    // Preference check at send time
    const type = notification.type as NotificationType;
    const severity = notification.severity as "info" | "warning" | "critical";

    const recipientsToEmail: Array<{ userId: string; email: string }> = [];

    for (const m of memberships) {
      const user = await ctx.runQuery(
        (internal as any).users.getInternal,
        { id: m.userId },
      );
      if (!user?.email) continue;

      const pref: boolean | null = await ctx.runQuery(
        (internal as any).notificationPreferences.resolveForUser,
        { userId: m.userId, orgId: notification.orgId, type },
      );

      const shouldEmail = pref !== null ? pref : getEffectiveEmailDefault(severity);
      if (shouldEmail) {
        recipientsToEmail.push({ userId: m.userId, email: user.email });
      }
    }

    if (recipientsToEmail.length === 0) {
      await ctx.runMutation(
        (internal as any).notifications.patchEmailStatus,
        { id: args.notificationId, emailStatus: "suppressed_by_preference" },
      );
      return;
    }

    // Resolve branding
    let branding: NotificationEmailBranding;
    const siteUrl = process.env.SITE_URL ?? "https://glass.app";

    if (recipientOrg.type === "client" && recipientOrg.brokerOrgId) {
      const brokerOrg = await ctx.runQuery(
        (internal as any).organizations.getInternal,
        { id: recipientOrg.brokerOrgId },
      );
      // Get logo URL via storage if iconStorageId is set
      let logoUrl: string | null = null;
      const whiteLabelingEnabled = !!brokerOrg && isWhiteLabelingEnabled(brokerOrg);
      if (whiteLabelingEnabled && brokerOrg?.iconStorageId) {
        logoUrl = await ctx.storage.getUrl(brokerOrg.iconStorageId);
      }
      branding = whiteLabelingEnabled
        ? {
            kind: "broker",
            brokerName: brokerOrg?.name ?? "Your broker",
            agentDisplayName: brokerOrg?.agentDisplayName ?? null,
            accentColor: brokerOrg?.brandingColor ?? null,
            logoUrl,
          }
        : { kind: "glass" };
    } else {
      branding = { kind: "glass" };
    }

    // Build CTA URL from actionPayload or fallback to inbox
    const ctaUrl = buildCtaUrl(notification.actionType, notification.actionPayload, siteUrl);

    const emailContent = buildNotificationEmail({
      title: notification.title,
      body: notification.body,
      ctaUrl,
      ctaLabel: "View in Glass",
      branding,
      siteUrl,
    });

    // Send to all recipients
    const to = recipientsToEmail.map((r) => r.email);

    const result = await sendResendEmail(
      {
        from: getNotificationFromAddress(emailContent.fromName),
        to,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      },
      { retries: 2 },
    );

    if (result.ok) {
      await ctx.runMutation(
        (internal as any).notifications.patchEmailStatus,
        { id: args.notificationId, emailStatus: "sent", emailSentAt: Date.now() },
      );
    } else {
      await ctx.runMutation(
        (internal as any).notifications.patchEmailStatus,
        { id: args.notificationId, emailStatus: "failed" },
      );
      console.error(`[sendNotificationEmail] Failed to send notification ${args.notificationId}`);
    }
  },
});

function buildCtaUrl(
  actionType: string | undefined,
  actionPayload: unknown,
  siteUrl: string,
): string {
  if (!actionType || !actionPayload) return `${siteUrl}/notifications`;
  const p = actionPayload as Record<string, string>;
  switch (actionType) {
    case "view_policy":
      return `${siteUrl}/policies/${p.policyId}`;
    default:
      return `${siteUrl}/notifications`;
  }
}
