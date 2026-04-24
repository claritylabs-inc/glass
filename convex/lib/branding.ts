"use node";

/**
 * Server-side branding context for Glass (formerly Glass).
 *
 * Provides a `BrandingContext` type and a lightweight `getDefaultBranding()`
 * helper that returns Glass defaults. Future: accept an org record and read
 * `agentDisplayName`, `brandingColor`, `iconStorageId` for white-label brokers.
 */

export type BrandingContext = {
  /** Full brand name, e.g. "Glass" or "Acme Insurance" */
  brandName: string;
  /** Short name used in compact contexts, e.g. "Glass" */
  shortBrandName: string;
  /** Logo URL (CDN or public path) */
  logoUrl: string;
  /** Primary brand color (hex) */
  brandColor: string;
  /** Support URL */
  supportUrl: string;
  /** Display name for the AI agent, e.g. "Glass Agent" */
  agentDisplayName: string;
};

export function isWhiteLabelingEnabled(org?: {
  whiteLabelingEnabled?: boolean;
} | null): boolean {
  return org?.whiteLabelingEnabled !== false;
}

const DEFAULT_LOGO_URL = "/glass-icon.jpg";
const DEFAULT_BRAND_COLOR = "#2563EB";
const DEFAULT_SUPPORT_URL = "https://glass.claritylabs.inc/support";

/** Returns the default Glass branding context. */
export function getDefaultBranding(): BrandingContext {
  return {
    brandName: "Glass",
    shortBrandName: "Glass",
    logoUrl: DEFAULT_LOGO_URL,
    brandColor: DEFAULT_BRAND_COLOR,
    supportUrl: DEFAULT_SUPPORT_URL,
    agentDisplayName: "Glass Agent",
  };
}

/**
 * Build a BrandingContext from optional org overrides.
 * All fields fall back to Glass defaults when the org has not configured them.
 */
export function getBrandingContext(orgOverrides?: {
  agentDisplayName?: string;
  brandingColor?: string;
  logoUrl?: string;
}): BrandingContext {
  const defaults = getDefaultBranding();
  return {
    ...defaults,
    brandName: orgOverrides?.agentDisplayName ?? defaults.brandName,
    brandColor: orgOverrides?.brandingColor ?? defaults.brandColor,
    logoUrl: orgOverrides?.logoUrl ?? defaults.logoUrl,
    agentDisplayName: orgOverrides?.agentDisplayName
      ? `${orgOverrides.agentDisplayName} Agent`
      : defaults.agentDisplayName,
  };
}
