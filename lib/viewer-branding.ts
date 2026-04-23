import "server-only";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";

export type ViewerBranding = {
  name: string;
  iconUrl: string | null;
  brandingColor?: string;
  isBroker: boolean;
  isClient: boolean;
  /** True when the viewer is a client operating under a broker org. */
  isClientUnderBroker: boolean;
};

export async function getViewerBranding(): Promise<ViewerBranding | null> {
  let token: string | undefined;
  try {
    token = await convexAuthNextjsToken();
  } catch {
    return null;
  }
  if (!token) return null;

  let result: Awaited<ReturnType<typeof fetchQuery<typeof api.orgs.viewerOrg>>>;
  try {
    result = await fetchQuery(api.orgs.viewerOrg, {}, { token });
  } catch {
    return null;
  }
  if (!result) return null;

  const { org, brokerOrg } = result;
  const orgType = (org.type ?? "client") as string;
  const isBroker = orgType === "broker";
  const isClient = !isBroker;
  const isClientUnderBroker = isClient && !!brokerOrg;

  if (isClientUnderBroker && brokerOrg) {
    return {
      name: brokerOrg.name,
      iconUrl: brokerOrg.iconUrl ?? null,
      brandingColor: brokerOrg.brandingColor,
      isBroker: false,
      isClient: true,
      isClientUnderBroker: true,
    };
  }

  return {
    name: org.name,
    iconUrl: org.iconUrl ?? null,
    brandingColor: org.brandingColor,
    isBroker,
    isClient,
    isClientUnderBroker: false,
  };
}
