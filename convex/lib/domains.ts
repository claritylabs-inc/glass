import type { Doc } from "../_generated/dataModel";

export const DEFAULT_CLIENT_PORTAL_URL = "https://app.glass.insure";
export const DEFAULT_BROKER_PORTAL_URL = "https://broker.glass.insure";
export const DEFAULT_AUTH_SITE_URL = "https://auth.glass.insure";
export const DEFAULT_EMAIL_ASSET_BASE_URL = DEFAULT_CLIENT_PORTAL_URL;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function normalizeSiteUrl(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  const trimmed = trimTrailingSlash(url);
  if (trimmed === "https://glass.claritylabs.inc") return fallback;
  return trimmed;
}

export function getClientPortalUrl(): string {
  return normalizeSiteUrl(
    process.env.CLIENT_PORTAL_URL ?? process.env.APP_SITE_URL ?? process.env.SITE_URL,
    DEFAULT_CLIENT_PORTAL_URL,
  );
}

export function getBrokerPortalUrl(): string {
  return trimTrailingSlash(
    process.env.BROKER_PORTAL_URL ??
      process.env.BROKER_SITE_URL ??
      DEFAULT_BROKER_PORTAL_URL,
  );
}

export function getAuthSiteUrl(): string {
  return trimTrailingSlash(
    process.env.AUTH_SITE_URL ??
      process.env.AUTH_PORTAL_URL ??
      DEFAULT_AUTH_SITE_URL,
  );
}

export function getEmailAssetBaseUrl(): string {
  return trimTrailingSlash(
    process.env.EMAIL_ASSET_BASE_URL ?? DEFAULT_EMAIL_ASSET_BASE_URL,
  );
}

export function getPortalUrlForOrg(
  org: Pick<Doc<"organizations">, "type"> | null | undefined,
): string {
  return org?.type === "broker" ? getBrokerPortalUrl() : getClientPortalUrl();
}
