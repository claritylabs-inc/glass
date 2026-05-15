export const CLIENT_PORTAL_HOST = "app.glass.insure";
export const BROKER_PORTAL_HOST = "broker.glass.insure";
export const AUTH_HOST = "auth.glass.insure";

export const CLIENT_PORTAL_ORIGIN = `https://${CLIENT_PORTAL_HOST}`;
export const BROKER_PORTAL_ORIGIN = `https://${BROKER_PORTAL_HOST}`;
export const AUTH_ORIGIN = `https://${AUTH_HOST}`;
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
  return [CLIENT_PORTAL_HOST, BROKER_PORTAL_HOST, AUTH_HOST].includes(
    host.toLowerCase(),
  );
}

export function getPortalOriginForOrgType(type?: "broker" | "client" | null): string {
  return type === "broker" ? BROKER_PORTAL_ORIGIN : CLIENT_PORTAL_ORIGIN;
}
