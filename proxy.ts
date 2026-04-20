import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/login",
      "/signup",
      "/signup/:path*",
      "/auth/callback",
      "/logout",
    ],
  },
});

export const config = {
  matcher: ["/((?!_next|favicon.ico|api/public).*)"],
};
