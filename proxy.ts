import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// Keep browser cookies aligned with Convex Auth's default 30-day session.
// Session-only cookies sign users out whenever the browser process closes even
// though the backend refresh session is still valid.
// No route protection / redirects — auth gating happens at the component level.
export default convexAuthNextjsMiddleware(undefined, {
  cookieConfig: { maxAge: AUTH_COOKIE_MAX_AGE_SECONDS },
});

export const config = {
  // Run on every request EXCEPT static assets, Next internals, and
  // anything that looks like a file (has an extension). This keeps the
  // auth cookie round-trip working on every page navigation while not
  // interfering with RSC payloads, static files, or image/OG routes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon\\.svg|opengraph-image|.*\\..*).*)",
  ],
};
