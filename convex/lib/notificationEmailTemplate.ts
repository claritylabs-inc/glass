// convex/lib/notificationEmailTemplate.ts
import { getBrandingContext, getDefaultBranding } from "./branding";
import { DEFAULT_CLIENT_PORTAL_URL } from "./domains";
import { buildEmailShell, escapeHtml } from "./emailTemplate";

const GLASS_ACCENT = "#2563eb";
const OPERATIONAL_ACCENT = "#000000";
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
  variant?: "default" | "application";
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
    variant = "default",
  } = args;

  const accentColor =
    branding.kind === "broker" && branding.accentColor
      ? branding.accentColor
      : variant === "application"
        ? OPERATIONAL_ACCENT
        : GLASS_ACCENT;

  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body);
  const escapedCtaUrl = escapeHtml(ctaUrl);
  const escapedCtaLabel = escapeHtml(ctaLabel);
  const escapedThreadLabel = threadLabel ? escapeHtml(threadLabel) : null;
  const brandName = branding.kind === "broker" ? branding.brokerName : "Glass";
  const escapedBrandName = escapeHtml(brandName);

  if (variant === "application") {
    const logoHtml = branding.kind === "broker" && branding.logoUrl
      ? `<img src="${escapeHtml(branding.logoUrl)}" alt="" width="28" height="28" style="display:block;width:28px;height:28px;border-radius:6px;object-fit:cover;border:0;" />`
      : "";
    const contextHtml = escapedThreadLabel
      ? `<p style="margin:20px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:500;color:#6b7280;line-height:1.5;">${escapedThreadLabel}</p>`
      : "";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapedTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
<tr><td align="center" style="padding:32px 16px 40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-top:1px solid rgba(17,24,39,0.10);">
<tr><td align="left" style="padding:28px 0 0 0;">
  <table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      ${logoHtml ? `<td style="padding:0 10px 0 0;">${logoHtml}</td>` : ""}
      <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.2;">
        <div style="font-size:14px;font-weight:650;color:#000000;">${escapedBrandName}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:3px;">Application intake</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td align="left" style="padding:28px 0 0 0;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;font-weight:650;letter-spacing:0;text-transform:uppercase;color:#6b7280;line-height:1.4;">Action needed</p>
  ${contextHtml}
  <h1 style="margin:10px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:650;color:#000000;line-height:1.25;">${escapedTitle}</h1>
</td></tr>
<tr><td align="left" style="padding:14px 0 0 0;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4b5563;line-height:1.6;">${escapedBody}</p>
</td></tr>
<tr><td align="left" style="padding:26px 0 0 0;">
  <a href="${escapedCtaUrl}" style="display:inline-block;background:${accentColor};color:#ffffff;text-decoration:none;border-radius:999px;padding:11px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:650;">${escapedCtaLabel}</a>
</td></tr>
<tr><td align="left" style="padding:32px 0 0 0;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">Glass application workflow</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
    const text = [
      threadLabel ? `Application: ${threadLabel}` : null,
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
