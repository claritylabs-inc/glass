import "server-only";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";

// Next.js server-only bridge for app-shell metadata and Open Graph rendering.
// Do not import this from Convex functions or client components.
export type ViewerBranding = {
  name: string;
  iconUrl: string | null;
  brandingColor: string | null;
  isBroker: boolean;
  isClient: boolean;
  isClientUnderBroker: boolean;
};

/**
 * Server-side fetch of the viewer's effective branding (broker > own org).
 * Returns null when unauthenticated, no membership, or any failure — never throws.
 */
export async function getViewerBranding(): Promise<ViewerBranding | null> {
  let token: string | undefined;
  try {
    token = await convexAuthNextjsToken();
  } catch {
    return null;
  }
  if (!token) return null;

  let viewer: Awaited<ReturnType<typeof fetchQuery<typeof api.orgs.viewerOrg>>>;
  try {
    viewer = await fetchQuery(api.orgs.viewerOrg, {}, { token });
  } catch {
    return null;
  }
  if (!viewer || !viewer.org) return null;

  const orgType = (viewer.org.type ?? "client") as string;
  const isBroker = orgType === "broker";
  const isClient = !isBroker;
  const isClientUnderBroker = isClient && !!viewer.brokerOrg;

  if (isBroker && viewer.org.whiteLabelingEnabled === false) {
    return null;
  }

  if (isClientUnderBroker && viewer.brokerOrg) {
    if (viewer.brokerOrg.whiteLabelingEnabled === false) {
      return {
        name: viewer.org.name,
        iconUrl: viewer.org.iconUrl ?? null,
        brandingColor: (viewer.org.brandingColor as string | undefined) ?? null,
        isBroker: false,
        isClient: true,
        isClientUnderBroker: false,
      };
    }
    return {
      name: viewer.brokerOrg.name,
      iconUrl: viewer.brokerOrg.iconUrl ?? null,
      brandingColor: viewer.brokerOrg.brandingColor ?? null,
      isBroker: false,
      isClient: true,
      isClientUnderBroker: true,
    };
  }

  // Broker staff viewing their own broker org, OR client without broker
  return {
    name: viewer.org.name,
    iconUrl: viewer.org.iconUrl ?? null,
    brandingColor: (viewer.org.brandingColor as string | undefined) ?? null,
    isBroker,
    isClient,
    isClientUnderBroker: false,
  };
}
