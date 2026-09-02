"use node";

/**
 * Convex-side Spot branding context for transactional email and auth flows.
 * Browser theme token generation belongs in `lib/branding.ts`; storage URL
 * attachment for org query rows belongs in `convex/lib/orgBranding.ts`.
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

export function getBrandingContext(): BrandingContext {
  return getDefaultBranding();
}
