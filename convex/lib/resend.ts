const RESEND_API = "https://api.resend.com/emails";
const DEFAULT_AGENT_DOMAIN = "dev.claritylabs.inc";

export function getAgentDomain(): string {
  return process.env.AGENT_DOMAIN ?? DEFAULT_AGENT_DOMAIN;
}

export function getNotificationFromAddress(fromName: string): string {
  return `${fromName} <notifications@${getAgentDomain()}>`;
}

export function getAuthFromAddress(): string {
  return process.env.AUTH_EMAIL_FROM ?? `Clarity Labs <noreply@${getAgentDomain()}>`;
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
