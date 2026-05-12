// convex/lib/notificationEmailTemplate.ts
import { getBrandingContext, getDefaultBranding } from "./branding";
import { buildEmailShell, escapeHtml } from "./emailTemplate";

const GLASS_ACCENT = "#2563eb";
const SITE_URL_DEFAULT = "https://glass.claritylabs.inc";
const NOTIFICATION_FROM_NAME = "Glass Notifications";

export type NotificationEmailBranding =
  | {
      kind: "broker";
      brokerName: string;
      agentDisplayName: string | null;
      accentColor: string | null;
      logoUrl: string | null;
    }
  | { kind: "glass" };

export interface BuildNotificationEmailArgs {
  title: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
  branding: NotificationEmailBranding;
  siteUrl?: string;
  threadLabel?: string;
}

export interface NotificationEmailResult {
  fromName: string;
  subject: string;
  html: string;
  text: string;
}

export function buildNotificationEmail(
  args: BuildNotificationEmailArgs,
): NotificationEmailResult {
  const { title, body, ctaUrl, ctaLabel, branding, siteUrl = SITE_URL_DEFAULT, threadLabel } = args;

  const accentColor =
    branding.kind === "broker" && branding.accentColor ? branding.accentColor : GLASS_ACCENT;

  const senderLabel = branding.kind === "broker" ? branding.brokerName : "Glass";
  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body);
  const escapedCtaUrl = escapeHtml(ctaUrl);
  const escapedCtaLabel = escapeHtml(ctaLabel);
  const escapedThreadLabel = threadLabel ? escapeHtml(threadLabel) : null;
  const emailBranding =
    branding.kind === "broker"
      ? getBrandingContext({
          agentDisplayName: branding.brokerName,
          brandingColor: accentColor,
          logoUrl: branding.logoUrl ?? undefined,
        })
      : getDefaultBranding();

  const threadHtml = escapedThreadLabel
    ? `<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;font-weight:600;color:#6b7280;line-height:1.4;text-transform:uppercase;letter-spacing:0.04em;">Notification for thread</p>
  <p style="margin:6px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.4;">${escapedThreadLabel}</p>
</td></tr>`
    : "";

  const bodyHtml = `
${threadHtml}
<tr><td align="center" style="padding:${escapedThreadLabel ? "20px" : "28px"} 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.5;">${escapedTitle}</p>
</td></tr>
<tr><td align="center" style="padding:14px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">${escapedBody}</p>
</td></tr>
<tr><td align="center" style="padding:26px 40px 0 40px;">
  <a href="${escapedCtaUrl}" style="display:inline-block;background:${accentColor};color:#ffffff;text-decoration:none;border-radius:8px;padding:11px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;">${escapedCtaLabel}</a>
</td></tr>
<tr><td style="padding:32px 40px 0 40px;">
  <div style="height:1px;background-color:rgba(17,24,39,0.06);"></div>
</td></tr>
<tr><td align="center" style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">
    ${branding.kind === "broker" ? `Sent on behalf of ${escapeHtml(senderLabel)}.` : "Sent by Glass Notifications."}
  </p>
</td></tr>`;

  const html = buildEmailShell({
    title: escapedTitle,
    bodyHtml,
    branding: emailBranding,
    siteUrl,
  });

  const text = [
    threadLabel ? `Thread: ${threadLabel}` : null,
    title,
    "",
    body,
    "",
    `${ctaLabel}: ${ctaUrl}`,
    "",
    "—",
    branding.kind === "broker"
      ? `Sent via Glass by Clarity Labs on behalf of ${senderLabel}`
      : "Glass Notifications",
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  return { fromName: NOTIFICATION_FROM_NAME, subject: title, html, text };
}
