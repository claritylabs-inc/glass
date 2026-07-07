// convex/lib/notificationEmailTemplate.ts
// Notification-email composition built on the shared shell in emailTemplate.
import { getBrandingContext, getDefaultBranding } from "./branding";
import { DEFAULT_CLIENT_PORTAL_URL } from "./domains";
import { buildEmailShell, escapeHtml } from "./emailTemplate";

const SITE_URL_DEFAULT = DEFAULT_CLIENT_PORTAL_URL;
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
  const {
    title,
    body,
    ctaUrl,
    ctaLabel,
    branding,
    siteUrl = SITE_URL_DEFAULT,
    threadLabel,
  } = args;

  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body).replace(/\n/g, "<br>");
  const escapedCtaUrl = escapeHtml(ctaUrl);
  const escapedCtaLabel = escapeHtml(ctaLabel);
  const escapedThreadLabel = threadLabel ? escapeHtml(threadLabel) : null;

  const emailBranding =
    branding.kind === "broker"
      ? getBrandingContext({
          agentDisplayName: branding.brokerName,
          brandingColor: branding.accentColor ?? undefined,
          logoUrl: branding.logoUrl ?? undefined,
        })
      : getDefaultBranding();

  const threadHtml = escapedThreadLabel
    ? `<tr><td align="center" style="padding:24px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#6b7280;line-height:1.5;">${escapedThreadLabel}</p>
</td></tr>`
    : "";

  const bodyHtml = `
${threadHtml}
<tr><td align="center" style="padding:${escapedThreadLabel ? "10px" : "28px"} 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:500;color:#000000;line-height:1.5;">${escapedTitle}</p>
</td></tr>
<tr><td align="center" style="padding:18px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.5;">${escapedBody}</p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapedCtaUrl}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;border-radius:999px;padding:11px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;">${escapedCtaLabel}</a>
</td></tr>
<tr><td style="padding:32px 40px 0 40px;">
  <div style="height:1px;background-color:rgba(17,24,39,0.06);"></div>
</td></tr>
<tr><td align="center" style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">
    Open in Glass: <a href="${escapedCtaUrl}" style="color:#6b7280;text-decoration:underline;word-break:break-all;">${escapedCtaUrl}</a>
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
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  return { fromName: NOTIFICATION_FROM_NAME, subject: title, html, text };
}
