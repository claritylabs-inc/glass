const RESEND_API = "https://api.resend.com/emails";
const DEFAULT_AGENT_DOMAIN = "glass.insure";
const DEFAULT_NOTIFICATION_EMAIL_DOMAIN = "notifications.glass.insure";
const DEFAULT_AUTH_EMAIL_DOMAIN = "auth.glass.insure";
const DEFAULT_LEGACY_AGENT_DOMAINS = ["glass.claritylabs.inc", "dev.claritylabs.inc"];

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

function uniqueDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)));
}

export function getAgentDomain(): string {
  const configured = process.env.AGENT_EMAIL_DOMAIN ?? process.env.AGENT_DOMAIN;
  if (!configured) return DEFAULT_AGENT_DOMAIN;
  return normalizeDomain(configured);
}

export function getLegacyAgentDomains(): string[] {
  const configured = process.env.LEGACY_AGENT_DOMAINS;
  if (!configured) return DEFAULT_LEGACY_AGENT_DOMAINS;
  return configured.split(",").map(normalizeDomain).filter(Boolean);
}

export function getAgentDomains(): string[] {
  return uniqueDomains([getAgentDomain(), ...getLegacyAgentDomains()]);
}

export function getNotificationEmailDomain(): string {
  return process.env.NOTIFICATION_EMAIL_DOMAIN ?? DEFAULT_NOTIFICATION_EMAIL_DOMAIN;
}

export function getAuthEmailDomain(): string {
  return process.env.AUTH_EMAIL_DOMAIN ?? DEFAULT_AUTH_EMAIL_DOMAIN;
}

export function isGlassOutboundAddress(address: string): boolean {
  const domain = normalizeDomain(address.split("@").pop() ?? "");
  return uniqueDomains([
    getAgentDomain(),
    ...getLegacyAgentDomains(),
    getNotificationEmailDomain(),
    getAuthEmailDomain(),
  ]).includes(domain);
}

export function getNotificationFromAddress(fromName: string): string {
  return `${fromName} <notifications@${getNotificationEmailDomain()}>`;
}

function extractEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

function sanitizeFromName(value: string): string {
  return value.replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim();
}

export function getAuthFromAddress(fromName?: string): string {
  const fallback = `Glass from Clarity Labs <noreply@${getAuthEmailDomain()}>`;
  const configured = process.env.AUTH_EMAIL_FROM;
  if (!fromName) return configured ?? fallback;

  const address = extractEmailAddress(configured ?? fallback);
  return `${sanitizeFromName(fromName)} <${address}>`;
}

export type ResendPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type ResendResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export async function sendResendEmail(
  payload: ResendPayload,
  opts: { retries?: number } = {},
): Promise<ResendResult> {
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) return { ok: false, error: "AUTH_RESEND_KEY not set" };

  const maxAttempts = (opts.retries ?? 0) + 1;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
    lastError = body;
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastError };
}
