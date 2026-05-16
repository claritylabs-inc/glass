const siteUrl = process.env.CONVEX_SITE_URL;
const cronSecret = process.env.EMAIL_SCAN_CRON_SECRET;

if (!siteUrl) {
  throw new Error("CONVEX_SITE_URL is required");
}

if (!cronSecret) {
  throw new Error("EMAIL_SCAN_CRON_SECRET is required");
}

const url = `${siteUrl.replace(/\/$/, "")}/cron/connected-email/scan`;
const startedAt = new Date().toISOString();
console.log(`[mailbox-scan-worker] Starting connected-mailbox scan at ${startedAt}`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cronSecret}`,
    "Content-Type": "application/json",
  },
});

const text = await response.text();
let body;
try {
  body = text ? JSON.parse(text) : null;
} catch {
  body = text;
}

if (!response.ok) {
  console.error("[mailbox-scan-worker] Scan failed", {
    status: response.status,
    body,
  });
  process.exitCode = 1;
} else {
  console.log("[mailbox-scan-worker] Scan completed", body);
}
