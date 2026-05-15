export const CLIENT_PORTAL_HOST = "app.glass.insure";
export const AUTH_EMAIL_HOST = "auth.glass.insure";
export const LEGACY_APP_HOST = "glass.claritylabs.inc";

export const CLIENT_PORTAL_ORIGIN = `https://${CLIENT_PORTAL_HOST}`;
export const DEFAULT_AGENT_DOMAIN = "glass.insure";
const LEGACY_AGENT_DOMAINS = ["glass.claritylabs.inc", "dev.claritylabs.inc"];

export function getPublicAgentDomain(): string {
  const configured = process.env.NEXT_PUBLIC_AGENT_DOMAIN?.trim().toLowerCase();
  if (!configured || LEGACY_AGENT_DOMAINS.includes(configured)) {
    return DEFAULT_AGENT_DOMAIN;
  }
  return configured;
}

export function isManagedGlassHost(host: string): boolean {
  return [CLIENT_PORTAL_HOST, AUTH_EMAIL_HOST, LEGACY_APP_HOST].includes(
    host.toLowerCase(),
  );
}

export function getAppOrigin(): string {
  return CLIENT_PORTAL_ORIGIN;
}
