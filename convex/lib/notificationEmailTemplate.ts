// convex/lib/notificationEmailTemplate.ts
import { getBrandingContext, getDefaultBranding } from "./branding";
import { DEFAULT_CLIENT_PORTAL_URL } from "./domains";
import { buildEmailShell, escapeHtml } from "./emailTemplate";

const GLASS_ACCENT = "#2563eb";
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
  const { title, body, ctaUrl, ctaLabel, branding, siteUrl = SITE_URL_DEFAULT, threadLabel } = args;

  const accentColor =
    branding.kind === "broker" && branding.accentColor ? branding.accentColor : GLASS_ACCENT;

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
    ? `<tr><td align="left" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.4;">${escapedThreadLabel}</p>
</td></tr>`
    : "";

  const bodyHtml = `
${threadHtml}
<tr><td align="left" style="padding:${escapedThreadLabel ? "20px" : "28px"} 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.5;">${escapedTitle}</p>
</td></tr>
<tr><td align="left" style="padding:14px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">${escapedBody}</p>
</td></tr>
<tr><td align="center" style="padding:26px 40px 0 40px;">
  <a href="${escapedCtaUrl}" style="display:inline-block;background:${accentColor};color:#ffffff;text-decoration:none;border-radius:999px;padding:11px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;">${escapedCtaLabel}</a>
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
