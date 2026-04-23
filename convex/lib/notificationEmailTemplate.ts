// convex/lib/notificationEmailTemplate.ts

const GLASS_ACCENT = "#2563eb";
const SITE_URL_DEFAULT = "https://glass.app";

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
  const { title, body, ctaUrl, ctaLabel, branding, siteUrl = SITE_URL_DEFAULT } = args;

  const fromName =
    branding.kind === "broker"
      ? `${branding.agentDisplayName ?? branding.brokerName} via Glass`
      : "Glass";

  const accentColor =
    branding.kind === "broker" && branding.accentColor ? branding.accentColor : GLASS_ACCENT;

  const senderLabel = branding.kind === "broker" ? branding.brokerName : "Glass";

  const logoHtml =
    branding.kind === "broker" && branding.logoUrl
      ? `<img src="${branding.logoUrl}" alt="${senderLabel}" height="40" style="display:block;border:0;" />`
      : `<span style="font-family:-apple-system,sans-serif;font-size:18px;font-weight:700;color:#111827;">Glass</span>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

<!-- Logo -->
<tr><td align="center" style="padding:32px 40px 0 40px;">
  ${logoHtml}
</td></tr>

<!-- Title -->
<tr><td style="padding:24px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;font-weight:600;color:#111827;line-height:1.4;">${title}</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:12px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#374151;line-height:1.6;">${body}</p>
</td></tr>

<!-- CTA -->
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <a href="${ctaUrl}" style="display:inline-block;padding:10px 24px;background-color:${accentColor};color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:6px;">${ctaLabel}</a>
</td></tr>

<!-- Divider -->
<tr><td style="padding:28px 40px 0 40px;">
  <div style="height:1px;background-color:rgba(0,0,0,0.06);"></div>
</td></tr>

<!-- Footer -->
<tr><td align="center" style="padding:16px 40px 28px 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;line-height:1.5;">
    ${branding.kind === "broker" ? `Sent via <a href="${siteUrl}" style="color:#9ca3af;text-decoration:none;">Glass</a> from Clarity Labs on behalf of ${senderLabel}` : `<a href="${siteUrl}" style="color:#9ca3af;text-decoration:none;">Glass</a> from Clarity Labs`}
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `${title}\n\n${body}\n\n${ctaLabel}: ${ctaUrl}\n\n—\n${branding.kind === "broker" ? `Sent via Glass by Clarity Labs on behalf of ${senderLabel}` : "Glass by Clarity Labs"}`;

  return { fromName, subject: title, html, text };
}
