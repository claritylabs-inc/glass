// Note: Gmail's image proxy strips data: URIs, so email logos must be absolute
// URLs pointing to a publicly-reachable host serving the asset (e.g. SITE_URL).
// This module owns the shared email HTML shell and generic auth/invite email
// bodies. Notification-specific composition belongs in notificationEmailTemplate.
import type { BrandingContext } from "./branding";
import { getDefaultBranding } from "./branding";
import { getClientPortalUrl, getEmailAssetBaseUrl } from "./domains";
import { SLACK_INSTALL_INVITE_EXPIRATION_DAYS } from "./slackOAuthPolicy";

const SITE_URL = getClientPortalUrl();
const EMAIL_ASSET_BASE_URL = getEmailAssetBaseUrl();
const SLACK_ADD_TO_BUTTON_URL =
  "https://platform.slack-edge.com/img/add_to_slack.png";
const SLACK_ADD_TO_BUTTON_2X_URL =
  "https://platform.slack-edge.com/img/add_to_slack@2x.png";

/** Resolve a logo URL to an absolute URL usable from an email client. */
function absoluteLogoUrl(logoUrl: string, siteUrl: string = SITE_URL): string {
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  const base = siteUrl.replace(/\/$/, "");
  const path = logoUrl.startsWith("/") ? logoUrl : `/${logoUrl}`;
  return `${base}${path}`;
}

/** Resolve built-in email assets from a public web host, not the sending domain. */
export function absoluteEmailAssetUrl(assetPath: string): string {
  return absoluteLogoUrl(assetPath, EMAIL_ASSET_BASE_URL);
}

/** Hosted Glass mark used where the app LogoIcon would normally appear. */
export function buildGlassEmailIconHtml({
  size = 20,
  borderRadius = 4,
  margin = "0 8px 0 0",
}: {
  size?: number;
  borderRadius?: number;
  margin?: string;
} = {}): string {
  const iconUrl = absoluteEmailAssetUrl("/glass-icon.jpg");
  return `<img src="${iconUrl}" alt="" width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;width:${size}px;height:${size}px;border-radius:${borderRadius}px;margin:${margin};object-fit:cover;border:0;" />`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Brand name + mark lockup for the email header. Big squircle logo mirrors the in-app sidebar brand. */
export function buildEmailLogoHtml(branding: BrandingContext = getDefaultBranding(), _siteUrl: string = SITE_URL): string {
  const name = branding.brandName;
  const isDefaultBrand = name === "Glass";
  const src = /^https?:\/\//i.test(branding.logoUrl)
    ? branding.logoUrl
    : absoluteEmailAssetUrl(branding.logoUrl);
  const mark = isDefaultBrand
    ? buildGlassEmailIconHtml({ size: 28, borderRadius: 7, margin: "0 10px 0 0" })
    : `<img src="${src}" alt="" width="28" height="28" style="display:inline-block;vertical-align:middle;width:28px;height:28px;border-radius:7px;margin-right:10px;object-fit:cover;border:0;" />`;
  const suffix = isDefaultBrand
    ? `<span style="font-weight:400;color:#6b7280;vertical-align:middle;margin-left:6px;">from Clarity Labs</span>`
    : "";
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1;color:#000000;">
      ${mark}
      <span style="font-weight:600;vertical-align:middle;">${name}</span>
      ${suffix}
    </td>
  </tr>
</table>`;
}

/** "Powered by {icon} Glass from Clarity Labs" platform attribution. */
export function buildPlatformFooterHtml(siteUrl: string = SITE_URL): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1;">
      <span style="vertical-align:middle;">Powered by</span>
      ${buildGlassEmailIconHtml({ size: 14, borderRadius: 3, margin: "0 6px 0 8px" })}
      <a href="${siteUrl}" style="color:#000000;font-weight:600;text-decoration:none;vertical-align:middle;">Glass</a>
      <span style="vertical-align:middle;margin-left:4px;">from Clarity Labs</span>
    </td>
  </tr>
</table>`;
}

/** Shared email shell: flat white body, branded logo header, platform footer.
 * Callers provide the unique middle content via `bodyHtml`. */
export function buildEmailShell({
  title,
  bodyHtml,
  branding = getDefaultBranding(),
  siteUrl = SITE_URL,
}: {
  title: string;
  bodyHtml: string;
  branding?: BrandingContext;
  siteUrl?: string;
}): string {
  const logo = buildEmailLogoHtml(branding, siteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
<!--[if mso]>
<style>table{border-collapse:collapse;}td{padding:0;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#ffffff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
<tr><td align="center" style="padding:40px 16px 40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

<!-- Logo -->
<tr><td align="center" style="padding:36px 40px 0 40px;">${logo}</td></tr>

${bodyHtml}

</table>

<!-- Platform attribution -->
<div style="padding:24px 0 0 0;text-align:center;">
  ${buildPlatformFooterHtml(siteUrl)}
</div>
</td></tr>
</table>
</body>
</html>`;
}

function buildCodeCells(token: string) {
  return token
    .split("")
    .map(
      (d) =>
        `<td style="width:36px;height:44px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:600;color:#000000;background-color:#f5f5f5;border-radius:8px;">${d}</td>`,
    )
    .join('<td style="width:6px;"></td>');
}

export function buildOtpEmail(token: string, siteUrl: string = SITE_URL, branding: BrandingContext = getDefaultBranding()): { html: string; text: string } {
  const digitCells = buildCodeCells(token);

  const bodyHtml = `
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:500;color:#000000;line-height:1.5;">
    Your sign-in code
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${digitCells}</tr></table>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.5;">
    Enter this code in the browser window where you started signing in. It expires in 15 minutes.
  </p>
</td></tr>
<tr><td style="padding:32px 40px 0 40px;">
  <div style="height:1px;background-color:rgba(17,24,39,0.06);"></div>
</td></tr>
<tr><td align="center" style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">
    If you didn't request this code, you can safely ignore this email.
  </p>
</td></tr>`;

  const html = buildEmailShell({ title: "Your sign-in code", bodyHtml, branding, siteUrl });
  const text = `Your ${branding.brandName} sign-in code is: ${token}\n\nEnter this code in the browser window where you started signing in. It expires in 15 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`;
  return { html, text };
}

export function buildEmailChangeOtpEmail(token: string, siteUrl: string = SITE_URL, branding: BrandingContext = getDefaultBranding()): { html: string; text: string } {
  const digitCells = buildCodeCells(token);
  const bodyHtml = `
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:500;color:#000000;line-height:1.5;">
    Confirm your email change
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${digitCells}</tr></table>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.5;">
    Enter this code in Glass to finish changing your account email. It expires in 15 minutes.
  </p>
</td></tr>
<tr><td style="padding:32px 40px 0 40px;">
  <div style="height:1px;background-color:rgba(17,24,39,0.06);"></div>
</td></tr>
<tr><td align="center" style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">
    If you didn't request this change, you can safely ignore this email.
  </p>
</td></tr>`;

  const html = buildEmailShell({ title: "Confirm your email change", bodyHtml, branding, siteUrl });
  const text = `Your ${branding.brandName} email change code is: ${token}\n\nEnter this code in Glass to finish changing your account email. It expires in 15 minutes.\n\nIf you didn't request this change, you can safely ignore this email.`;
  return { html, text };
}

export function buildSlackInstallInviteEmail({
  clientName,
  channelName,
  installUrl,
  expiresInDays = SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
  siteUrl = SITE_URL,
}: {
  clientName: string;
  channelName: string;
  installUrl: string;
  expiresInDays?: number;
  siteUrl?: string;
}): { html: string; text: string; subject: string } {
  const normalizedClientName = clientName.replace(/[\r\n]+/g, " ").trim();
  const normalizedChannelName = channelName
    .replace(/^#/, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  const safeClientName = escapeHtml(normalizedClientName);
  const safeChannelName = escapeHtml(normalizedChannelName);
  const safeInstallUrl = escapeHtml(installUrl);
  const subject = `Install the Glass Slack app for ${normalizedClientName}`;
  const bodyHtml = `
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.5;">
    Install Glass for ${safeClientName} in Slack
  </p>
</td></tr>
<tr><td style="padding:12px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4b5563;line-height:1.6;">
    Glass is a Slack app that helps your team work with policies, documents, and insurance requests in <strong style="color:#374151;">#${safeChannelName}</strong>.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${safeInstallUrl}" style="display:inline-block;text-decoration:none;">
    <img src="${SLACK_ADD_TO_BUTTON_URL}" srcset="${SLACK_ADD_TO_BUTTON_URL} 1x, ${SLACK_ADD_TO_BUTTON_2X_URL} 2x" alt="Add to Slack" width="139" height="40" style="display:block;width:139px;height:40px;border:0;" />
  </a>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" style="width:24px;padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">1.</td>
      <td valign="top" style="padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Choose the <strong style="color:#374151;">${safeClientName}</strong> Slack workspace.</td>
    </tr>
    <tr>
      <td valign="top" style="width:24px;padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">2.</td>
      <td valign="top" style="padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Review the requested permissions, then allow the Glass Slack app.</td>
    </tr>
    <tr>
      <td valign="top" style="width:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">3.</td>
      <td valign="top" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Add <strong style="color:#374151;">@Glass</strong> to <strong style="color:#374151;">#${safeChannelName}</strong> so it can respond there.</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
  <div style="padding:12px 14px;background-color:#f5f5f5;border-radius:8px;">
    <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#4b5563;line-height:1.6;">
      Glass can read messages sent to it and post replies in channels where it is added. Everyone in those channels can see its responses.
    </p>
  </div>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    If the button does not work, copy this link into your browser:<br><a href="${safeInstallUrl}" style="color:#6b7280;word-break:break-all;">${safeInstallUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#9ca3af;line-height:1.6;">
    This one-time invitation expires in ${expiresInDays} days. If you were not expecting it, you can safely ignore this email.
  </p>
</td></tr>`;
  const text = `Install Glass for ${normalizedClientName} in Slack\n\nGlass is a Slack app that helps your team work with policies, documents, and insurance requests in #${normalizedChannelName}.\n\n1. Open the install link: ${installUrl}\n2. Choose the ${normalizedClientName} Slack workspace.\n3. Review the requested permissions, then allow the Glass Slack app.\n4. Add @Glass to #${normalizedChannelName} so it can respond there.\n\nGlass can read messages sent to it and post replies in channels where it is added. Everyone in those channels can see its responses.\n\nThis one-time invitation expires in ${expiresInDays} days. If you were not expecting it, you can safely ignore this email.`;

  return {
    subject,
    html: buildEmailShell({
      title: escapeHtml(subject),
      bodyHtml,
      branding: getDefaultBranding(),
      siteUrl,
    }),
    text,
  };
}
