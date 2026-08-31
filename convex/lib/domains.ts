import type { Doc } from "../_generated/dataModel";

export const DEFAULT_CLIENT_PORTAL_URL = "https://app.spot.insure";
export const DEFAULT_EMAIL_ASSET_BASE_URL = DEFAULT_CLIENT_PORTAL_URL;

const NON_CANONICAL_SITE_URLS = new Set([
  "https://spot.claritylabs.inc",
  "https://app.glass.insure",
  "https://glass.claritylabs.inc",
  "https://auth.spot.insure",
  "https://auth.glass.insure",
]);

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function normalizeSiteUrl(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  const trimmed = trimTrailingSlash(url);
  if (NON_CANONICAL_SITE_URLS.has(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function getClientPortalUrl(): string {
  return normalizeSiteUrl(
    process.env.CLIENT_PORTAL_URL ?? process.env.APP_SITE_URL ?? process.env.SITE_URL,
    DEFAULT_CLIENT_PORTAL_URL,
  );
}

export function getAuthSiteUrl(): string {
  return normalizeSiteUrl(
    process.env.AUTH_LINK_SITE_URL ??
      process.env.AUTH_SITE_URL ??
      process.env.AUTH_PORTAL_URL ??
      process.env.SITE_URL,
    DEFAULT_CLIENT_PORTAL_URL,
  );
}

export function getEmailAssetBaseUrl(): string {
  return trimTrailingSlash(
    process.env.EMAIL_ASSET_BASE_URL ?? DEFAULT_EMAIL_ASSET_BASE_URL,
  );
}

export function getPortalUrlForOrg(
  _org: Pick<Doc<"organizations">, "type"> | null | undefined,
): string {
  return getClientPortalUrl();
}
