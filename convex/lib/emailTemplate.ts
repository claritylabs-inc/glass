import type { BrandingContext } from "./branding";
import { getDefaultBranding } from "./branding";

const SITE_URL = process.env.SITE_URL ?? "https://glass.claritylabs.dev";

/** Brand name + mark lockup for the email header. Big squircle logo mirrors the in-app sidebar brand. */
export function buildEmailLogoHtml(branding: BrandingContext = getDefaultBranding()): string {
  const name = branding.brandName;
  const isAbsoluteLogo = /^https?:\/\//i.test(branding.logoUrl);
  const mark = isAbsoluteLogo
    ? `<img src="${branding.logoUrl}" alt="" width="32" height="32" style="display:inline-block;vertical-align:middle;width:32px;height:32px;border-radius:8px;margin-right:10px;object-fit:cover;border:0;" />`
    : `<span style="display:inline-block;vertical-align:middle;width:30px;height:30px;border-radius:8px;border:1.5px solid ${branding.brandColor};margin-right:10px;"></span>`;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:22px;line-height:1;color:#111827;">
      ${mark}
      <span style="font-weight:600;vertical-align:middle;">${name}</span>
    </td>
  </tr>
</table>`;
}

/** "Powered by {icon} Glass from Clarity Labs" platform attribution. */
export function buildPlatformFooterHtml(siteUrl: string = SITE_URL): string {
  const iconUrl = `https://www.google.com/s2/favicons?domain=glass.claritylabs.inc&sz=64`;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1;">
      <span style="vertical-align:middle;">Powered by</span>
      <img src="${iconUrl}" alt="" width="14" height="14" style="display:inline-block;vertical-align:middle;width:14px;height:14px;border-radius:3px;margin:0 6px 0 8px;object-fit:cover;border:0;" />
      <a href="${siteUrl}" style="color:#111827;font-weight:600;text-decoration:none;vertical-align:middle;">Glass</a>
      <span style="vertical-align:middle;margin-left:4px;">from Clarity Labs</span>
    </td>
  </tr>
</table>`;
}

/** @deprecated Use buildEmailLogoHtml(branding). */
export const EMAIL_PRISM_LOGO = buildEmailLogoHtml();

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
  const logo = buildEmailLogoHtml(branding);
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

export function buildOtpEmail(token: string, siteUrl: string = SITE_URL, branding: BrandingContext = getDefaultBranding()): { html: string; text: string } {
  const digits = token.split("");

  const digitCells = digits
    .map(
      (d) =>
        `<td style="width:36px;height:44px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:600;color:#111827;background-color:#f3f1ed;border-radius:8px;">${d}</td>`,
    )
    .join('<td style="width:6px;"></td>');

  const bodyHtml = `
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:500;color:#111827;line-height:1.5;">
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
