import { getViewerBranding } from "@/lib/viewer-branding";
import { PoweredByGlassWordmark } from "@/components/auth-shell";

/**
 * Server-rendered "Powered by Glass" footer — shown only for clients viewing
 * under a broker's white-label. On auth pages (/login, /signup, /invite) the
 * viewer is pre-auth so `getViewerBranding()` returns null and nothing renders.
 * No flicker: decision is made on the server before hydration.
 */
export async function PoweredByFooter() {
  const branding = await getViewerBranding();
  if (!branding?.isClientUnderBroker) return null;

  return (
    <div className="fixed bottom-3 left-0 right-0 flex justify-center pointer-events-none opacity-70 z-10">
      <PoweredByGlassWordmark />
    </div>
  );
}
