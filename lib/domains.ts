export const CLIENT_PORTAL_HOST = "app.spot.insure";
export const AUTH_EMAIL_HOST = "auth.spot.insure";
export const LEGACY_APP_HOSTS = [
  "spot.claritylabs.inc",
  "app.glass.insure",
  "glass.claritylabs.inc",
] as const;
const LEGACY_AUTH_EMAIL_HOST = "auth.glass.insure";

export const CLIENT_PORTAL_ORIGIN = `https://${CLIENT_PORTAL_HOST}`;
export const DEFAULT_AGENT_DOMAIN = "spot.insure";
const LEGACY_AGENT_DOMAINS = [
  "glass.insure",
  "glass.claritylabs.inc",
  "spot.claritylabs.inc",
  "dev.claritylabs.inc",
];

export function getPublicAgentDomain(): string {
  const configured = process.env.NEXT_PUBLIC_AGENT_DOMAIN?.trim().toLowerCase();
  if (!configured || LEGACY_AGENT_DOMAINS.includes(configured)) {
    return DEFAULT_AGENT_DOMAIN;
  }
  return configured;
}

export function isManagedSpotHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();
  return [
    CLIENT_PORTAL_HOST,
    AUTH_EMAIL_HOST,
    LEGACY_AUTH_EMAIL_HOST,
    ...LEGACY_APP_HOSTS,
  ].includes(normalizedHost);
}

export function getAppOrigin(): string {
  return CLIENT_PORTAL_ORIGIN;
}
