"use node";
// convex/actions/sendNotificationEmail.ts
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { buildNotificationEmail, NotificationEmailBranding } from "../lib/notificationEmailTemplate";
import { NotificationType, getEffectiveEmailDefault } from "../lib/notificationTypes";

const RESEND_API = "https://api.resend.com/emails";
const FROM_ADDRESS = "notifications@glass.app";
const MAX_RETRIES = 3;

async function resendWithRetry(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<{ ok: boolean; id?: string }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (res.ok) {
      try {
        return { ok: true, id: JSON.parse(body).id };
      } catch {
        return { ok: true };
      }
    }
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return { ok: false };
}

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
      if (brokerOrg?.iconStorageId) {
        logoUrl = await ctx.storage.getUrl(brokerOrg.iconStorageId);
      }
      branding = {
        kind: "broker",
        brokerName: brokerOrg?.name ?? "Your broker",
        agentDisplayName: brokerOrg?.agentDisplayName ?? null,
        accentColor: brokerOrg?.brandingColor ?? null,
        logoUrl,
      };
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
    const apiKey = process.env.AUTH_RESEND_KEY ?? "";

    const result = await resendWithRetry(
      {
        from: `${emailContent.fromName} <${FROM_ADDRESS}>`,
        to,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      },
      apiKey,
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
    case "view_application":
      return `${siteUrl}/applications/${p.applicationId}`;
    case "view_policy":
      return `${siteUrl}/policies/${p.policyId}`;
    case "view_passport":
      return `${siteUrl}/passport/${p.flagId}`;
    case "view_integration":
      return `${siteUrl}/connections/${p.connectionId}`;
    default:
      return `${siteUrl}/notifications`;
  }
}
