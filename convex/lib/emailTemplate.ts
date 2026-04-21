const SITE_URL = process.env.SITE_URL ?? "https://prism.claritylabs.inc";

/** Prism + Clarity Labs lockup for email headers — JPEG for Gmail reliability */
export const EMAIL_PRISM_LOGO = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center"><img src="${SITE_URL}/prism-logo-email.jpg" alt="Prism by Clarity Labs" width="206" height="58" style="display:block;border:0;outline:none;text-decoration:none;" /></td>
  </tr>
</table>`;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildOtpEmail(token: string, _siteUrl?: string): { html: string; text: string } {
  const digits = token.split("");

  const digitCells = digits
    .map(
      (d) =>
        `<td style="width:36px;height:44px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:600;color:#111827;background-color:#f3f1ed;border-radius:8px;">${d}</td>`,
    )
    .join('<td style="width:6px;"></td>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Your sign-in code</title>
<!--[if mso]>
<style>table{border-collapse:collapse;}td{padding:0;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#faf8f4;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f4;">
<tr><td align="center" style="padding:40px 16px 40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background-color:#ffffff;border-radius:16px;border:1px solid rgba(17,24,39,0.06);box-shadow:0 1px 3px rgba(0,0,0,0.04);">

<!-- Logo -->
<tr><td align="center" style="padding:36px 40px 0 40px;">
  ${EMAIL_PRISM_LOGO}
</td></tr>

<!-- Heading -->
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:500;color:#111827;line-height:1.5;">
    Your sign-in code
  </p>
</td></tr>

<!-- Code -->
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${digitCells}</tr></table>
</td></tr>

<!-- Hint -->
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.5;">
    Enter this code in the browser window where you started signing in. It expires in 15 minutes.
  </p>
</td></tr>

<!-- Divider -->
<tr><td style="padding:32px 40px 0 40px;">
  <div style="height:1px;background-color:rgba(17,24,39,0.06);"></div>
</td></tr>

<!-- Footer -->
<tr><td align="center" style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">
    If you didn't request this code, you can safely ignore this email.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `Your Prism sign-in code is: ${token}\n\nEnter this code in the browser window where you started signing in. It expires in 15 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`;

  return { html, text };
}
