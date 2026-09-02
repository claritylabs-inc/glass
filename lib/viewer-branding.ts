import "server-only";

export type ViewerBranding = {
  name: string;
  iconUrl: string | null;
  brandingColor: string | null;
  isBroker: boolean;
  isClient: boolean;
  isClientUnderBroker: boolean;
};

/** Browser product surfaces always use Spot branding. */
export async function getViewerBranding(): Promise<ViewerBranding | null> {
  return null;
}
