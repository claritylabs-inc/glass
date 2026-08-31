"use node";

/**
 * Convex-side branding context and white-label gates.
 *
 * Owns server-safe brand names, colors, logo URLs, and email-compatible branding
 * contexts. Browser theme token generation belongs in `lib/branding.ts`; storage
 * URL attachment for org query rows belongs in `convex/lib/orgBranding.ts`.
 */

export type BrandingContext = {
  /** Full brand name, e.g. "Spot" or "Acme Insurance" */
  brandName: string;
  /** Short name used in compact contexts, e.g. "Spot" */
  shortBrandName: string;
  /** Logo URL (CDN or public path) */
  logoUrl: string;
  /** Primary brand color (hex) */
  brandColor: string;
  /** Support URL */
  supportUrl: string;
  /** Display name for the AI agent, e.g. "Spot Agent" */
  agentDisplayName: string;
};

export function isWhiteLabelingEnabled(org?: {
  whiteLabelingEnabled?: boolean;
} | null): boolean {
  return org?.whiteLabelingEnabled !== false;
}

const DEFAULT_LOGO_URL = "/spot-icon.jpg";
const DEFAULT_BRAND_COLOR = "#2563EB";
const DEFAULT_SUPPORT_URL = "https://app.spot.insure/support";

/** Returns the default Spot branding context. */
export function getDefaultBranding(): BrandingContext {
  return {
    brandName: "Spot",
    shortBrandName: "Spot",
    logoUrl: DEFAULT_LOGO_URL,
    brandColor: DEFAULT_BRAND_COLOR,
    supportUrl: DEFAULT_SUPPORT_URL,
    agentDisplayName: "Spot Agent",
  };
}

/**
 * Build a BrandingContext from optional org overrides.
 * All fields fall back to Spot defaults when the org has not configured them.
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
