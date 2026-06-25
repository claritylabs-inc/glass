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
  const normalized = normalizeDomain(configured);
  if (DEFAULT_LEGACY_AGENT_DOMAINS.includes(normalized)) {
    return DEFAULT_AGENT_DOMAIN;
  }
  return normalized;
}

export function getLegacyAgentDomains(): string[] {
  const configured = process.env.LEGACY_AGENT_DOMAINS;
  if (!configured) return DEFAULT_LEGACY_AGENT_DOMAINS;
  return configured.split(",").map(normalizeDomain).filter(Boolean);
}

export function getAgentDomains(): string[] {
  return uniqueDomains([DEFAULT_AGENT_DOMAIN, getAgentDomain(), ...getLegacyAgentDomains()]);
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
  bcc?: string | string[];
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type ResendResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

type EmailDeliveryMode = "live" | "restricted" | "capture";

type RecipientField = "to" | "cc" | "bcc";

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEmail(value: string): string {
  return extractEmailAddress(value).toLowerCase();
}

function normalizeRecipients(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(normalizeEmail).filter(Boolean);
}

function getSubjectPrefix(): string {
  const configured = process.env.EMAIL_SUBJECT_PREFIX;
  if (configured !== undefined) return configured.trim();
  return process.env.GLASS_ENV === "staging" ? "[STAGING]" : "";
}

function prefixSubject(subject: string): string {
  const prefix = getSubjectPrefix();
  if (!prefix || subject.startsWith(prefix)) return subject;
  return `${prefix} ${subject}`;
}

export function getEmailDeliveryMode(): EmailDeliveryMode {
  const configured = process.env.EMAIL_DELIVERY_MODE?.trim().toLowerCase();
  if (configured === "restricted" || configured === "capture") return configured;
  return "live";
}

function recipientAllowed(email: string): boolean {
  const allowedEmails = new Set(
    splitCsv(process.env.EMAIL_ALLOWED_RECIPIENTS).map((item) =>
      normalizeEmail(item),
    ),
  );
  const allowedDomains = new Set(
    splitCsv(process.env.EMAIL_ALLOWED_RECIPIENT_DOMAINS).map(normalizeDomain),
  );
  if (allowedEmails.has(email)) return true;
  const domain = email.split("@").pop();
  return Boolean(domain && allowedDomains.has(normalizeDomain(domain)));
}

function withOriginalRecipientHeaders(
  payload: ResendPayload,
  recipients: Record<RecipientField, string[]>,
): ResendPayload {
  return {
    ...payload,
    headers: {
      ...payload.headers,
      "X-Glass-Original-To": recipients.to.join(", "),
      ...(recipients.cc.length
        ? { "X-Glass-Original-Cc": recipients.cc.join(", ") }
        : {}),
      ...(recipients.bcc.length
        ? { "X-Glass-Original-Bcc": recipients.bcc.join(", ") }
        : {}),
      ...(process.env.GLASS_ENV ? { "X-Glass-Environment": process.env.GLASS_ENV } : {}),
    },
  };
}

function preparePayloadForDelivery(
  payload: ResendPayload,
): { payload?: ResendPayload; captured?: boolean; error?: string } {
  const mode = getEmailDeliveryMode();
  if (mode === "live") return { payload };

  const recipients = {
    to: normalizeRecipients(payload.to),
    cc: normalizeRecipients(payload.cc),
    bcc: normalizeRecipients(payload.bcc),
  };
  const allRecipients = [...recipients.to, ...recipients.cc, ...recipients.bcc];

  if (mode === "capture") {
    console.log("[resend] Captured email without sending", {
      subject: payload.subject,
      toCount: recipients.to.length,
      ccCount: recipients.cc.length,
      bccCount: recipients.bcc.length,
    });
    return { captured: true };
  }

  const disallowed = allRecipients.filter((email) => !recipientAllowed(email));
  if (disallowed.length === 0) {
    return {
      payload: {
        ...payload,
        subject: prefixSubject(payload.subject),
        headers: {
          ...payload.headers,
          ...(process.env.GLASS_ENV ? { "X-Glass-Environment": process.env.GLASS_ENV } : {}),
        },
      },
    };
  }

  const redirectTo = splitCsv(process.env.EMAIL_REDIRECT_TO);
  if (redirectTo.length === 0) {
    return {
      error: `restricted email delivery blocked ${disallowed.length} recipient(s); set EMAIL_REDIRECT_TO to capture staging mail`,
    };
  }

  const redirected = withOriginalRecipientHeaders(
    {
      ...payload,
      to: redirectTo.length === 1 ? redirectTo[0] : redirectTo,
      subject: prefixSubject(payload.subject),
    },
    recipients,
  );
  const { cc: _cc, bcc: _bcc, ...payloadWithoutCopyRecipients } = redirected;
  return {
    payload: payloadWithoutCopyRecipients,
  };
}

export async function sendResendEmail(
  payload: ResendPayload,
  opts: { retries?: number } = {},
): Promise<ResendResult> {
  const prepared = preparePayloadForDelivery(payload);
  if (prepared.captured) return { ok: true, id: "captured" };
  if (prepared.error) return { ok: false, error: prepared.error };
  if (!prepared.payload) return { ok: false, error: "Email payload was not prepared" };

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
      body: JSON.stringify(prepared.payload),
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
