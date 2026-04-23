import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

// Minimal wiring: enable server-side session cookies for Convex Auth.
// No route protection / redirects — auth gating happens at the component level.
export default convexAuthNextjsMiddleware();

export const config = {
  // Run on every request EXCEPT static assets, Next internals, and
  // anything that looks like a file (has an extension). This keeps the
  // auth cookie round-trip working on every page navigation while not
  // interfering with RSC payloads, static files, or image/OG routes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon\\.svg|opengraph-image|.*\\..*).*)",
  ],
};
